/**
 * Tests for lib/services/worker/degradedExecutor.ts (v3.45.0, spec 21).
 *
 * WHY THE STRUCTURAL TEST IS THE IMPORTANT ONE. The behavioural tests below
 * mock every dependency, so they would happily pass for an executor that
 * imports Prisma — a mock cannot tell "wrote to the mirror" from "wrote to a
 * database that is held". The one property that matters for this file is
 * STRUCTURAL: **nothing reachable from the degraded executor may reference
 * `prisma`.** So the suite parses the source and asserts it, which is what
 * actually caught `alert_check` being wrongly seeded as safe (Lesson 155):
 * `upsertAlert` + the `alert` table existed, so the prose claim looked true,
 * but the executor READ `prisma.userAlert` and its `triggerAlert()` send is
 * irreversible.
 *
 * Do NOT use `import { jest } from "@jest/globals"` — SWC (next/jest) needs
 * `jest` as the global for `jest.mock()` hoisting.
 */

import fs from "fs";
import path from "path";

jest.mock("@/lib/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("@/lib/sqlite", () => ({
  getSqliteFallback: jest.fn(),
}));

jest.mock("@/lib/services/dailyRecommendationService", () => ({
  runDailyRecommendations: jest.fn(),
}));

jest.mock("@/lib/index-service", () => ({
  getIndexCorporateActions: jest.fn(),
}));

import { getSqliteFallback } from "@/lib/sqlite";
import { runDailyRecommendations } from "@/lib/services/dailyRecommendationService";
import { getIndexCorporateActions } from "@/lib/index-service";
import { executeDegradedTask, DEGRADED_EXECUTOR_TASK_TYPES } from "@/lib/services/worker/degradedExecutor";
import type { DegradedTaskRow } from "@/lib/sqlite";

const SOURCE_PATH = path.join(
  process.cwd(),
  "lib",
  "services",
  "worker",
  "degradedExecutor.ts",
);

function task(overrides: Partial<DegradedTaskRow> = {}): DegradedTaskRow {
  return {
    id: "degraded-1",
    taskType: "recommendations",
    dedupKey: "cron:job-1",
    payload: null,
    status: "running",
    attempts: 1,
    error: null,
    createdAt: "2026-10-05T00:00:00.000Z",
    updatedAt: "2026-10-05T00:00:00.000Z",
    claimedBy: "leader#1",
    claimedAt: "2026-10-05T00:00:00.000Z",
    ...overrides,
  } as DegradedTaskRow;
}

function mirrorStub(overrides: Record<string, unknown> = {}) {
  return {
    isReady: () => true,
    setCorporateActions: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (getSqliteFallback as jest.Mock).mockReturnValue(mirrorStub());
});

describe("degradedExecutor — structural: Prisma must be unreachable", () => {
  const source = fs.readFileSync(SOURCE_PATH, "utf8");

  it("never references prisma anywhere in the degraded execution path", () => {
    // Strip comments so the WHY prose cannot satisfy (or fail) the assertion.
    const code = source
      .split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.trim().startsWith("/*"))
      .join("\n");
    expect(code).not.toMatch(/\bprisma\b/);
  });

  it("dispatches exactly the types the registry marks degraded-safe", () => {
    // Registry is the source of truth; a safe type with no executor branch
    // would be a task the queue claims, then fails forever.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { degradedSafeTaskTypes } = require("@/lib/services/worker/degradedTaskRegistry");
    expect([...DEGRADED_EXECUTOR_TASK_TYPES].sort()).toEqual([...degradedSafeTaskTypes()].sort());
  });
});

