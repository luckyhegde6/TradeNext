/**
 * Spec 20 §5.A — Google Sheets Tracker config (admin-written singleton).
 *
 * Read/write path is **SQLite-first**: every read hits the mirror, every write
 * upserts the mirror and enqueues `_sync_outbox`, and the 6h push promotes the
 * row to Prisma later. The admin console therefore works unchanged while the
 * repo is under a Prisma plan-limit hold (P6003) — the console must never 500
 * just because Prisma is unavailable, so nothing in this file touches Prisma.
 *
 * The sheet id is a *resource identifier*, not a credential, so it is stored in
 * plaintext (unlike the OAuth refresh token, which Phase 2 encrypts).
 */

import { z } from "zod";
import { getSqliteFallback } from "@/lib/sqlite";
import logger from "@/lib/logger";
import { isTrackingEnabled, trackerSheetId } from "./auth";
import type { TrackerTab } from "./tabs";

/** Google spreadsheet ids are 20+ chars of URL-safe base64. */
const SHEET_ID_RE = /^[A-Za-z0-9-_]{20,}$/;

/** `null` clears the id (revert to env-only); a non-blank string must match. */
const setSheetIdSchema = z
  .union([z.literal(null), z.string().trim().regex(SHEET_ID_RE, "Invalid Google spreadsheet id")])
  .nullable();

export interface GoogleSheetsConfig {
  /** Resolved spreadsheet id (DB first, env fallback), or null. */
  sheetId: string | null;
  /** Where `sheetId` came from — shown in the UI so the operator knows what's live. */
  sheetIdSource: "db" | "env" | "none";
  displayName: string | null;
  /** The exact env gate (Spec 19 master switch). DB `enabled` can only restrict it. */
  envEnabled: boolean;
  /** DB-level switch. Defaults true so an env-only deployment is not silently off. */
  dbEnabled: boolean;
  /** Effective on/off: `envEnabled && dbEnabled`. What the exporters actually obey. */
  trackingEnabled: boolean;
  lastSyncAt: string | null;
  /** Per-tab high-water marks; absent tab = never synced (first sync backfills). */
  tabMarks: Record<string, string>;
}

/** Read the mirrored row without ever throwing — a missing mirror/row is normal. */
function readMirrorRow(): {
  sheetId: string | null;
  displayName: string | null;
  enabled: boolean;
  lastSyncAt: string | null;
  tabMarks: Record<string, string>;
} {
  try {
    const row = getSqliteFallback()?.getGoogleSheetsConfig();
    if (!row) {
      return { sheetId: null, displayName: null, enabled: true, lastSyncAt: null, tabMarks: {} };
    }
    return {
      sheetId: row.sheetId,
      displayName: row.displayName,
      // An absent row means "never configured" => enabled. A present row defaults
      // to enabled too: the DB switch restricts, it does not arm.
      enabled: row.enabled,
      lastSyncAt: row.lastSyncAt,
      tabMarks: row.tabMarks ?? {},
    };
  } catch (err) {
    logger.debug({
      msg: "Google Sheets: config mirror read failed (env fallback)",
      error: err instanceof Error ? err.message : String(err),
    });
    return { sheetId: null, displayName: null, enabled: true, lastSyncAt: null, tabMarks: {} };
  }
}

/**
 * Effective config. **Never throws** — a config read must not be able to fail an
 * export or an admin request.
 */
export function getConfig(): GoogleSheetsConfig {
  const mirror = readMirrorRow();
  const envId = trackerSheetId();
  const dbId = mirror.sheetId?.trim() || null;
  return {
    sheetId: dbId ?? envId,
    sheetIdSource: dbId ? "db" : envId ? "env" : "none",
    displayName: mirror.displayName,
    envEnabled: isTrackingEnabled(),
    dbEnabled: mirror.enabled,
    // The env gate stays the master switch: the DB can turn tracking OFF but can
    // never turn it ON, so a mis-set DB row can't start writing to a sheet.
    trackingEnabled: isTrackingEnabled() && mirror.enabled,
    lastSyncAt: mirror.lastSyncAt,
    tabMarks: mirror.tabMarks,
  };
}

/**
 * Effective tracking gate: the exact env switch AND the DB switch.
 *
 * Spec 19's exporters call `isTrackingEnabled()` directly. They now call this
 * instead so the admin console's DB switch can actually turn tracking off. The
 * env gate stays the master arm — the DB can only restrict.
 */
export function isTrackingActive(): boolean {
  return isTrackingEnabled() && readMirrorRow().enabled;
}

/** DB-first spreadsheet id with env fallback — keeps a Spec 19 env-only
 * deployment byte-identical, while letting the admin console relink the sheet
 * without a redeploy.
 */
