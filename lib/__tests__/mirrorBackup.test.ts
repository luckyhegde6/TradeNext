/**
 * Unit tests for lib/services/mirrorBackup.ts (v3.40.3, spec 14).
 *
 * `@/lib/sqlite` is mocked to a single `getMirrorBlobsStore` so the backup
 * module's own logic (key format/ordering, upload, prune selection, fail-open)
 * is tested in isolation — the real resolver is covered by sqliteMirror.test.ts.
 *
 * @jest-environment node
 */

jest.mock("@/lib/sqlite", () => ({
  __esModule: true,
  getMirrorBlobsStore: jest.fn(),
}));

import { getMirrorBlobsStore } from "@/lib/sqlite";
import {
  MIRROR_BACKUP_KEEP,
  createMirrorBackup,
  listMirrorBackups,
  mirrorBackupKey,
  mirrorBackupTimestamp,
  pruneMirrorBackups,
} from "@/lib/services/mirrorBackup";

const mockGetStore = getMirrorBlobsStore as jest.MockedFunction<typeof getMirrorBlobsStore>;

/** In-memory stand-in for the @netlify/blobs Store subset the module uses. */
class FakeBlobsStore {
  private readonly map = new Map<string, Uint8Array>();
  readonly setCalls: Array<{ key: string }> = [];
  readonly deleteCalls: Array<{ key: string }> = [];

  async set(key: string, blob: Blob): Promise<void> {
    this.setCalls.push({ key });
    this.map.set(key, new Uint8Array(await blob.arrayBuffer()));
  }

  async get(): Promise<ArrayBuffer | null> {
    return null;
  }

  async list(opts: { prefix?: string } = {}): Promise<{ blobs: { key: string; etag: string }[] }> {
    const prefix = opts.prefix ?? "";
    const blobs = [...this.map.keys()]
      .filter((k) => k.startsWith(prefix))
      .map((key) => ({ key, etag: `etag-${key}` }));
    return { blobs };
  }

  async delete(key: string): Promise<void> {
    this.deleteCalls.push({ key });
    this.map.delete(key);
  }
}

const bytes = new Uint8Array([1, 2, 3, 4]);

/** ISO day must be zero-padded — `2026-09-1` is an Invalid Date, silently
 *  rejected by `toISOString()`. Always use 2-digit days in date literals. */
const dayIso = (day: number, time = "02:00:00.000Z") =>
  `2026-09-${String(day).padStart(2, "0")}T${time}`;

