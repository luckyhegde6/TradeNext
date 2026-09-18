/**
 * Golden integration tests for the durable SQLite mirror (v3.39.x, Spec 12).
 *
 * This file does NOT mock "sql.js" — it loads the REAL sql.js WASM runtime, so
 * a genuine SQLite database is created, exported, persisted to disk, uploaded
 * to the Blobs store, and restored from either source. This proves the full
 * snapshot round-trip that the mocked suite in sqlite.test.ts cannot (under
 * that mock, export() returns only a fixed byte buffer and restore always
 * falls through because the mock never answers sqlite_master).
 *
 * Mocked: @/lib/prisma, @/lib/services/leader, @/lib/db-utils — factories
 * mirror lib/__tests__/sqlite.test.ts (keep in sync).
 *
 * @jest-environment node
 */

jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: {
    dailyRecommendationRun: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    dailyRecommendationStock: { findMany: jest.fn().mockResolvedValue([]) },
    corporateAction: { findMany: jest.fn().mockResolvedValue([]) },
    chartinkScreener: { findMany: jest.fn().mockResolvedValue([]) },
    workerStatus: { findMany: jest.fn().mockResolvedValue([]) },
    serverLog: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    auditLog: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    aPIRequestLog: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    cronJob: { findMany: jest.fn().mockResolvedValue([]) },
    workerTask: { findMany: jest.fn().mockResolvedValue([]) },
    symbol: { upsert: jest.fn().mockResolvedValue({ id: "s1", symbol: "RELIANCE" }) },
    dailyPrice: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    chartinkScreenerResult: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
  },
  dbOpsCounter: { reads: 42, writes: 8, _day: "2026-09-13" },
  getIstDayKey: () => "2026-09-13",
  dbErrorCounts: {
    _day: "2026-09-13",
    counts: { plan_limit: 0, timeout: 0, accelerate_proxy: 0, connection: 0, write_budget: 0, other: 0 },
  },
}));

jest.mock("@/lib/services/leader", () => ({
  __esModule: true,
  isLeader: jest.fn().mockResolvedValue(true),
  acquireLeaderLock: jest.fn().mockResolvedValue(true),
  renewLeaderLock: jest.fn().mockResolvedValue(true),
  releaseLeaderLock: jest.fn().mockResolvedValue(undefined),
  getLeaderInfo: jest.fn().mockResolvedValue(null),
  leaderWorkerId: jest.fn((role: string) => `leader-${role}`),
  LEADER_SELF: "unit-test-host",
  LEADER_STALENESS_MS: 10 * 60_000,
  LEADER_HEARTBEAT_MS: 300_000,
}));

jest.mock("@/lib/db-utils", () => {
  const real = jest.requireActual<Record<string, unknown>>("@/lib/db-utils");
  return { ...real, isPlanLimitBreakerOpen: jest.fn().mockReturnValue(false) };
});

import fs from "fs";
import os from "os";
import path from "path";

import {
  ensureSqliteBackup,
  getLivenessHeartbeats,
  getSqliteFallback,
  persistMirrorSnapshot,
  resetSqliteStateForTests,
  runMirrorBlobsRetryForTests,
  setMirrorSnapshotPathForTests,
  uploadMirrorSnapshotToBlobs,
  writeLivenessHeartbeat,
} from "../sqlite";

const SQLITE_MAGIC = Buffer.from([
  0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66,
  0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00,
]);
const MIRROR_BLOBS_KEY = "sqlite-mirror.sqlite";
const nextTick = () => new Promise<void>((r) => setTimeout(r, 10));
const hasMagic = (buf: Buffer) => buf.length >= 16 && buf.subarray(0, 16).equals(SQLITE_MAGIC);

class FakeBlobsStore {
  private readonly map = new Map<string, Uint8Array>();
  readonly getCalls: Array<{ key: string; opts?: { type?: string } }> = [];
  readonly setCalls: Array<{ key: string }> = [];

  async get(key: string, opts?: { type?: string }): Promise<ArrayBuffer | null> {
    this.getCalls.push({ key, opts });
    const bytes = this.map.get(key);
    if (!bytes) return null;
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  async set(key: string, blob: Blob): Promise<void> {
    this.setCalls.push({ key });
    this.map.set(key, new Uint8Array(await blob.arrayBuffer()));
  }
}

describe("durable mirror snapshot (golden, real sql.js)", () => {
  let tmpRoot: string;
  let mirrorFile: string;
  let blobs: FakeBlobsStore;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tn-sqlite-mirror-"));
    mirrorFile = path.join(tmpRoot, "sqlite-mirror.sqlite");
    resetSqliteStateForTests();
    setMirrorSnapshotPathForTests(mirrorFile);
    blobs = new FakeBlobsStore();
    (globalThis as Record<string, unknown>).__sqliteMirrorBlobsStore = blobs;
  });

