// lib/sqlitePushSinks.ts
//
// Plan 09 Phase 4: per-table SQLite -> Prisma push sinks. Each sink takes the
// drained outbox slice for one mirror table, re-reads the affected rows from
// the SQLite mirror, and applies them to Prisma. Sinks are idempotent, so a
// whole-table retry after a partial failure is safe (failed tables keep their
// outbox rows; the next push cycle re-applies the full mirror state).
//
// Outbox row_id contracts (must match the writers in lib/sqlite.ts):
//   symbols                  -> uppercased symbol
//   daily_price              -> JSON.stringify([TICKER, tradeDate])
//   corporate_action         -> JSON.stringify([symbol, actionType, exDate])
//   chartink_screener_result -> mirror row id (or "<screenerId>:<SYMBOL>")
//   Plan 09 Phase 6 job tables (daily_recommendation_run, daily_recommendation_stock,
//     recommendation_tracker, recommendation_status_history, recommendation_archive,
//     swing_analysis_job, swing_signal) -> mirror row id (Prisma id passthrough)

import type { Database } from "sql.js";
import prisma from "@/lib/prisma";

export type OutboxRow = { rowId: string; op: "upsert" | "delete" };

const sv = (v: unknown): string | number | null => {
  if (v == null) return null;
  if (typeof v === "string" || typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  return String(v);
};

/** Read all rows of a mirror table into a natural-key map. Row key encodings
 *  match the outbox row_id contracts above. */
function readMirrorMap(db: Database, tableName: string): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  const res = db.exec(`SELECT * FROM ${tableName}`);
  if (!res.length || !res[0].values.length) return map;
  const cols = res[0].columns;
  for (const row of res[0].values) {
    const obj: Record<string, unknown> = {};
    cols.forEach((c, i) => (obj[c] = row[i]));
    let key: string;
    switch (tableName) {
      case "symbols":
        key = String(obj.symbol ?? "").toUpperCase();
        break;
      case "daily_price":
        key = JSON.stringify([String(obj.ticker ?? ""), String(obj.trade_date ?? "")]);
        break;
      case "corporate_action":
        key = JSON.stringify([String(obj.symbol ?? ""), String(obj.action_type ?? "OTHER"), sv(obj.ex_date)]);
        break;
      default:
        key = String(obj.id ?? `${obj.screener_id}:${obj.symbol}`);
        break;
    }
    map.set(key, obj);
  }
  return map;
}

async function pushSymbols(db: Database, rows: OutboxRow[]): Promise<number> {
  const mirror = readMirrorMap(db, "symbols");
  let applied = 0;
  for (const r of rows) {
    if (r.op === "delete") {
      await prisma.symbol.deleteMany({ where: { symbol: r.rowId } });
      applied++;
      continue;
    }
    const m = mirror.get(r.rowId);
    if (!m) continue; // no longer in the mirror — treat as applied
    const s = (v: unknown): string | null => (v == null ? null : String(v));
    const data = {
      companyName: s(m.company_name) ?? "",
      series: s(m.series),
      industry: s(m.industry),
      isActive: Number(sv(m.is_active) ?? 0) !== 0,
      lastPrice: sv(m.last_price) as number | null,
      lastUpdated: s(m.last_updated),
      createdAt: String(m.created_at),
      updatedAt: String(m.updated_at),
    };
    await prisma.symbol.upsert({ where: { symbol: r.rowId }, create: { symbol: r.rowId, ...data }, update: data });
    applied++;
  }
  return applied;
}

