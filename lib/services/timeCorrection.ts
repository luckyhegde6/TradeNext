// lib/services/timeCorrection.ts
//
// Admin "Time Synchronisation" support (v3.32.0). The DB-health dashboard lets
// the operator enter the correct current IST time when the app-server clock
// behaves off (Netlify boxes have been observed drifting ~+5.5h — the machine
// clock reads IST wall time while the process believes it is UTC). A wrong
// clock corrupts every `calculateNextRun(cron, from = new Date())` call and the
// worker's `nextRun <= now` due-gate, so the computed offset is persisted into
// SQLite `_backup_meta` (`time_correction`) and applied LAZILY at each
// scheduling call site via `getCorrectedNow()` / `getCronFrom()`.
//
// The offset is semantics-preserving: `offsetMinutes = trueNow − serverNow`,
// so a 5.5h-fast clock yields −330 and `applyOffset(_, 0)` is the identity —
// the no-correction path is byte-for-byte today's behavior.
//
// IMPORTANT (privately documented in the spec): node-cron's in-process
// scheduler cannot be shifted by a JS offset — the real-time timers it fires
// are bound to the OS clock. The offset corrects the nextRun math (durable
// ledger + due-gate + spawn advance), not the moment node-cron wakes up.
// The durable fix for the path-A timers is a correct `TZ`/`UTC` environment on
// the host; this feature gives the operator a live, audited mitigation.

import {
  persistTimeCorrection,
  deleteTimeCorrection,
  restoreTimeCorrection,
  persistTimeProbe,
  restoreTimeProbe,
} from "@/lib/sqlite";
import type { TimeCorrectionRecord, TimeProbeRecord } from "@/lib/sqlite";

export type { TimeCorrectionRecord, TimeProbeRecord };

/** IST = UTC + 5:30 (India Standard Time, no DST). */
export const IST_OFFSET_MINUTES = 330;

/** Drift above this (ms) between Postgres NOW() and corrected server time is flagged misaligned. */
export const TIME_ALIGN_TOLERANCE_MS = 60_000;

export interface TimeDiagnostics {
  /** Epoch-truthful server clock reading (UTC ISO — whatever the box says). */
  serverIso: string;
  /** Server host offset from UTC in minutes (+330 = IST, 0 = UTC host). */
  serverUtcOffsetMinutes: number;
  /** Resolved IANA zone of the server host ("unknown" when undetectable). */
  serverTz: string;
  /** Server clock rendered as IST wall time (derived, NOT authoritative). */
  istIso: string;
  /** Last known Postgres NOW() from the manual `probe_time` (authoritative). */
  dbIso: string | null;
  /** ISO instant of the last DB probe. */
  dbProbeAt: string | null;
  /** null = never probed; false = |dbNow − correctedNow| ≤ tolerance (aligned); true = drift. */
  misaligned: boolean | null;
  /** Server clock + persisted offset, as ISO. */
  correctedNowIso: string;
  /** Persisted correction record, or null when none is set. */
  correction: TimeCorrectionRecord | null;
}

// ---------------------------------------------------------------------------
// Pure helpers (zero imports — unit-tested directly)
// ---------------------------------------------------------------------------