  afterEach(() => {
    resetSqliteStateForTests();
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  /** Fresh boot: initialise the mirror, then settle the fire-and-forget boot-tail upload. */
  async function boot(): Promise<void> {
    await ensureSqliteBackup();
    await nextTick();
  }

  it("persists a real SQLite snapshot to disk and restores it on reboot", async () => {
    await boot();
    await writeLivenessHeartbeat("worker", { role: "worker", alive: true });
    await writeLivenessHeartbeat("cron-daemon", { role: "cron-daemon", phase: "leader" });
    expect(persistMirrorSnapshot()).toBe(true);

    // Real sql.js export → a genuine SQLite header on disk.
    expect(fs.existsSync(mirrorFile)).toBe(true);
    expect(hasMagic(fs.readFileSync(mirrorFile))).toBe(true);

    // Wipe the live (in-memory) state so the reboot MUST be restored from disk.
    resetSqliteStateForTests();
    setMirrorSnapshotPathForTests(mirrorFile);
    (globalThis as Record<string, unknown>).__sqliteMirrorBlobsStore = blobs;

    await boot();

    const heartbeats = getLivenessHeartbeats();
    expect(heartbeats.some((h) => (h as Record<string, unknown>).key === "liveness_heartbeat:worker")).toBe(true);
    expect(heartbeats.some((h) => (h as Record<string, unknown>).key === "liveness_heartbeat:cron-daemon")).toBe(true);
  });

  it("restored database is live: post-restore writes are truncation-safe", async () => {
    await boot();
    await writeLivenessHeartbeat("worker", { role: "worker", trial: "b-pre-restore" });
    expect(persistMirrorSnapshot()).toBe(true);

    resetSqliteStateForTests();
    setMirrorSnapshotPathForTests(mirrorFile);
    (globalThis as Record<string, unknown>).__sqliteMirrorBlobsStore = blobs;

    await boot(); // restored from disk (1 worker row) — NOT a fresh database

    await writeLivenessHeartbeat("worker", { role: "worker", trial: "b-post-restore" });
    const worker = getLivenessHeartbeats().find(
      (h) => (h as Record<string, unknown>).key === "liveness_heartbeat:worker",
    );
    expect(worker).toBeDefined();
    // INSERT OR REPLACE keeps exactly one worker row — now the post-restore probe.
    expect((worker as Record<string, unknown>).trial).toBe("b-post-restore");
  });

  it("magic-header-but-not-sqlite file boots fail-open and is rewritten", async () => {
    const junk = Buffer.concat([SQLITE_MAGIC, Buffer.from("not-a-real-sqlite-payload-abcdefghij", "utf8")]);
    fs.writeFileSync(mirrorFile, junk);

    await boot(); // must not throw

    expect(fs.existsSync(mirrorFile)).toBe(true);
    const rewritten = fs.readFileSync(mirrorFile);
    expect(hasMagic(rewritten)).toBe(true);
    expect(rewritten.length).not.toBe(junk.length);
  });

  it("falls back to the Blobs snapshot when the disk file is gone", async () => {
    await boot();
    await writeLivenessHeartbeat("worker", { role: "worker" });
    expect(persistMirrorSnapshot()).toBe(true);

    // Boot's upload predates the heartbeat write — push the latest bytes to
    // Blobs exactly like the 60s ops-persistence tick does every interval.
    await uploadMirrorSnapshotToBlobs(new Uint8Array(fs.readFileSync(mirrorFile)));

    fs.rmSync(mirrorFile, { force: true });
    expect(fs.existsSync(mirrorFile)).toBe(false);

    resetSqliteStateForTests();
    setMirrorSnapshotPathForTests(mirrorFile);
    (globalThis as Record<string, unknown>).__sqliteMirrorBlobsStore = blobs;

    await boot(); // disk miss → Blobs download → restored database

    expect(
      blobs.getCalls.some(
        (c) => c.key === MIRROR_BLOBS_KEY && (c.opts as { type?: string } | undefined)?.type === "arrayBuffer",
      ),
    ).toBe(true);
    expect(blobs.setCalls.length).toBeGreaterThan(0);
    expect(
      getLivenessHeartbeats().some((h) => (h as Record<string, unknown>).key === "liveness_heartbeat:worker"),
    ).toBe(true);
  });

  it("Blobs upload is digest-gated: identical bytes skip, changed bytes re-upload", async () => {
    await boot();
    const setsAfterBoot = blobs.setCalls.length;

    const diskBytes = new Uint8Array(fs.readFileSync(mirrorFile));
    await uploadMirrorSnapshotToBlobs(diskBytes); // same digest as the boot upload → skip
    expect(blobs.setCalls.length).toBe(setsAfterBoot);

    const changed = new Uint8Array([...Buffer.from(diskBytes), 0x01, 0x02, 0x03]);
    await uploadMirrorSnapshotToBlobs(changed);
    expect(blobs.setCalls.length).toBe(setsAfterBoot + 1);

    await uploadMirrorSnapshotToBlobs(changed); // repeat → skip
    expect(blobs.setCalls.length).toBe(setsAfterBoot + 1);
  });

  it("fresh boot (no snapshot anywhere) creates a real mirror file", async () => {
    await boot();
    expect(fs.existsSync(mirrorFile)).toBe(true);
    expect(hasMagic(fs.readFileSync(mirrorFile))).toBe(true);
  });

  it("deferred Blobs retry recovers the mirror on a snapshot-less hold boot (v3.40.1)", async () => {
    // Boot 1 (healthy instance): real snapshot with live data → Blobs store.
    await boot();
    await writeLivenessHeartbeat("worker", { role: "worker" });
    expect(persistMirrorSnapshot()).toBe(true);
    await uploadMirrorSnapshotToBlobs(new Uint8Array(fs.readFileSync(mirrorFile)));
    const snapshotSets = blobs.setCalls.length;
    expect(snapshotSets).toBeGreaterThan(0);

    // Simulate a cold start: durable disk is gone AND at boot the Netlify Blobs
    // context does not exist yet (boot runs before the first request). The
    // getStore() attempt fails → negative memo (v3.40.1: failedAt, not null).
    resetSqliteStateForTests();
    setMirrorSnapshotPathForTests(mirrorFile);
    fs.rmSync(mirrorFile, { force: true });
    expect(fs.existsSync(mirrorFile)).toBe(false);
    delete (globalThis as Record<string, unknown>).__sqliteMirrorBlobsStore;
    (globalThis as Record<string, unknown>).__sqliteMirrorBlobsStoreFailedAt = 0;

    await boot(); // fresh schema — the disk+Blobs snapshot is unreachable at boot
    expect(getLivenessHeartbeats().some((h) => (h as Record<string, unknown>).key === "liveness_heartbeat:worker")).toBe(false);

    // First request arrives → Netlify adapter injects the Blobs context → the
    // close-in-time retry (30s post-boot) can now reach the snapshot.
    (globalThis as Record<string, unknown>).__sqliteMirrorBlobsStore = blobs;
    await runMirrorBlobsRetryForTests();

    expect(
      blobs.getCalls.some(
        (c) => c.key === MIRROR_BLOBS_KEY && (c.opts as { type?: string } | undefined)?.type === "arrayBuffer",
      ),
    ).toBe(true);
    // The live mirror now holds the snapshot's data (worker heartbeat came back).
    expect(
      getLivenessHeartbeats().some((h) => (h as Record<string, unknown>).key === "liveness_heartbeat:worker"),
    ).toBe(true);
    // The swapped-in mirror is persisted and re-uploaded (digest differs from
    // the fresh empty schema boot upload).
    expect(fs.existsSync(mirrorFile)).toBe(true);
    expect(hasMagic(fs.readFileSync(mirrorFile))).toBe(true);
    expect(blobs.setCalls.length).toBeGreaterThan(snapshotSets);
  });

  it("deferred Blobs retry skips when the live mirror already has data (v3.40.1)", async () => {
    // Boot 1 (healthy instance): snapshot with data → Blobs store.
    await boot();
    await writeLivenessHeartbeat("worker", { role: "worker" });
    expect(persistMirrorSnapshot()).toBe(true);
    await uploadMirrorSnapshotToBlobs(new Uint8Array(fs.readFileSync(mirrorFile)));

    // Cold start: no durable disk, no Blobs context at boot → fresh schema.
    resetSqliteStateForTests();
    setMirrorSnapshotPathForTests(mirrorFile);
    fs.rmSync(mirrorFile, { force: true });
    delete (globalThis as Record<string, unknown>).__sqliteMirrorBlobsStore;
    (globalThis as Record<string, unknown>).__sqliteMirrorBlobsStoreFailedAt = 0;

    await boot();

    // A HEALTHY boot sync from Prisma would have pulled rows into the live
    // mirror by the time the deferred retry fires — simulate that (market cache
    // row written to the live DB before the retry).
    getSqliteFallback()?.upsertMarketCache({
      cacheKey: "deferred-skip-probe",
      dataType: "gridData",
      data: { symbol: "RELIANCE", price: 100 },
      recordCount: 1,
    });

    // First request arrives → context injected → retry fires. Record the get
    // count first: boot 1 already probed Blobs (restore on a missing disk), so
    // the skip must add NO new download attempt.
    const getsBeforeRetry = blobs.getCalls.length;
    (globalThis as Record<string, unknown>).__sqliteMirrorBlobsStore = blobs;
    await runMirrorBlobsRetryForTests();

    // Live mirror kept its own (newer) data — the snapshot must NOT have been
    // swapped in, and no download should have been attempted.
    expect(blobs.getCalls.length).toBe(getsBeforeRetry);
    expect(
      getSqliteFallback()?.getMarketCache("deferred-skip-probe") ?? null,
    ).not.toBeNull();
    // The snapshot's heartbeat was never merged in.
    expect(
      getLivenessHeartbeats().some((h) => (h as Record<string, unknown>).key === "liveness_heartbeat:worker"),
    ).toBe(false);
  });
});