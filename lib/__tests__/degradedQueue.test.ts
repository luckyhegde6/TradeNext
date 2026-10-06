/**
 * Tests for lib/services/worker/degradedQueue.ts (v3.45.0, spec 21).
 *
 * SCOPE — this file tests ORCHESTRATION only: dedup keying, claim exclusivity,
 * the registry gate, the bounded drain, failure isolation and stale reclaim
 * ORDER. The SQL and the accessors underneath are pinned separately against a
 * real `sql.js` engine in `sqlite.test.ts` (Lesson 153: a mocked SQLite cannot
 * catch a placeholder/bind-count bug). Here the mirror is an in-memory fake so
 * a wrong queue-level decision cannot hide behind correct SQL.
 *
 * The behaviours that would silently strand work if regressed:
 *   - an unsafe task type is SKIPPED + audited, never half-run (an irreversible
 *     external side effect cannot be rolled back or deduped on retry);
 *   - a throwing executor marks only ITS OWN row failed and the drain continues;
 *   - the reclaim runs BEFORE the claim, so a crashed leader's row is not left
 *     dead behind an empty-looking queue;
 *   - the drain is bounded, so a large backlog cannot wedge the 30s poll.
 *
 * Do NOT use `import { jest } from "@jest/globals"` — SWC (next/jest) needs
 * `jest` as the global for `jest.mock()` hoisting.
 */

// ─── Mocks (MUST be before any imports — SWC hoists jest.mock) ────────────

const sqliteRef: { current: unknown } = { current: null };
const readyRef: { value: boolean } = { value: true };

jest.mock("@/lib/sqlite", () => ({
  __esModule: true,
  getSqliteFallback: jest.fn(() => (readyRef.value ? sqliteRef.current : null)),
}));

jest.mock("@/lib/audit", () => ({
  __esModule: true,
  createAuditLog: jest.fn(async () => undefined),
}));

jest.mock("@/lib/logger", () => {
  const mock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return {
    __esModule: true,
    default: mock,
    info: mock.info,
    warn: mock.warn,
    error: mock.error,
    debug: mock.debug,
  };
});

// ─── Imports ────────────────────────────────────────────────────────────────

import { createAuditLog } from "@/lib/audit";
import {
  claimNextDegradedTask,
  completeDegradedTask,
  DEGRADED_QUEUE_LIMITS,
  enqueueDegradedTask,
  getDegradedQueueStatus,
  runDegradedQueueOnce,
} from "@/lib/services/worker/degradedQueue";
import type { DegradableCronJob } from "@/lib/services/worker/degradedQueue";

const auditMock = createAuditLog as jest.MockedFunction<typeof createAuditLog>;

// ─── In-memory fake mirror (mirrors the ACCESSOR semantics, not the SQL) ────

type FakeTask = {
  id: string;
  taskType: string;
  dedupKey: string;
  payload: Record<string, unknown> | null;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  attempts: number;
  claimedBy: string | null;
  claimedAt: string | null;
  completedAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type FakeMirror = {
  isReady(): boolean;
  enqueueDegradedTask(row: {
    taskType: string;
    dedupKey: string;
    payload?: unknown;
    dedupWindowMs?: number;
  }): string | null;
  claimNextDegradedTask(workerId: string): FakeTask | null;
  completeDegradedTask(id: string, outcome: string, error?: string | null): void;
  requeueStaleDegradedTasks(staleMs: number): number;
  getDegradedTaskStats(): Record<string, unknown>;
  /** Test-only inspection. */
  rows(): FakeTask[];
  /** Test-only: the (workerId, rowId) pairs handed out, in order. */
  claims(): Array<{ workerId: string; id: string }>;
};

let clock = 0;
let seq = 0;

function makeMirror(): FakeMirror {
  const rows: FakeTask[] = [];
  const claims: Array<{ workerId: string; id: string }> = [];
  const iso = () => new Date(1_700_000_000_000 + clock++ * 1000).toISOString();
  return {
    isReady: () => true,
    rows: () => rows,
    claims: () => claims,
    enqueueDegradedTask({ taskType, dedupKey, payload, dedupWindowMs = 90 * 60_000 }) {
      const now = iso();
      const dup = rows.find(
        (r) =>
          r.dedupKey === dedupKey &&
          (r.status === "pending" || r.status === "running") &&
          new Date(now).getTime() - new Date(r.createdAt).getTime() <= dedupWindowMs,
      );
      if (dup) return dup.id;
      const id = `task-${++seq}`;
      rows.push({
        id,
        taskType,
        dedupKey,
        payload: (payload as Record<string, unknown>) ?? null,
        status: "pending",
        attempts: 0,
        claimedBy: null,
        claimedAt: null,
        completedAt: null,
        error: null,
        createdAt: now,
        updatedAt: now,
      });
      return id;
    },
    claimNextDegradedTask(workerId) {
      const row = rows
        .filter((r) => r.status === "pending")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!row) return null;
      row.status = "running";
      row.claimedBy = workerId;
      row.claimedAt = iso();
      row.attempts += 1;
      row.updatedAt = row.claimedAt;
      claims.push({ workerId, id: row.id });
      return row;
    },
    completeDegradedTask(id, outcome, error = null) {
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      row.status = outcome as FakeTask["status"];
      row.error = error;
      row.completedAt = iso();
      row.updatedAt = row.completedAt;
    },
    requeueStaleDegradedTasks(staleMs) {
      const cutoff = new Date(1_700_000_000_000 + clock * 1000 - staleMs).getTime();
      let n = 0;
      for (const row of rows) {
        if (
          row.status === "running" &&
          row.claimedAt != null &&
          new Date(row.claimedAt).getTime() < cutoff
        ) {
          row.status = "pending";
          row.claimedBy = null;
          row.claimedAt = null;
          row.updatedAt = iso();
          n++;
        }
      }
      return n;
    },
    getDegradedTaskStats() {
      const count = (s: string) => rows.filter((r) => r.status === s).length;
      const pending = rows.filter((r) => r.status === "pending");
      return {
        pending: count("pending"),
        running: count("running"),
        completed: count("completed"),
        failed: count("failed"),
        skipped: count("skipped"),
        oldestPendingAt: pending.length ? pending[0].createdAt : null,
      };
    },
  };
}