/** Format a Date as IST wall time "YYYY-MM-DDTHH:mm:ss+05:30". */
export function toIstIso(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MINUTES * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}` +
    `T${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}:${pad(ist.getUTCSeconds())}+05:30`
  );
}

/** Current time as IST wall time ISO (derived display). */
export function getIstNowIso(): string {
  return toIstIso(new Date());
}

const IST_INPUT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * Parse an admin-entered IST wall time "YYYY-MM-DDTHH:mm" (local, no zone) into
 * an absolute Date. Returns null for malformed/unreal dates (Feb 30, hour 25…).
 */
export function parseIstDateTimeLocal(input: string): Date | null {
  if (!IST_INPUT_RE.test(input)) return null;
  const [datePart, timePart] = input.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [h, min] = timePart.split(":").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31 || h < 0 || h > 23 || min < 0 || min > 59) return null;
  // IST = UTC + 5:30 → absolute epoch is the wall components minus the offset.
  const epoch = Date.UTC(y, m - 1, d, h, min) - IST_OFFSET_MINUTES * 60_000;
  const parsed = new Date(epoch);
  // Round-trip guard rejects normalized overflow (e.g. 2026-02-30 → Mar 2).
  // Compare the IST wall-time components of `parsed` (its UTC fields are
  // shifted by +5:30 vs the input, so a direct field comparison would reject
  // every valid input).
  if (toIstIso(parsed).slice(0, 16) !== input) {
    return null;
  }
  return parsed;
}

/** offsetMinutes = trueNow − serverNow (negative = server clock is FAST). */
export function computeCorrectionOffsetMinutes(istInput: Date, serverNow: Date): number {
  return Math.round((istInput.getTime() - serverNow.getTime()) / 60_000);
}

/** Add an offset (minutes) to a Date; offset 0 is the identity. */
export function applyOffset(d: Date, offsetMinutes: number): Date {
  return new Date(d.getTime() + offsetMinutes * 60_000);
}

/** Signed minutes for display, e.g. "-330", "+90", "0". */
export function formatOffsetMinutes(offsetMinutes: number): string {
  const sign = offsetMinutes > 0 ? "+" : offsetMinutes < 0 ? "-" : "";
  return `${sign}${Math.abs(offsetMinutes)}`;
}

// ---------------------------------------------------------------------------
// Persistence (fail-safe wrappers — sqlite may be mocked/absent in tests)
// ---------------------------------------------------------------------------

export function saveCorrection(record: TimeCorrectionRecord): void {
  try {
    persistTimeCorrection(record);
  } catch {
    // sqlite not ready / mock without helper → correction survives in memory only.
  }
}

export function clearCorrection(): void {
  try {
    deleteTimeCorrection();
  } catch {
    // no-op
  }
}

export function loadCorrection(): TimeCorrectionRecord | null {
  try {
    return restoreTimeCorrection();
  } catch {
    return null;
  }
}

export function saveDbProbe(record: TimeProbeRecord): void {
  try {
    persistTimeProbe(record);
  } catch {
    // no-op
  }
}

export function loadDbProbe(): TimeProbeRecord | null {
  try {
    return restoreTimeProbe();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Scheduling-facing API
// ---------------------------------------------------------------------------

/** `new Date()` shifted by the persisted admin offset (identity when unset). */
export function getCorrectedNow(): Date {
  const offset = loadCorrection()?.offsetMinutes ?? 0;
  return applyOffset(new Date(), offset);
}

/** Alias for `calculateNextRun(expr, from)` call sites — keep intent explicit. */
export function getCronFrom(): Date {
  return getCorrectedNow();
}

/** Full read-model for the db-health "Time Synchronisation" card (zero Prisma). */
export function getTimeDiagnostics(): TimeDiagnostics {
  const serverNow = new Date();
  const correction = loadCorrection();
  const probe = loadDbProbe();
  const correctedNow = applyOffset(serverNow, correction?.offsetMinutes ?? 0);

  let misaligned: boolean | null = null;
  if (probe?.dbIso) {
    const dbEpoch = new Date(probe.dbIso).getTime();
    if (Number.isFinite(dbEpoch)) {
      misaligned = Math.abs(dbEpoch - correctedNow.getTime()) > TIME_ALIGN_TOLERANCE_MS;
    }
  }

  return {
    serverIso: serverNow.toISOString(),
    serverUtcOffsetMinutes: -serverNow.getTimezoneOffset(),
    serverTz:
      typeof Intl !== "undefined" && Intl.DateTimeFormat().resolvedOptions().timeZone
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : "unknown",
    istIso: toIstIso(serverNow),
    dbIso: probe?.dbIso ?? null,
    dbProbeAt: probe?.probedAt ?? null,
    misaligned,
    correctedNowIso: correctedNow.toISOString(),
    correction,
  };
}