describe("degradedExecutor — recommendations", () => {
  it("runs the recommendation service as the system trigger", async () => {
    (runDailyRecommendations as jest.Mock).mockResolvedValue({ totalStocks: 3, runId: "run-1" });

    await executeDegradedTask(task({ taskType: "recommendations" }));

    expect(runDailyRecommendations).toHaveBeenCalledWith({ triggeredBy: "system" });
  });

  it("never passes triggeredBy=admin from a cron payload", async () => {
    (runDailyRecommendations as jest.Mock).mockResolvedValue({ totalStocks: 0, runId: "run-2" });

    await executeDegradedTask(
      task({ taskType: "recommendations", payload: { source: "admin_manual" } }),
    );

    expect(runDailyRecommendations).toHaveBeenCalledWith({ triggeredBy: "system" });
  });

  it("propagates a service failure so the queue records `failed`", async () => {
    (runDailyRecommendations as jest.Mock).mockRejectedValue(new Error("chartink down"));

    await expect(executeDegradedTask(task({ taskType: "recommendations" }))).rejects.toThrow(
      "chartink down",
    );
  });
});

describe("degradedExecutor — corp_actions", () => {
  const actions = [
    {
      symbol: "RELIANCE",
      companyName: "Reliance Industries",
      series: "EQ",
      purpose: "DIVIDEND Rs. 25 per share",
      exDate: "2026-10-05",
      recordDate: "2026-10-07",
    },
    { symbol: "TCS", purpose: "BONUS 1:1", exDate: "2026-10-06" },
  ];

  it("mirrors fetched actions to SQLite without touching Prisma", async () => {
    (getIndexCorporateActions as jest.Mock).mockResolvedValue(actions);
    const cache = jest.fn();
    (getSqliteFallback as jest.Mock).mockReturnValue(mirrorStub({ setCorporateActions: cache }));

    await executeDegradedTask(
      task({ taskType: "corp_actions", payload: { config: { indexName: "NIFTY 50" } } }),
    );

    expect(getIndexCorporateActions).toHaveBeenCalledWith("NIFTY 50");
    expect(cache).toHaveBeenCalledTimes(1);
    const rows = cache.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      symbol: "RELIANCE",
      action_type: "DIVIDEND",
      dividend_per_share: 25,
      source: "nse",
    });
    expect(rows[1]).toMatchObject({ symbol: "TCS", action_type: "BONUS" });
  });

  it("defaults to NIFTY 50 when the payload carries no index", async () => {
    (getIndexCorporateActions as jest.Mock).mockResolvedValue([]);

    await executeDegradedTask(task({ taskType: "corp_actions" }));

    expect(getIndexCorporateActions).toHaveBeenCalledWith("NIFTY 50");
  });

  it("drops rows without a usable exDate instead of mirroring NULL keys", async () => {
    (getIndexCorporateActions as jest.Mock).mockResolvedValue([
      ...actions,
      { symbol: "BAD", purpose: "DIVIDEND Rs. 5", exDate: null },
      { symbol: "BAD2", purpose: "DIVIDEND Rs. 5", exDate: "not-a-date" },
    ]);
    const cache = jest.fn();
    (getSqliteFallback as jest.Mock).mockReturnValue(mirrorStub({ setCorporateActions: cache }));

    await executeDegradedTask(task({ taskType: "corp_actions" }));

    expect(cache.mock.calls[0][0]).toHaveLength(2);
  });

  it("treats an empty fetch as a completed no-op, not a failure", async () => {
    (getIndexCorporateActions as jest.Mock).mockResolvedValue([]);
    const cache = jest.fn();
    (getSqliteFallback as jest.Mock).mockReturnValue(mirrorStub({ setCorporateActions: cache }));

    await expect(
      executeDegradedTask(task({ taskType: "corp_actions" })),
    ).resolves.toBeUndefined();
    expect(cache).toHaveBeenCalledWith([]);
  });

  it("fails loudly when the mirror is not ready, so the row is retried", async () => {
    (getIndexCorporateActions as jest.Mock).mockResolvedValue(actions);
    (getSqliteFallback as jest.Mock).mockReturnValue(null);

    await expect(executeDegradedTask(task({ taskType: "corp_actions" }))).rejects.toThrow(
      /mirror/i,
    );
  });
});

describe("degradedExecutor — unknown / unregistered type", () => {
  it("throws rather than silently succeeding", async () => {
    await expect(
      executeDegradedTask(task({ taskType: "totally_unknown_task" })),
    ).rejects.toThrow(/totally_unknown_task/);
  });
});