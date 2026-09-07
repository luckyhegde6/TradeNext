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
    default:
      throw new Error(`lib/sqlitePushSinks: no sink for table "${tableName}"`);
  }
}