async function pushDailyPrice(db: Database, rows: OutboxRow[]): Promise<number> {
  const mirror = readMirrorMap(db, "daily_price");
  const outbox = rows.filter((r) => r.op === "upsert");
  const pushes: Array<{ ticker: string; tradeDate: string; open: number | null; high: number | null; low: number | null; close: number | null; volume: number; vwap: number | null }> = [];
  for (const r of outbox) {
    let key: [string, string];
    try {
      key = JSON.parse(r.rowId) as [string, string];
    } catch {
      continue; // malformed row_id — nothing to push
    }
    const m = mirror.get(r.rowId);
    if (!m) continue;
    pushes.push({
      ticker: key[0],
      tradeDate: key[1],
      open: sv(m.open) as number | null,
      high: sv(m.high) as number | null,
      low: sv(m.low) as number | null,
      close: sv(m.close) as number | null,
      volume: Number(sv(m.volume) ?? 0),
      vwap: sv(m.vwap) as number | null,
    });
  }
  // Bulk upsert in chunks — ONE Prisma op per chunk (mirrors
  // historicalPriceSyncService.ts; daily_price row counts are large).
  const CHUNK = 200;
  for (let i = 0; i < pushes.length; i += CHUNK) {
    const chunk = pushes.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const params: Array<string | number | null> = [];
    for (const p of chunk) {
      params.push(p.ticker, p.tradeDate, p.open, p.high, p.low, p.close, p.volume, p.vwap);
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO daily_prices (ticker, "tradeDate", open, high, low, close, volume, vwap)
       VALUES ${placeholders}
       ON CONFLICT (ticker, "tradeDate") DO UPDATE SET
         open = EXCLUDED.open,
         high = EXCLUDED.high,
         low = EXCLUDED.low,
         close = EXCLUDED.close,
         volume = EXCLUDED.volume,
         vwap = EXCLUDED.vwap`,
      ...params,
    );
  }
  // Deletes (rare) are applied individually — a compound WHERE over the whole
  // list could over-delete (ticker x tradeDate cross product).
  for (const r of rows) {
    if (r.op !== "delete") continue;
    let key: [string, string];
    try {
      key = JSON.parse(r.rowId) as [string, string];
    } catch {
      continue;
    }
    await prisma.dailyPrice.deleteMany({ where: { ticker: key[0], tradeDate: key[1] } });
  }
  return pushes.length + rows.filter((r) => r.op === "delete").length;
}

async function pushCorporateActions(db: Database, rows: OutboxRow[]): Promise<number> {
  const mirror = readMirrorMap(db, "corporate_action");
  const CHUNK = 200;
  let applied = 0;
  const outbox = rows.filter((r) => r.op === "upsert");
  const data: Array<Record<string, unknown>> = [];
  for (const r of outbox) {
    const m = mirror.get(r.rowId);
    if (!m) continue;
    data.push({
      symbol: sv(m.symbol) ?? "",
      companyName: sv(m.company_name) ?? "",
      series: sv(m.series),
      subject: sv(m.subject),
      actionType: (sv(m.action_type) as string) ?? "OTHER",
      exDate: sv(m.ex_date),
      recordDate: sv(m.record_date),
      effectiveDate: sv(m.effective_date),
      faceValue: sv(m.face_value) as number | null,
      oldFV: sv(m.old_fv) as number | null,
      newFV: sv(m.new_fv) as number | null,
      ratio: sv(m.ratio) as number | null,
      dividendPerShare: sv(m.dividend_per_share) as number | null,
      dividendYield: sv(m.dividend_yield) as number | null,
      isin: sv(m.isin),
      bookClosureStartDate: sv(m.book_closure_start_date),
      bookClosureEndDate: sv(m.book_closure_end_date),
      announcementDate: sv(m.announcement_date),
      source: (sv(m.source) as string) ?? "nse",
      createdAt: sv(m.created_at) as string,
      updatedAt: sv(m.updated_at) as string,
    });
  }
  for (let i = 0; i < data.length; i += CHUNK) {
    await prisma.corporateAction.createMany({ data: data.slice(i, i + CHUNK) as never, skipDuplicates: true });
  }
  applied += data.length;
  for (const r of rows) {
    if (r.op !== "delete") continue;
    let key: [string, string, string | null];
    try {
      key = JSON.parse(r.rowId) as [string, string, string | null];
    } catch {
      continue;
    }
    await prisma.corporateAction.deleteMany({ where: { symbol: key[0], actionType: key[1], exDate: key[2] } });
  }
  applied += rows.filter((r) => r.op === "delete").length;
  return applied;
}

async function pushChartinkResults(db: Database, rows: OutboxRow[]): Promise<number> {
  const mirror = readMirrorMap(db, "chartink_screener_result");
  const CHUNK = 200;
  let applied = 0;
  const outbox = rows.filter((r) => r.op === "upsert");
  const data: Array<Record<string, unknown>> = [];
  for (const r of outbox) {
    const m = mirror.get(r.rowId);
    if (!m) continue;
    // Fallback runs ("sqlite" run_id) have no Prisma run row to link — they
    // are mirror-only data and must not be promoted (FK would reject them).
    if ((sv(m.run_id) as string) === "sqlite") {
      applied++; // consumed by the mirror only
      continue;
    }
    data.push({
      id: sv(m.id) as string,
      runId: sv(m.run_id) as string,
      screenerId: sv(m.screener_id) as string,
      symbol: String(sv(m.symbol) ?? "").toUpperCase(),
      name: sv(m.name),
      bsecode: sv(m.bsecode),
      close: sv(m.close) as number | null,
      changePercent: sv(m.change_percent) as number | null,
      conditionFlag: sv(m.condition_flag) as string | null,
      volume: sv(m.volume) as number | null,
      raw: m.raw != null ? String(m.raw) : null,
      capturedAt: sv(m.captured_at) as string,
      expiresAt: sv(m.expires_at) as string,
    });
  }
  for (let i = 0; i < data.length; i += CHUNK) {
    await prisma.chartinkScreenerResult.createMany({ data: data.slice(i, i + CHUNK) as never, skipDuplicates: true });
  }
  applied += data.length;
  for (const r of rows) {
    if (r.op !== "delete") continue;
    await prisma.chartinkScreenerResult.deleteMany({ where: { id: r.rowId } });
    applied++;
  }
  return applied;
}

// ---------------------------------------------------------------------------
// Plan 09 Phase 6 sinks — recommendation / swing / perf job tables.
// Mirror rows are full Prisma-shaped rows (camelCase columns in the DDL hold
// the Prisma field names snake_cased); each sink maps mirror -> Prisma and
// delegates to the shared id-keyed upsert engine below.
// ---------------------------------------------------------------------------

/** Convert a serialized JSON array (stored in a mirror TEXT column) into a
 *  PostgreSQL text-array literal suitable for `CAST(? AS text[])`. */
function toPgArrayLiteral(v: unknown): string | null {
  if (v == null) return null;
  let arr: unknown;
  try {
    arr = typeof v === "string" ? JSON.parse(v) : v;
  } catch {
    return null;
  }
  if (!Array.isArray(arr)) return null;
  const items = arr.map((x) => {
    const s = String(x ?? "");
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  });
  return `{${items.join(",")}}`;
}

type GenCol = {
  /** Prisma DB column (camelCase, quoted; `id` bare). */
  sql: string;
  /** Cast the parameter to jsonb (mirror TEXT holding serialized JSON). */
  json?: boolean;
  /** Cast the parameter to text[] (mirror TEXT holding a JSON array literal). */
  arr?: boolean;
  /** Cast the parameter to boolean (mirror INTEGER 0/1). */
  bool?: boolean;
  /** Extract the Prisma-side value from the mirror row. */
  val: (m: Record<string, unknown>) => unknown;
};

/** Shared id-keyed upsert sink (Plan 09 Phase 6): raw chunked
 *  INSERT ... ON CONFLICT (id) DO UPDATE over `<prismaTable>`. Uses 1 raw op
 *  per chunk of PUSH_CHUNK rows (not N per-row client ops) — the job tables are
 *  low-volume, so this stays well inside the db-health op budget. Deletes are
 *  raw `DELETE ... WHERE id = ?`. JSON columns bind `CAST(? AS jsonb)`, array
 *  columns `CAST(? AS text[])` (value must be a PG literal — toPgArrayLiteral),
 *  booleans `CAST(? AS boolean)`.
 *
 *  Supersedes the per-table `prisma.model.upsert/createMany` suggestions in
 *  spec §4.6 — same semantics, far fewer Prisma ops. */
async function pushByIdUpsert(
  db: Database,
  mirrorTable: string,
  prismaTable: string,
  cols: GenCol[],
  rows: OutboxRow[],
): Promise<number> {
  const mirror = readMirrorMap(db, mirrorTable);
  const PUSH_CHUNK = 200;
  const upserts: Array<{ id: string; data: Array<string | number | null | boolean> }> = [];
  const deletes: string[] = [];
  for (const r of rows) {
    if (r.op === "delete") {
      deletes.push(r.rowId);
      continue;
    }
    if (r.op !== "upsert") continue;
    const m = mirror.get(r.rowId);
    if (!m) continue; // row no longer in the mirror — treat as consumed
    upserts.push({
      id: String(sv(m.id) ?? ""),
      data: cols.map((c) => c.val(m)) as Array<string | number | null | boolean>,
    });
  }
  let applied = 0;
  if (upserts.length) {
    const colSql = cols.map((c) => c.sql).join(", ");
    const valSql = cols
      .map((c) =>
        c.json ? "CAST(? AS jsonb)" : c.arr ? "CAST(? AS text[])" : c.bool ? "CAST(? AS boolean)" : "?",
      )
      .join(", ");
    const setSql = cols
      .filter((c) => c.sql !== "id")
      .map((c) => `${c.sql} = EXCLUDED.${c.sql}`)
      .join(", ");
    for (let i = 0; i < upserts.length; i += PUSH_CHUNK) {
      const chunk = upserts.slice(i, i + PUSH_CHUNK);
      const placeholders = chunk.map(() => `(${valSql})`).join(", ");
      await prisma.$executeRawUnsafe(
        `INSERT INTO ${prismaTable} (${colSql}) VALUES ${placeholders}
         ON CONFLICT (id) DO UPDATE SET ${setSql}`,
        ...chunk.flatMap((u) => u.data),
      );
      applied += chunk.length;
    }
  }
  for (const id of deletes) {
    await prisma.$executeRawUnsafe(`DELETE FROM ${prismaTable} WHERE id = ?`, id);
    applied++;
  }
  return applied;
}

async function pushDailyRecommendationRuns(db: Database, rows: OutboxRow[]): Promise<number> {
  const cols: GenCol[] = [
    { sql: "id", val: (m) => String(sv(m.id) ?? "") },
    { sql: '"runDate"', val: (m) => sv(m.run_date) },
    { sql: "status", val: (m) => String(sv(m.status) ?? "completed") },
    { sql: '"triggeredBy"', val: (m) => String(sv(m.triggered_by) ?? "system") },
    { sql: '"totalScreeners"', val: (m) => Number(sv(m.total_screeners) ?? 0) },
    { sql: '"successfulScreeners"', val: (m) => Number(sv(m.successful_screeners) ?? 0) },
    { sql: '"totalStocks"', val: (m) => Number(sv(m.total_stocks) ?? 0) },
    { sql: '"uniqueStocks"', val: (m) => Number(sv(m.unique_stocks) ?? 0) },
    { sql: '"aiProcessed"', val: (m) => Number(sv(m.ai_processed) ?? 0) },
    { sql: '"aiFailed"', val: (m) => Number(sv(m.ai_failed) ?? 0) },
    { sql: '"executionTimeMs"', val: (m) => sv(m.execution_time_ms) },
    { sql: '"errorMessage"', val: (m) => sv(m.error_message) },
    { sql: "metadata", json: true, val: (m) => sv(m.metadata) },
    { sql: '"createdAt"', val: (m) => sv(m.created_at) },
    { sql: '"completedAt"', val: (m) => sv(m.completed_at) },
  ];
  return pushByIdUpsert(db, "daily_recommendation_run", "daily_recommendation_runs", cols, rows);
}

async function pushDailyRecommendationStocks(db: Database, rows: OutboxRow[]): Promise<number> {
  const cols: GenCol[] = [
    { sql: "id", val: (m) => String(sv(m.id) ?? "") },
    { sql: '"runId"', val: (m) => String(sv(m.run_id) ?? "") },
    { sql: '"trackerId"', val: (m) => sv(m.tracker_id) },
    { sql: "symbol", val: (m) => String(sv(m.symbol) ?? "").toUpperCase() },
    { sql: "price", val: (m) => sv(m.price) },
    { sql: "change", val: (m) => sv(m.change_val) },
    { sql: '"changePercent"', val: (m) => sv(m.change_percent) },
    { sql: "volume", val: (m) => Number(sv(m.volume) ?? 0) },
    { sql: '"screenerAttribution"', json: true, val: (m) => sv(m.screener_attribution) },
    { sql: '"screenerCount"', val: (m) => Number(sv(m.screener_count) ?? 0) },
    { sql: '"aiRecommendation"', val: (m) => sv(m.ai_recommendation) },
    { sql: "confidence", val: (m) => sv(m.confidence) },
    { sql: '"targetPrice"', val: (m) => sv(m.target_price) },
    { sql: '"stopLoss"', val: (m) => sv(m.stop_loss) },
    { sql: '"timeHorizon"', val: (m) => sv(m.time_horizon) },
    { sql: "reasoning", val: (m) => sv(m.reasoning) },
    { sql: '"riskFactors"', json: true, val: (m) => sv(m.risk_factors) },
    { sql: '"aiTokensUsed"', val: (m) => Number(sv(m.ai_tokens_used) ?? 0) },
    { sql: '"aiExecutionMs"', val: (m) => Number(sv(m.ai_execution_ms) ?? 0) },
    { sql: '"aiSuccess"', bool: true, val: (m) => (sv(m.ai_success) === 1 || sv(m.ai_success) === "1" ? 1 : 0) },
    { sql: '"aiError"', val: (m) => sv(m.ai_error) },
    { sql: '"createdAt"', val: (m) => sv(m.created_at) },
  ];
  return pushByIdUpsert(db, "daily_recommendation_stock", "daily_recommendation_stocks", cols, rows);
}

async function pushRecommendationTrackers(db: Database, rows: OutboxRow[]): Promise<number> {
  const cols: GenCol[] = [
    { sql: "id", val: (m) => String(sv(m.id) ?? "") },
    { sql: "symbol", val: (m) => String(sv(m.symbol) ?? "").toUpperCase() },
    { sql: "status", val: (m) => String(sv(m.status) ?? "tracking") },
    { sql: '"entryPrice"', val: (m) => sv(m.entry_price) },
    { sql: '"currentPrice"', val: (m) => sv(m.current_price) },
    { sql: '"targetPrice"', val: (m) => sv(m.target_price) },
    { sql: '"stopLoss"', val: (m) => sv(m.stop_loss) },
    { sql: '"timeHorizon"', val: (m) => sv(m.time_horizon) },
    { sql: "confidence", val: (m) => sv(m.confidence) },
    { sql: '"aiRecommendation"', val: (m) => sv(m.ai_recommendation) },
    { sql: "reasoning", val: (m) => sv(m.reasoning) },
    { sql: '"riskFactors"', json: true, val: (m) => sv(m.risk_factors) },
    { sql: '"screenerAttribution"', json: true, val: (m) => sv(m.screener_attribution) },
    { sql: '"lastCheckedAt"', val: (m) => sv(m.last_checked_at) },
    { sql: '"createdAt"', val: (m) => sv(m.created_at) },
    { sql: '"updatedAt"', val: (m) => sv(m.updated_at) },
  ];
  return pushByIdUpsert(db, "recommendation_tracker", "recommendation_trackers", cols, rows);
}

async function pushRecommendationStatusHistory(db: Database, rows: OutboxRow[]): Promise<number> {
  const cols: GenCol[] = [
    { sql: "id", val: (m) => String(sv(m.id) ?? "") },
    { sql: '"trackerId"', val: (m) => String(sv(m.tracker_id) ?? "") },
    { sql: '"previousStatus"', val: (m) => sv(m.previous_status) },
    { sql: '"newStatus"', val: (m) => String(sv(m.new_status) ?? "") },
    { sql: '"triggerSource"', val: (m) => String(sv(m.trigger_source) ?? "cron_check") },
    { sql: "metadata", json: true, val: (m) => sv(m.metadata) },
    { sql: '"createdAt"', val: (m) => sv(m.created_at) },
  ];
  return pushByIdUpsert(db, "recommendation_status_history", "recommendation_status_history", cols, rows);
}

async function pushRecommendationArchives(db: Database, rows: OutboxRow[]): Promise<number> {
  const cols: GenCol[] = [
    { sql: "id", val: (m) => String(sv(m.id) ?? "") },
    { sql: "symbol", val: (m) => String(sv(m.symbol) ?? "").toUpperCase() },
    { sql: '"trackerId"', val: (m) => String(sv(m.tracker_id) ?? "") },
    { sql: '"lastRunId"', val: (m) => sv(m.last_run_id) },
    { sql: '"runDate"', val: (m) => sv(m.run_date) },
    { sql: '"entryPrice"', val: (m) => sv(m.entry_price) },
    { sql: '"currentPrice"', val: (m) => sv(m.current_price) },
    { sql: '"targetPrice"', val: (m) => sv(m.target_price) },
    { sql: '"stopLoss"', val: (m) => sv(m.stop_loss) },
    { sql: "category", val: (m) => sv(m.category) },
    { sql: '"aiRecommendation"', val: (m) => sv(m.ai_recommendation) },
    { sql: "confidence", val: (m) => sv(m.confidence) },
    { sql: "reasoning", val: (m) => sv(m.reasoning) },
    { sql: '"riskFactors"', json: true, val: (m) => sv(m.risk_factors) },
    { sql: '"screenerAttribution"', json: true, val: (m) => sv(m.screener_attribution) },
    { sql: '"finalStatus"', val: (m) => String(sv(m.final_status) ?? "archived") },
    { sql: '"returnPercent"', val: (m) => sv(m.return_percent) },
    { sql: '"daysTracked"', val: (m) => Number(sv(m.days_tracked) ?? 0) },
    { sql: '"statusHistory"', json: true, val: (m) => sv(m.status_history) },
    { sql: '"archivedReason"', val: (m) => String(sv(m.archived_reason) ?? "age_360d") },
    { sql: '"archivedAt"', val: (m) => sv(m.archived_at) },
  ];
  return pushByIdUpsert(db, "recommendation_archive", "recommendation_archives", cols, rows);
}

async function pushSwingAnalysisJobs(db: Database, rows: OutboxRow[]): Promise<number> {
  const cols: GenCol[] = [
    { sql: "id", val: (m) => String(sv(m.id) ?? "") },
    { sql: "status", val: (m) => String(sv(m.status) ?? "pending") },
    { sql: "payload", json: true, val: (m) => sv(m.payload) },
    { sql: '"generatedAt"', val: (m) => sv(m.generated_at) },
    { sql: '"startedAt"', val: (m) => sv(m.started_at) },
    { sql: '"completedAt"', val: (m) => sv(m.completed_at) },
    { sql: "error", val: (m) => sv(m.error) },
    { sql: '"stockCount"', val: (m) => sv(m.stock_count) },
    { sql: '"analyzedCount"', val: (m) => sv(m.analyzed_count) },
    { sql: '"attemptCount"', val: (m) => sv(m.attempt_count) },
    { sql: '"templateCount"', val: (m) => sv(m.template_count) },
    { sql: '"totalRaw"', val: (m) => sv(m.total_raw) },
    { sql: '"createdAt"', val: (m) => sv(m.created_at) },
    { sql: '"updatedAt"', val: (m) => sv(m.updated_at) },
  ];
  return pushByIdUpsert(db, "swing_analysis_job", "swing_analysis_jobs", cols, rows);
}

async function pushSwingSignals(db: Database, rows: OutboxRow[]): Promise<number> {
  const cols: GenCol[] = [
    { sql: "id", val: (m) => String(sv(m.id) ?? "") },
    { sql: '"jobId"', val: (m) => String(sv(m.job_id) ?? "") },
    { sql: "symbol", val: (m) => String(sv(m.symbol) ?? "").toUpperCase() },
    { sql: "name", val: (m) => sv(m.name) },
    { sql: "price", val: (m) => sv(m.price) },
    { sql: "change", val: (m) => sv(m.change) },
    { sql: '"changePercent"', val: (m) => sv(m.change_percent) },
    { sql: "volume", val: (m) => sv(m.volume) },
    { sql: '"marketCap"', val: (m) => sv(m.market_cap) },
    { sql: '"screenerNames"', arr: true, val: (m) => toPgArrayLiteral(m.screener_names) },
    { sql: '"screenerCount"', val: (m) => sv(m.screener_count) },
    { sql: "families", arr: true, val: (m) => toPgArrayLiteral(m.families) },
    { sql: '"templateIds"', arr: true, val: (m) => toPgArrayLiteral(m.template_ids) },
    { sql: "source", val: (m) => String(sv(m.source) ?? "chartink") },
    { sql: "indicators", json: true, val: (m) => sv(m.indicators) },
    { sql: '"momentumScore"', val: (m) => sv(m.momentum_score) },
    { sql: "analysis", json: true, val: (m) => sv(m.analysis) },
    { sql: '"aiRecommendation"', val: (m) => sv(m.ai_recommendation) },
    { sql: "confidence", val: (m) => sv(m.confidence) },
    { sql: '"targetPrice"', val: (m) => sv(m.target_price) },
    { sql: '"stopLoss"', val: (m) => sv(m.stop_loss) },
    { sql: '"currentPrice"', val: (m) => sv(m.current_price) },
    { sql: '"returnPercent"', val: (m) => sv(m.return_percent) },
    { sql: "status", val: (m) => String(sv(m.status) ?? "tracking") },
    { sql: '"lastCheckedAt"', val: (m) => sv(m.last_checked_at) },
    { sql: '"postedAt"', val: (m) => sv(m.posted_at) },
    { sql: '"createdAt"', val: (m) => sv(m.created_at) },
    { sql: '"updatedAt"', val: (m) => sv(m.updated_at) },
  ];
  return pushByIdUpsert(db, "swing_signal", "swing_signals", cols, rows);
}

/** Apply one mirror table's drained outbox slice to Prisma. Returns the
 *  number of outbox rows consumed (rows that should be removed from the
 *  outbox). Throws on a table-level failure so the caller retains the rows. */
export async function pushTable(db: Database, tableName: string, rows: OutboxRow[]): Promise<number> {
  if (!rows.length) return 0;
  switch (tableName) {
    case "symbols":
      return pushSymbols(db, rows);
    case "daily_price":
      return pushDailyPrice(db, rows);
    case "corporate_action":
      return pushCorporateActions(db, rows);
    case "chartink_screener_result":
      return pushChartinkResults(db, rows);
    // Plan 09 Phase 6 — recommendation / swing / perf job tables.
    case "daily_recommendation_run":
      return pushDailyRecommendationRuns(db, rows);
    case "daily_recommendation_stock":
      return pushDailyRecommendationStocks(db, rows);
    case "recommendation_tracker":
      return pushRecommendationTrackers(db, rows);
    case "recommendation_status_history":
      return pushRecommendationStatusHistory(db, rows);
    case "recommendation_archive":
      return pushRecommendationArchives(db, rows);
    case "swing_analysis_job":
      return pushSwingAnalysisJobs(db, rows);
    case "swing_signal":
      return pushSwingSignals(db, rows);
    default:
      throw new Error(`lib/sqlitePushSinks: no sink for table "${tableName}"`);
  }
}