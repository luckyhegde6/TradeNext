// ─── Degraded task capability registry (v3.45.0, spec 21) ──────────────────
//
// Every `worker-service.ts` task type must declare whether it can run with
// Prisma unavailable. This registry is the single source of truth for that
// answer, and it is deliberately CONSERVATIVE: a type is `degradedSafe` only
// when its executor's writes already land in the SQLite mirror and get queued
// to `_sync_outbox` (drained by the existing 6h `pushSqliteToPrisma()`).
//
// WHY "SKIP, DON'T GUESS". A degraded job runs WITHOUT a working database. If an
// executor writes straight to Prisma, running it does not degrade — it throws,
// burns the task, and can leave partial state. Worse, some executors have
// EXTERNAL side effects (Telegram sends, Google Sheets appends, email) that
// cannot be rolled back and would be duplicated across instances if the
// claim were not atomic. So an unverified type is skipped and AUDITED rather
// than attempted on a guess.
//
// The 2 SEEDED types below were each verified by reading the code that runs
// while the hold is in effect (see `verifiedBy`). Note there is no
// "swing"/"dividends" task type — the dispatch switch has `swing_performance`,
// whose status WRITE is Prisma-backed, so it is deliberately unsafe for now:
//  - recommendations   → dailyRecommendationService mirror-only writes + outbox
//  - corp_actions      → corporate action mirror + outbox (Prisma-free degraded variant)
//
// `alert_check` was ORIGINALLY seeded as safe on the strength of the SQLite
// `alert` table + `upsertAlert` accessor existing. Tracing the executor proved
// that claim WRONG, and it is kept as a permanent cautionary entry: the alert
// mirror table has NO production writer (`upsertAlert` is called only from
// `sqlite.test.ts`), there is no `user_alert` mirror table at all, the executor
// READS `prisma.userAlert`/`prisma.alert`/`prisma.stockSnapshot`, and writes
// `prisma.userAlert.update` + `prisma.notification.create` before
// `triggerAlert()` sends an irreversible Telegram message. Schema + accessors
// existing is not the same as a write path existing (Lesson 155).
//
// Everything else is skipped + audited until its executor is verified. Skipping
// is the correct default: a "safe" guess on a Prisma-writing executor fails
// mid-run and can double an irreversible external side effect.
//
// TO ADD A TYPE: implement its SQLite writer + outbox enqueue, then flip
// `degradedSafe` to true with a `verifiedBy` note. Do not flip it speculatively.

/** Every task type `executeTask()` can dispatch. Kept as a literal union so the
 *  registry cannot silently drift from the switch — `degradedTaskRegistry.test.ts`
 *  parses worker-service.ts and asserts this list matches its `case` labels. */
export type DegradedTaskType =
  // cron task types
  | "stock_sync"
  | "corp_actions"
  | "alert_check"
  | "screener"
  | "recommendations"
  | "recommendation_performance"
  | "swing_performance"
  | "ai_connection_test"
  | "historical_price_sync"
  | "ipo_analysis_prewarm"
  | "ipo_analysis_cleanup"
  | "market_data"
  | "market_data_fetch"
  | "corp_actions_fetch"
  | "events_fetch"
  | "news_fetch"
  | "announcement_fetch"
  | "screener_sync"
  // async task types
  | "csv_processing"
  | "historical_sync"
  | "data_sync"
  // regular task types
  | "password_reset"
  | "notification_broadcast"
  | "announcement_mgmt"
  | "maintenance"
  | "cleanup"
  // F-Score task types
  | "fscore_calc"
  | "fscore_batch"
  | "fscore_single"
  // google-sheets task types
  | "google_sheets_rescan";

/** All 30 dispatchable types, in worker-service.ts order. */
export const DEGRADED_TASK_TYPES: readonly DegradedTaskType[] = [
  "stock_sync",
  "corp_actions",
  "alert_check",
  "screener",
  "recommendations",
  "recommendation_performance",
  "swing_performance",
  "ai_connection_test",
  "historical_price_sync",
  "ipo_analysis_prewarm",
  "ipo_analysis_cleanup",
  "market_data",
  "market_data_fetch",
  "corp_actions_fetch",
  "events_fetch",
  "news_fetch",
  "announcement_fetch",
  "screener_sync",
  "csv_processing",
  "historical_sync",
  "data_sync",
  "password_reset",
  "notification_broadcast",
  "announcement_mgmt",
  "maintenance",
  "cleanup",
  "fscore_calc",
  "fscore_batch",
  "fscore_single",
  "google_sheets_rescan",
] as const;

export interface DegradedTaskCapability {
  /** May this executor run while Prisma is unavailable? */
  degradedSafe: boolean;
  /**
   * Human-readable reason, surfaced in admin + the skip audit event. Required
   * for every unsafe entry so a skip is never silent.
   */
  reason: string;
  /** Mirror table(s) the degraded run writes, for admin visibility. */
  mirrorTables?: string[];
  /** Where the capability was verified — a file reference, not a promise. */
  verifiedBy?: string;
}

/**
 * Capability map. Entries are exhaustive over `DegradedTaskType`.
 *
 * Unsafe-by-default with a specific reason each: the point is that an operator
 * can read WHY a job was skipped, rather than discovering a silent gap later.
 */
