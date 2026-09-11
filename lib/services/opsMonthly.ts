// ─── Monthly query-consumption ledger (v3.34.0) ────────────────────────────
// Persisted IST-monthly reads+writes that mirror the Prisma Console "Total
// Operations" figure (reads+writes through the proxy; the 200K ops/mo plan
// resets on the 2nd of every month). The live `dbOpsCounter` (lib/prisma.ts)
// only covers the current IST day; this ledger folds each day's counter into a
// per-day map for the whole month. It lives on globalThis (hot-reload +
// module-graph safety, mirrors dbOpsCounter) and is persisted by lib/sqlite.ts
// under the "_backup_meta" key "ops_monthly" so it survives restarts/deploys.
// There is NO hot-path change: the $allOperations extension keeps bumping
// dbOpsCounter, and the 60s persistence timer / db-health route are where the
// ledger is folded.
//
// PURE module — the ONLY import is `getIstDayKey` from @/lib/prisma, and it is
// NEVER invoked at module load (several suites mock `@/lib/prisma` WITHOUT named
// exports and pull this module in through lib/sqlite.ts; a load-time call would
// crash them). Day-key lookups happen lazily inside the accessors — i.e. only
// when a real caller (db-health route, sqlite persistence) or a test whose
// prisma mock provides `getIstDayKey` runs.

import { getIstDayKey } from "@/lib/prisma";

export interface OpsMonthlyEntry {
  reads: number;
  writes: number;
}
export interface OpsMonthlyState {
  /** IST month key (YYYY-MM) this ledger covers. */
  monthKey: string;
  /** Per-IST-day (YYYY-MM-DD) reads/writes for the current month. */
  days: Record<string, OpsMonthlyEntry>;
}
export interface QueryConsumption {
  /** IST month key (YYYY-MM). */
  monthKey: string;
  /** Month-to-date reads (persisted ledger + live today's counter merged). */
  reads: number;
  /** Month-to-date writes. */
  writes: number;
  /** reads + writes. */
  totalOperations: number;
  /** Monthly plan limit (DB_PLAN_LIMIT_OPS_MONTHLY, default 200_000). */
  planLimit: number;
  /** Remaining ops before the monthly plan limit. */
  planOperationsRemaining: number;
  /** Merged today's activity (persisted high-water merged over the live counter). */
  today: { dayKey: string; reads: number; writes: number };
  /** Per-day ledger, newest-first (at most 31 entries). */
  perDay: Array<{ day: string; reads: number; writes: number }>;
}

const g = globalThis as unknown as { __opsMonthly?: OpsMonthlyState };

const currentMonthKey = (): string => getIstDayKey().slice(0, 7);

/** Month-scoped accessor — lazily seeds the ledger on first use; a new IST month
 *  starts a fresh ledger (the prior month's entries are intentionally dropped;
 *  the Prisma plan resets monthly). NOTE: `getIstDayKey` is NEVER called at
 *  module load (see header). */
export function getOpsMonthlyState(): OpsMonthlyState {
  const state = g.__opsMonthly;
  if (!state || state.monthKey !== currentMonthKey()) {
    g.__opsMonthly = { monthKey: currentMonthKey(), days: {} };
  }
  return g.__opsMonthly as OpsMonthlyState;
}

/** Merge a day's live counter into the monthly ledger (idempotent — Math.max
 *  keeps the highest value seen, so re-persisting a restored snapshot can never
 *  shrink the ledger). Called by lib/sqlite.ts `persistOpsMonthly()` and never
 *  from the DB hot path. */
export function foldOpsCounterIntoMonthly(
  state: OpsMonthlyState,
  dayKey: string,
  counter: { reads: number; writes: number },
): void {
  const day = state.days[dayKey] ?? { reads: 0, writes: 0 };
  day.reads = Math.max(day.reads, counter.reads);
  day.writes = Math.max(day.writes, counter.writes);
  state.days[dayKey] = day;
}

/** Pure aggregation behind the db-health GET `queryConsumption` block. `live`
 *  is today's dbOpsCounter — merged over any persisted entry so a just-restarted
 *  instance with a lower in-memory counter still reports the high-water mark.
 *  Today's day is NOT double-counted: the persisted entry for the current IST
 *  day is replaced by the merged value before summing. */
export function buildQueryConsumption(
  state: OpsMonthlyState,
  live: { reads: number; writes: number },
  planLimit: number,
): QueryConsumption {
  const dayKey = getIstDayKey();
  const merged: Record<string, OpsMonthlyEntry> = { ...state.days };
  const persistedToday = merged[dayKey] ?? { reads: 0, writes: 0 };
  const today = {
    dayKey,
    reads: Math.max(persistedToday.reads, live.reads),
    writes: Math.max(persistedToday.writes, live.writes),
  };
  merged[dayKey] = { reads: today.reads, writes: today.writes };
  let reads = 0;
  let writes = 0;
  for (const e of Object.values(merged)) {
    reads += e.reads;
    writes += e.writes;
  }
  const totalOperations = reads + writes;
  return {
    monthKey: state.monthKey,
    reads,
    writes,
    totalOperations,
    planLimit,
    planOperationsRemaining: Math.max(0, planLimit - totalOperations),
    today,
    perDay: Object.entries(merged)
      .map(([day, e]) => ({ day, reads: e.reads, writes: e.writes }))
      .sort((a, b) => b.day.localeCompare(a.day))
      .slice(0, 31),
  };
}

/** Test hook — resets the singleton fields IN PLACE (replacing `g.__opsMonthly`
 *  would orphan this module's captured `g` reference) so a clean ledger is used
 *  for the next test case. Mirrors `resetSqliteStateForTests()`. */
export function resetOpsMonthlyForTests(): void {
  const state = getOpsMonthlyState();
  state.monthKey = currentMonthKey();
  state.days = {};
}