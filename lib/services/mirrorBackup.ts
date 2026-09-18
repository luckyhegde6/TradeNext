// lib/services/mirrorBackup.ts — versioned SQLite-mirror backups in Netlify
// Blobs (v3.40.3, spec 14).
//
// WHY: mirror durability lives in a SINGLE Blobs key (`sqlite-mirror.sqlite`).
// During a Prisma plan-limit hold (P6003) the SQLite -> Prisma `_sync_outbox`
// is never drained (the push is breaker-gated) and the only snapshot upload is
// the 60s timer — so a deploy that recycles the container can permanently lose
// every write since the last upload. This module writes a point-in-time,
// timestamped backup before a deploy and prunes to the newest N so the data
// stays recoverable once the hold lifts.
//
// Backups live in the SAME store as the canonical snapshot (store
// "tradenext-sqlite-mirror") under the `backups/` prefix, so no extra store has
// to be provisioned and the memoized store resolver in lib/sqlite.ts (with its
// v3.40.1 negative-TTL fix) is reused.
//
// Fail-open by contract: every function returns a safe default and never throws.

import { getMirrorBlobsStore } from "@/lib/sqlite";
import logger from "@/lib/logger";

export const MIRROR_BACKUP_PREFIX = "backups/";
export const MIRROR_BACKUP_KEEP = 5;
export const MIRROR_BACKUP_MAX_BYTES = 200 * 1024 * 1024; // mirrors the snapshot cap

export interface MirrorBackupEntry {
  key: string;
  /** ISO instant parsed back out of the key (undefined when unparseable). */
  at?: string;
}

const BACKUP_KEY_RE =
  /^backups\/sqlite-mirror-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.sqlite$/;

/**
 * Versioned backup key for an instant, e.g.
 * `backups/sqlite-mirror-2026-09-19T06-30-00-000Z.sqlite`.
 *
 * Colons/dots are replaced with `-` so the key is URL-safe. Every component is
 * fixed-width and zero-padded, so **lexicographic order == chronological order**
 * — which is what lets `listMirrorBackups` sort and `pruneMirrorBackups` pick
 * the oldest entries without any per-blob metadata.
 */
export function mirrorBackupKey(at: Date = new Date()): string {
  const stamp = at.toISOString().replace(/[:.]/g, "-");
  return `${MIRROR_BACKUP_PREFIX}sqlite-mirror-${stamp}.sqlite`;
}

/** Inverse of `mirrorBackupKey` — recovers the ISO instant embedded in a key. */
export function mirrorBackupTimestamp(key: string): string | undefined {
  const m = BACKUP_KEY_RE.exec(key);
  if (!m) return undefined;
  const iso = `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

/** Existing versioned backups, oldest first. Empty when unavailable. */
export async function listMirrorBackups(): Promise<MirrorBackupEntry[]> {
  try {
    const store = await getMirrorBlobsStore();
    if (!store) return [];
    const list = store.list;
    if (typeof list !== "function") return [];
    // `.call(store)` keeps the Store receiver — its methods read `this`.
    const res = await list.call(store, { prefix: MIRROR_BACKUP_PREFIX });
    const blobs = res?.blobs ?? [];
    return blobs
      .map((b) => ({ key: b.key, at: mirrorBackupTimestamp(b.key) }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  } catch (err) {
    logger.warn({
      msg: "Mirror backup list failed (fail-open)",
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Delete every backup older than the newest `keep`. Returns the deleted keys.
 * A failed delete is logged and skipped so one bad key cannot abort the prune.
 */
export async function pruneMirrorBackups(keep: number = MIRROR_BACKUP_KEEP): Promise<string[]> {
  const entries = await listMirrorBackups(); // oldest first
  const excess = entries.length - Math.max(0, keep);
  if (excess <= 0) return [];

  const store = await getMirrorBlobsStore();
  if (!store) return [];
  const del = store.delete;
  if (typeof del !== "function") return [];

  const deleted: string[] = [];
  for (const entry of entries.slice(0, excess)) {
    try {
      await del.call(store, entry.key);
      deleted.push(entry.key);
    } catch (err) {
      logger.warn({
        msg: "Mirror backup prune failed for key (skipped)",
        key: entry.key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (deleted.length) {
    logger.info({ msg: "Mirror backups pruned", deleted: deleted.length, keep });
  }
  return deleted;
}

/**
 * Write a versioned backup of the mirror bytes, then prune to `keep`.
 * Returns null (never throws) when the bytes are empty/oversized or Blobs is
 * unavailable.
 */
export async function createMirrorBackup(
  bytes: Uint8Array | null,
  opts: { keep?: number; now?: Date } = {},
): Promise<{ key: string; bytes: number; pruned: string[] } | null> {
  try {
    if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MIRROR_BACKUP_MAX_BYTES) return null;
    const store = await getMirrorBlobsStore();
    if (!store) return null;
    const key = mirrorBackupKey(opts.now ?? new Date());
    // Blob/BlobPart types come from lib.dom; the Blob global exists at runtime
    // in Node 18+ (same convention as the snapshot upload in lib/sqlite.ts).
    await store.set(key, new Blob([bytes as unknown as BlobPart]));
    const pruned = await pruneMirrorBackups(opts.keep ?? MIRROR_BACKUP_KEEP);
    logger.info({ msg: "Mirror backup created", key, bytes: bytes.byteLength, pruned: pruned.length });
    return { key, bytes: bytes.byteLength, pruned };
  } catch (err) {
    logger.warn({
      msg: "Mirror backup failed (fail-open)",
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