const REGISTRY: Record<DegradedTaskType, DegradedTaskCapability> = {
  // ── Verified-safe (mirror + outbox already implemented) ───────────────────
  recommendations: {
    degradedSafe: true,
    reason: "Recommendation writes are mirror-only (Prisma is 6h-push-only) and the tracker backfill is fault-tolerant.",
    mirrorTables: ["daily_recommendation_run", "daily_recommendation_stock", "recommendation_tracker"],
    verifiedBy: "lib/services/degradedExecutor.ts executeRecommendationsDegraded",
  },
  corp_actions: {
    degradedSafe: true,
    reason: "Corporate actions mirror-write with outbox enqueue; drained by the 6h push.",
    mirrorTables: ["corporate_action"],
    verifiedBy: "lib/services/degradedExecutor.ts executeCorpActionsDegraded",
  },

  // ── Not yet verified — skipped loudly in degraded mode ───────────────────
  alert_check: {
    degradedSafe: false,
    reason: "READS prisma.userAlert/alert/stockSnapshot (no user_alert mirror; the alert mirror has no production writer) and its triggerAlert() send is irreversible.",
  },
  stock_sync: {
    degradedSafe: false,
    reason: "Symbol/price sync writes Prisma-backed symbols + daily_price; no verified all-SQLite path yet.",
  },
  screener: {
    degradedSafe: false,
    reason: "Screener runs persist Prisma screener rows; chartink_screener mirror is read-only today.",
  },
  recommendation_performance: {
    degradedSafe: false,
    reason: "READ path degrades via SQLite, but the tracker's status WRITE still targets Prisma.",
  },
  swing_performance: {
    degradedSafe: false,
    reason: "Swing reads degrade, but performance updates write Prisma tracker rows.",
  },
  ai_connection_test: {
    degradedSafe: false,
    reason: "Probe only needs a live model provider, but its result/alert write is Prisma-backed.",
  },
  historical_price_sync: {
    degradedSafe: false,
    reason: "Backfills go to the Prisma daily_prices hypertable, not the temp mirror table.",
  },
  ipo_analysis_prewarm: {
    degradedSafe: false,
    reason: "IPO prewarm persists Prisma IPO rows; no mirror table.",
  },
  ipo_analysis_cleanup: {
    degradedSafe: false,
    reason: "Prisma row deletion; nothing to replay from SQLite.",
  },
  market_data: {
    degradedSafe: false,
    reason: "Market indices persist to Prisma market_cache via Prisma upsert.",
  },
  market_data_fetch: {
    degradedSafe: false,
    reason: "Same executor as market_data — Prisma market_cache upsert.",
  },
  corp_actions_fetch: {
    degradedSafe: false,
    reason: "Same executor as corp_actions but the fetch path also writes Prisma sync metadata.",
  },
  events_fetch: {
    degradedSafe: false,
    reason: "NSE events persist to Prisma; no mirror table.",
  },
  news_fetch: {
    degradedSafe: false,
    reason: "News rows persist to Prisma; no mirror table.",
  },
  announcement_fetch: {
    degradedSafe: false,
    reason: "Announcements persist to Prisma; admin_announcement mirror is admin-authored only.",
  },
  screener_sync: {
    degradedSafe: false,
    reason: "Template sync writes Prisma chartink_screener registry rows.",
  },
  csv_processing: {
    degradedSafe: false,
    reason: "CSV import lands in user portfolio tables (Prisma-only, per-user).",
  },
  historical_sync: {
    degradedSafe: false,
    reason: "Same executor as market_data.",
  },
  data_sync: {
    degradedSafe: false,
    reason: "Same executor as stock_sync.",
  },
  password_reset: {
    degradedSafe: false,
    reason: "Auth path — MUST NOT run without the authoritative user/session tables.",
  },
  notification_broadcast: {
    degradedSafe: false,
    reason: "External send with no dedupe store; a retry storm would double-message users.",
  },
  announcement_mgmt: {
    degradedSafe: false,
    reason: "Prisma-backed admin content write.",
  },
  maintenance: {
    degradedSafe: false,
    reason: "Vacuum/prune sweeps operate on Prisma; unsafe to run blind.",
  },
  cleanup: {
    degradedSafe: false,
    reason: "Same executor as maintenance.",
  },
  fscore_calc: {
    degradedSafe: false,
    reason: "F-Score writes Prisma score rows; no mirror table.",
  },
  fscore_batch: {
    degradedSafe: false,
    reason: "Same executor as fscore_calc.",
  },
  fscore_single: {
    degradedSafe: false,
    reason: "Same executor as fscore_calc.",
  },
  google_sheets_rescan: {
    degradedSafe: false,
    reason: "Appends rows to an EXTERNAL Google Sheet (irreversible) and reads a Prisma-only ScanConfig; must not run while Prisma is unavailable.",
  },
};

/** Never throw — an unknown type degrades to "unsafe + skip". */
export function getDegradedCapability(
  taskType: string,
): DegradedTaskCapability & { known: boolean } {
  const cap = REGISTRY[taskType as DegradedTaskType];
  if (!cap) {
    return {
      known: false,
      degradedSafe: false,
      reason: `Unknown task type "${taskType}" — not registered, so it cannot be run without a database.`,
    };
  }
  return { ...cap, known: true };
}

export function isDegradedSafe(taskType: string): boolean {
  return getDegradedCapability(taskType).degradedSafe;
}

/** Types that would run right now — used by the admin surface. */
export function degradedSafeTaskTypes(): DegradedTaskType[] {
  return DEGRADED_TASK_TYPES.filter((t) => REGISTRY[t].degradedSafe);
}

export function degradedUnsafeTaskTypes(): Array<{ taskType: DegradedTaskType; reason: string }> {
  return DEGRADED_TASK_TYPES.filter((t) => !REGISTRY[t].degradedSafe).map((t) => ({
    taskType: t,
    reason: REGISTRY[t].reason,
  }));
}