beforeEach(() => {
  mockGetStore.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("mirrorBackupKey", () => {
  it("formats the instant in the URL-safe, sortable form", () => {
    expect(mirrorBackupKey(new Date("2026-09-19T06:30:00.000Z"))).toBe(
      "backups/sqlite-mirror-2026-09-19T06-30-00-000Z.sqlite",
    );
  });

  it("is lexicographically ordered across increasing instants", () => {
    const keys = [
      new Date("2026-09-19T06:29:59.999Z"),
      new Date("2026-09-19T06:30:00.000Z"),
      new Date("2026-09-20T00:00:00.000Z"),
    ].map((at) => mirrorBackupKey(at));
    const sorted = [...keys].sort();
    expect(sorted).toEqual(keys); // already oldest → newest
    const sortedDesc = [...keys].sort((a, b) => (a > b ? -1 : 1));
    expect(sortedDesc[0]).toBe("backups/sqlite-mirror-2026-09-20T00-00-00-000Z.sqlite");
  });

  it("round-trips an instant through the embedded timestamp", () => {
    const key = mirrorBackupKey(new Date("2026-09-19T06:30:00.000Z"));
    expect(mirrorBackupTimestamp(key)).toBe("2026-09-19T06:30:00.000Z");
  });

  it("returns undefined for a foreign key", () => {
    expect(mirrorBackupTimestamp("backups/not-a-backup.sqlite")).toBeUndefined();
    expect(mirrorBackupTimestamp("sqlite-mirror.sqlite")).toBeUndefined();
  });
});

describe("createMirrorBackup", () => {
  it("returns null and makes no upload when bytes are null", async () => {
    const store = new FakeBlobsStore();
    mockGetStore.mockResolvedValue(store);
    expect(await createMirrorBackup(null)).toBeNull();
    expect(store.setCalls).toHaveLength(0);
  });

  it("returns null when Blobs is unavailable (fail-open)", async () => {
    mockGetStore.mockResolvedValue(null);
    expect(await createMirrorBackup(bytes)).toBeNull();
  });

  it("uploads one key and reports its byte length", async () => {
    const store = new FakeBlobsStore();
    mockGetStore.mockResolvedValue(store);
    const result = await createMirrorBackup(bytes, { now: new Date("2026-09-19T06:30:00.000Z") });
    expect(result).not.toBeNull();
    expect(result!.key).toBe("backups/sqlite-mirror-2026-09-19T06-30-00-000Z.sqlite");
    expect(result!.bytes).toBe(4);
    expect(result!.pruned).toEqual([]);
    expect(store.setCalls).toHaveLength(1);
  });

  it("prunes to keep when more than `keep` backups exist", async () => {
    const store = new FakeBlobsStore();
    mockGetStore.mockResolvedValue(store);
    // Seed five older backups (keep: 99 disables pruning during seeding).
    for (const day of [10, 11, 12, 13, 14]) {
      await createMirrorBackup(bytes, { now: new Date(dayIso(day)), keep: 99 });
    }
    const result = await createMirrorBackup(bytes, { now: new Date(dayIso(19, "06:30:00.000Z")) });
    expect(result).not.toBeNull();
    // 6th backup just written → 6 pre-existing, keep 5 → oldest 1 pruned.
    expect(result!.pruned).toEqual(["backups/sqlite-mirror-2026-09-10T02-00-00-000Z.sqlite"]);
    expect(store.deleteCalls).toHaveLength(1);
  });

  it("uses the default keep of 5", async () => {
    const store = new FakeBlobsStore();
    mockGetStore.mockResolvedValue(store);
    for (const day of [1, 2, 3, 4, 5]) {
      await createMirrorBackup(bytes, { now: new Date(dayIso(day)), keep: 99 });
    }
    const result = await createMirrorBackup(bytes, { now: new Date(dayIso(19, "06:30:00.000Z")) });
    expect(MIRROR_BACKUP_KEEP).toBe(5);
    expect(result!.pruned).toEqual(["backups/sqlite-mirror-2026-09-01T02-00-00-000Z.sqlite"]);
  });
});

describe("listMirrorBackups", () => {
  it("returns entries oldest-first with a parsed timestamp", async () => {
    const store = new FakeBlobsStore();
    mockGetStore.mockResolvedValue(store);
    await createMirrorBackup(bytes, { now: new Date("2026-09-18T00:00:00.000Z") });
    await createMirrorBackup(bytes, { now: new Date("2026-09-17T00:00:00.000Z") });
    const entries = await listMirrorBackups();
    expect(entries.map((e) => e.key)).toEqual([
      "backups/sqlite-mirror-2026-09-17T00-00-00-000Z.sqlite",
      "backups/sqlite-mirror-2026-09-18T00-00-00-000Z.sqlite",
    ]);
    expect(entries[0].at).toBe("2026-09-17T00:00:00.000Z");
  });

  it("returns [] when Blobs is unavailable", async () => {
    mockGetStore.mockResolvedValue(null);
    expect(await listMirrorBackups()).toEqual([]);
  });
});

describe("pruneMirrorBackups", () => {
  it("keeps the newest 5 and deletes the rest", async () => {
    const store = new FakeBlobsStore();
    mockGetStore.mockResolvedValue(store);
    for (const day of [1, 2, 3, 4, 5, 6, 7]) {
      await createMirrorBackup(bytes, { now: new Date(dayIso(day)), keep: 99 });
    }
    const deleted = await pruneMirrorBackups(5);
    expect(deleted).toHaveLength(2);
    expect(deleted).toEqual([
      "backups/sqlite-mirror-2026-09-01T02-00-00-000Z.sqlite",
      "backups/sqlite-mirror-2026-09-02T02-00-00-000Z.sqlite",
    ]);
    expect(store.deleteCalls).toHaveLength(2);
    const remaining = await listMirrorBackups();
    expect(remaining.map((e) => e.key)).toEqual([
      "backups/sqlite-mirror-2026-09-03T02-00-00-000Z.sqlite",
      "backups/sqlite-mirror-2026-09-04T02-00-00-000Z.sqlite",
      "backups/sqlite-mirror-2026-09-05T02-00-00-000Z.sqlite",
      "backups/sqlite-mirror-2026-09-06T02-00-00-000Z.sqlite",
      "backups/sqlite-mirror-2026-09-07T02-00-00-000Z.sqlite",
    ]);
  });

  it("deletes nothing when at or below the keep limit", async () => {
    const store = new FakeBlobsStore();
    mockGetStore.mockResolvedValue(store);
    await createMirrorBackup(bytes, { now: new Date("2026-09-18T00:00:00.000Z"), keep: 99 });
    await createMirrorBackup(bytes, { now: new Date("2026-09-19T00:00:00.000Z"), keep: 99 });
    expect(await pruneMirrorBackups(5)).toEqual([]);
    expect(store.deleteCalls).toHaveLength(0);
  });

  it("tolerates a failing delete and returns the successful deletions", async () => {
    const store = new FakeBlobsStore();
    const originalDelete = store.delete.bind(store);
    store.delete = async (key: string) => {
      if (key.includes("2026-09-02")) throw new Error("boom");
      await originalDelete(key);
    };
    mockGetStore.mockResolvedValue(store);
    for (const day of [1, 2, 3, 4, 5, 6]) {
      await createMirrorBackup(bytes, { now: new Date(dayIso(day)), keep: 99 });
    }
    const deleted = await pruneMirrorBackups(5);
    expect(deleted).toEqual(["backups/sqlite-mirror-2026-09-01T02-00-00-000Z.sqlite"]);
  });
});