const job = (over: Partial<DegradableCronJob> = {}): DegradableCronJob => ({
  id: "cron-1",
  name: "Daily Recommendations",
  taskType: "recommendations",
  cronExpression: "0 10 * * *",
  config: { cap: 50 },
  ...over,
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("degradedQueue — enqueue", () => {
  let mirror: FakeMirror;

  beforeEach(() => {
    mirror = makeMirror();
    sqliteRef.current = mirror;
    readyRef.value = true;
    clock = 0;
    seq = 0;
    jest.clearAllMocks();
  });

  it("returns null and touches nothing when the mirror is not ready", () => {
    readyRef.value = false;
    expect(enqueueDegradedTask(job())).toBeNull();
    expect(mirror.rows()).toHaveLength(0);
  });

  it("keys dedup on the CRON id, not the task type — two crons of one type both run", () => {
    const a = enqueueDegradedTask(job({ id: "cron-a" }));
    const b = enqueueDegradedTask(job({ id: "cron-b" }));
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(b).not.toBe(a);
    expect(mirror.rows().map((r) => r.dedupKey)).toEqual(["cron:cron-a", "cron:cron-b"]);
  });

  it("is idempotent for a re-fire of the SAME cron inside the window", () => {
    const first = enqueueDegradedTask(job());
    expect(enqueueDegradedTask(job())).toBe(first);
    expect(enqueueDegradedTask(job())).toBe(first);
    expect(mirror.rows()).toHaveLength(1);
  });

  it("carries the scheduling detail in the payload so the executor needs no cron re-read", () => {
    enqueueDegradedTask(job());
    expect(mirror.rows()[0].payload).toEqual({
      cronJobId: "cron-1",
      cronJobName: "Daily Recommendations",
      cronExpression: "0 10 * * *",
      config: { cap: 50 },
    });
  });

  it("honours an explicit dedup window override", () => {
    const first = enqueueDegradedTask(job());
    // A caller asking for "run now regardless" passes a window the clock has
    // already outrun, so the same cron queues a second row instead of being
    // swallowed as a duplicate.
    const second = enqueueDegradedTask(job(), { dedupWindowMs: 1 });
    expect(second).not.toBe(first);
    expect(mirror.rows()).toHaveLength(2);
  });
});

describe("degradedQueue — claim / complete", () => {
  let mirror: FakeMirror;

  beforeEach(() => {
    mirror = makeMirror();
    sqliteRef.current = mirror;
    readyRef.value = true;
    clock = 0;
    seq = 0;
    jest.clearAllMocks();
  });

  it("claims oldest-first and never hands the same row to two claimants", () => {
    const older = enqueueDegradedTask(job({ id: "cron-old" })) as string;
    const newer = enqueueDegradedTask(job({ id: "cron-new" })) as string;

    const first = claimNextDegradedTask("w-1");
    expect(first).not.toBeNull();
    expect(first?.id).toBe(older);
    expect(first?.status).toBe("running");
    expect(first?.claimedBy).toBe("w-1");
    expect(first?.attempts).toBe(1);

    // The second claimant gets the NEXT row, never the one already running.
    expect(claimNextDegradedTask("w-2")?.id).toBe(newer);
    expect(claimNextDegradedTask("w-3")).toBeNull();
  });

  it("returns null (never throws) when the mirror is not ready", () => {
    readyRef.value = false;
    expect(claimNextDegradedTask("w-1")).toBeNull();
    expect(() => completeDegradedTask("x", "completed")).not.toThrow();
  });

  it("writes the terminal outcome through the mirror", () => {
    const id = enqueueDegradedTask(job()) as string;
    claimNextDegradedTask("w-1");
    completeDegradedTask(id, "failed", "boom");
    expect(mirror.rows()[0]).toMatchObject({ status: "failed", error: "boom" });
    expect(mirror.rows()[0].completedAt).not.toBeNull();
  });
});

describe("degradedQueue — runDegradedQueueOnce", () => {
  let mirror: FakeMirror;

  beforeEach(() => {
    mirror = makeMirror();
    sqliteRef.current = mirror;
    readyRef.value = true;
    clock = 0;
    seq = 0;
    jest.clearAllMocks();
  });

  it("is a no-op returning zeroed counts when the mirror is not ready", async () => {
    readyRef.value = false;
    const res = await runDegradedQueueOnce({
      leaderId: "w-1",
      execute: jest.fn(async () => undefined),
    });
    expect(res).toEqual({
      claimed: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      requeuedStale: 0,
    });
  });

  it("reclaims stale running rows BEFORE claiming, and reports the count", async () => {
    // Strand a row the way a mid-executor crash would.
    const stranded = enqueueDegradedTask(job({ id: "cron-stranded" })) as string;
    mirror.claimNextDegradedTask("dead-leader");
    mirror.rows()[0].claimedAt = new Date(1_699_000_000_000).toISOString();

    const res = await runDegradedQueueOnce({
      leaderId: "w-1",
      execute: jest.fn(async () => undefined),
    });

    expect(res.requeuedStale).toBe(1);
    // The reclaimed row is claimable again, so the very same pass runs it —
    // this is the assertion that ORDER matters.
    expect(res.claimed).toBe(1);
    expect(res.completed).toBe(1);
    expect(mirror.rows().find((r) => r.id === stranded)?.status).toBe("completed");
  });

  it("runs a verified-safe type and marks it completed", async () => {
    const seen: string[] = [];
    enqueueDegradedTask(job({ taskType: "corp_actions" }));
    enqueueDegradedTask(job({ id: "cron-2", taskType: "recommendations" }));

    const res = await runDegradedQueueOnce({
      leaderId: "w-1",
      execute: jest.fn(async (t) => {
        seen.push(t.taskType);
      }),
    });

    expect(seen).toEqual(["corp_actions", "recommendations"]);
    expect(res).toMatchObject({ claimed: 2, completed: 2, failed: 0, skipped: 0 });
    expect(getDegradedQueueStatus()).toMatchObject({ pending: 0, running: 0, completed: 2 });
  });

  it("SKIPS alert_check: its path reads prisma.userAlert and sends Telegram (Lesson 155)", async () => {
    const execute = jest.fn(async () => undefined);
    enqueueDegradedTask(job({ taskType: "alert_check" }));

    const res = await runDegradedQueueOnce({ leaderId: "w-1", execute });

    // Regression guard for the exact misclassification this corrects: the alert
    // mirror + upsertAlert() EXIST, so a table-existence argument would wrongly
    // pass. What makes it unsafe is that nothing in production writes that
    // mirror and the executor's reads/writes/send all hit Prisma/an irreversible
    // side effect.
    expect(execute).not.toHaveBeenCalled();
    expect(res).toMatchObject({ claimed: 1, skipped: 1, completed: 0, failed: 0 });
  });

  it("SKIPS an unregistered/unsafe type without executing it, and audits the skip", async () => {
    const execute = jest.fn(async () => undefined);
    enqueueDegradedTask(job({ taskType: "screener" }));
    enqueueDegradedTask(job({ id: "cron-2", taskType: "totally_unknown_type" }));

    const res = await runDegradedQueueOnce({ leaderId: "w-1", execute });

    // The executor is NEVER called for either row — a Prisma-writing executor
    // that throws mid-run can double an irreversible external side effect.
    expect(execute).not.toHaveBeenCalled();
    expect(res).toMatchObject({ claimed: 2, completed: 0, skipped: 2, failed: 0 });
    expect(mirror.rows().map((r) => r.status)).toEqual(["skipped", "skipped"]);
    expect(auditMock).toHaveBeenCalledTimes(2);
    for (const call of auditMock.mock.calls) {
      expect(call[0].action).toBe("DEGRADED_JOB_SKIPPED");
      expect(call[0].resource).toBe("degraded_task");
      // An explicit session avoids the `auth()` Prisma round-trip that the hold
      // would turn into a guaranteed timeout inside the drain loop.
      expect(call[0].session).toEqual({ user: { email: "system@tradenext6.app" } });
      expect(typeof (call[0].metadata as { reason: string }).reason).toBe("string");
    }
    // The registry's reason (not a generic message) is what an operator reads.
    expect((auditMock.mock.calls[1][0].metadata as { reason: string }).reason).toContain(
      "totally_unknown_type",
    );
  });

  it("isolates a throwing executor: only its own row fails and the drain continues", async () => {
    enqueueDegradedTask(job({ id: "cron-boom" }));
    enqueueDegradedTask(job({ id: "cron-ok", taskType: "corp_actions" }));

    const res = await runDegradedQueueOnce({
      leaderId: "w-1",
      execute: jest.fn(async (t) => {
        if (t.taskType === "recommendations") throw new Error("executor exploded");
      }),
    });

    expect(res).toMatchObject({ claimed: 2, completed: 1, failed: 1, skipped: 0 });
    const rows = mirror.rows();
    expect(rows.find((r) => r.dedupKey === "cron:cron-boom")).toMatchObject({
      status: "failed",
      error: "executor exploded",
    });
    expect(rows.find((r) => r.dedupKey === "cron:cron-ok")?.status).toBe("completed");
    // Nothing is left claimed-but-unfinished: a crash cannot strand the queue.
    expect(getDegradedQueueStatus().running).toBe(0);
  });

  it("bounds the drain so a large backlog cannot wedge the 30s poll", async () => {
    for (let i = 0; i < 9; i++) enqueueDegradedTask(job({ id: `cron-${i}` }));
    const execute = jest.fn(async () => undefined);

    const res = await runDegradedQueueOnce({ leaderId: "w-1", execute, maxPerPass: 3 });

    expect(res).toMatchObject({ claimed: 3, completed: 3 });
    expect(execute).toHaveBeenCalledTimes(3);
    // The rest survives for the next tick rather than being dropped.
    expect(getDegradedQueueStatus().pending).toBe(6);
  });

  it("records the supplied leaderId as the claim identity", async () => {
    const id = enqueueDegradedTask(job()) as string;
    await runDegradedQueueOnce({
      leaderId: "degraded-leader-42",
      execute: jest.fn(async () => undefined),
    });
    // `claimed_by` is what an operator (and a stale-reclaim audit) reads to see
    // WHICH instance ran the row, so the id must reach the accessor verbatim.
    expect(mirror.claims()).toEqual([{ workerId: "degraded-leader-42", id }]);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("rejects a nonsense maxPerPass rather than looping forever", async () => {
    for (let i = 0; i < 3; i++) enqueueDegradedTask(job({ id: `cron-${i}` }));
    const execute = jest.fn(async () => undefined);
    const res = await runDegradedQueueOnce({
      leaderId: "w-1",
      execute,
      maxPerPass: 0 as unknown as number,
    });
    expect(res.claimed).toBe(1); // clamped to >= 1, not `while (n < 0)` forever
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("degradedQueue — status + limits", () => {
  beforeEach(() => {
    sqliteRef.current = makeMirror();
    readyRef.value = true;
    clock = 0;
    seq = 0;
    jest.clearAllMocks();
  });

  it("returns a zeroed snapshot (never null) when the mirror is not ready", () => {
    readyRef.value = false;
    expect(getDegradedQueueStatus()).toEqual({
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      oldestPendingAt: null,
    });
  });

  it("mirrors the accessor stats when ready", () => {
    enqueueDegradedTask(job());
    enqueueDegradedTask(job({ id: "cron-2" }));
    expect(getDegradedQueueStatus()).toMatchObject({ pending: 2, running: 0 });
    expect(getDegradedQueueStatus().oldestPendingAt).toEqual(expect.any(String));
  });

  it("STALE_RUNNING_MS must exceed the 10-minute degraded leader lease", () => {
    // Not a style assertion: reclaiming a row a LIVE leader is still working on
    // would run that executor twice. The lease is 10 min in degradedLeader.ts.
    expect(DEGRADED_QUEUE_LIMITS.STALE_RUNNING_MS).toBeGreaterThan(10 * 60_000);
    expect(DEGRADED_QUEUE_LIMITS.DEFAULT_MAX_PER_PASS).toBeGreaterThan(0);
    expect(DEGRADED_QUEUE_LIMITS.DEDUP_WINDOW_MS).toBe(90 * 60_000);
  });
});