export function resolveSheetId(): string | null {
  const dbId = readMirrorRow().sheetId?.trim();
  if (dbId) return dbId;
  return trackerSheetId();
}

/** The sheet id with only the last 4 chars visible (e.g. `1AbC…XyZ`). */
export function maskSheetId(sheetId: string | null): string | null {
  if (!sheetId) return null;
  return sheetId.length <= 8 ? sheetId : `${sheetId.slice(0, 4)}…${sheetId.slice(-4)}`;
}

/** Best-effort audit. Observability only — must never fail the caller. */
async function auditConfig(action: "GOOGLE_SHEETS_CONFIG_UPDATED", metadata: Record<string, unknown>) {
  try {
    const { createAuditLog } = await import("@/lib/audit");
    await createAuditLog({
      action,
      resource: "google_sheets_tracker",
      resourceId: "singleton",
      metadata,
    });
  } catch {
    // Audit is observability, not correctness.
  }
}

/**
 * Set (or clear, with `null`) the spreadsheet id. Validates the id shape,
 * writes SQLite-first, and audits. Returns the effective config afterwards.
 */
export async function setSheetId(sheetId: string | null): Promise<GoogleSheetsConfig> {
  const parsed = setSheetIdSchema.parse(sheetId);
  const sqlite = getSqliteFallback();
  const current = readMirrorRow();

  sqlite?.upsertGoogleSheetsConfig({
    sheetId: parsed,
    // Keep the existing name; only the id changes here.
    displayName: current.displayName,
    enabled: current.enabled,
    lastSyncAt: current.lastSyncAt,
    tabMarks: current.tabMarks,
  });

  logger.info({
    msg: "Google Sheets: spreadsheet id updated",
    source: "db",
    cleared: parsed === null,
  });
  await auditConfig("GOOGLE_SHEETS_CONFIG_UPDATED", {
    // Masked: the id is not secret, but it needlessly identifies a private doc
    // in the audit trail, and the full value is visible in the UI anyway.
    sheetId: maskSheetId(parsed),
    cleared: parsed === null,
  });
  return getConfig();
}

/** Set the DB-level enable switch. Can only restrict the env gate, never arm it. */
export async function setEnabled(enabled: boolean): Promise<GoogleSheetsConfig> {
  const current = readMirrorRow();
  getSqliteFallback()?.upsertGoogleSheetsConfig({
    sheetId: current.sheetId,
    displayName: current.displayName,
    enabled,
    lastSyncAt: current.lastSyncAt,
    tabMarks: current.tabMarks,
  });
  await auditConfig("GOOGLE_SHEETS_CONFIG_UPDATED", { enabled });
  return getConfig();
}

/** Set the human-readable sheet label shown in the console. */
export async function setDisplayName(displayName: string | null): Promise<GoogleSheetsConfig> {
  const current = readMirrorRow();
  getSqliteFallback()?.upsertGoogleSheetsConfig({
    sheetId: current.sheetId,
    displayName: displayName?.trim() || null,
    enabled: current.enabled,
    lastSyncAt: current.lastSyncAt,
    tabMarks: current.tabMarks,
  });
  await auditConfig("GOOGLE_SHEETS_CONFIG_UPDATED", { displayNameSet: Boolean(displayName?.trim()) });
  return getConfig();
}

/** High-water mark for a tab, or `null` when it has never synced (=> backfill). */
export function getTabMark(tab: TrackerTab): string | null {
  const mark = readMirrorRow().tabMarks[tab];
  return mark ?? null;
}

/**
 * Advance one tab's high-water mark. Callers MUST only invoke this after a
 * confirmed `"enabled"` export — advancing on a failure would silently skip rows
 * on the next sync. Writes the whole map back (merging), so tabs don't clobber
 * each other's marks.
 */
/** Advances the per-tab drain cursor. Opaque to the config layer: spec 20 §5.B
 *  stores a monotonic ledger seq, not a timestamp. */
export function setTabMark(tab: TrackerTab, mark: string): void {
  const current = readMirrorRow();
  getSqliteFallback()?.upsertGoogleSheetsConfig({
    sheetId: current.sheetId,
    displayName: current.displayName,
    enabled: current.enabled,
    lastSyncAt: current.lastSyncAt,
    tabMarks: { ...current.tabMarks, [tab]: mark },
  });
}

/** Stamp `lastSyncAt` after a sync that produced at least one append. */
export function touchLastSync(): void {
  const current = readMirrorRow();
  getSqliteFallback()?.upsertGoogleSheetsConfig({
    sheetId: current.sheetId,
    displayName: current.displayName,
    enabled: current.enabled,
    lastSyncAt: new Date().toISOString(),
    tabMarks: current.tabMarks,
  });
}
