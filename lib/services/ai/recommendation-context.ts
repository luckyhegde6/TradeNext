/**
 * Recommendation Context Enrichment (v3.6.1)
 *
 * Supplies fundamental context for the daily recommendation agent's batch
 * stock analysis. For each symbol being analyzed it gathers:
 *   1. Corporate actions (DB `CorporateAction`) — dividends, splits, bonuses,
 *      rights, buybacks with upcoming ex-dates.
 *   2. Corporate announcements (DB `CorporateAnnouncement`) — latest NSE
 *      exchanges (broadcast) news per symbol.
 *   3. Financial results (NSE, cached 1h via `getCorporateResults`) — latest
 *      quarterly result snapshot (revenue, net profit, YoY/QoQ) from the
 *      single `corporates-financial-results?index=equities` payload.
 *
 * All DB lookups are batched (`symbol IN (...)`) — never N+1. Every source is
 * best-effort with graceful fallback: a failure in one source drops only that
 * source's context; the pipeline continues with what it has.
 *
 * The returned map is a plain `Record<string, StockContext>` keyed by the
 * caller's symbol casing, so callers can look up context with their own
 * symbols without normalization surprises.
 *
 * @module recommendation-context
 */

import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { getCorporateResults } from "@/lib/index-service";

// ─── Types ───────────────────────────────────────────────────────────────

export interface CorporateActionContext {
  actionType: string;
  subject: string | null;
  exDate: string | null; // ISO date
  ratio: string | null;
}

export interface AnnouncementContext {
  subject: string;
  broadcastDateTime: string; // ISO date
}

export interface FinancialResultContext {
  period: string;
  revenue: number | null;
  netProfit: number | null;
  yoy: number | null;
  qoq: number | null;
}

export interface StockContext {
  corporateActions: CorporateActionContext[];
  announcements: AnnouncementContext[];
  financialResults: FinancialResultContext[];
}

export type RecommendationContextMap = Record<string, StockContext>;

// ─── Limits (keep the AI prompt bounded) ─────────────────────────────────

/** Max corporate actions included per symbol. */
const MAX_ACTIONS_PER_SYMBOL = 3;
/** Max announcements included per symbol. */
const MAX_ANNOUNCEMENTS_PER_SYMBOL = 2;
/** Max financial-result periods included per symbol. */
const MAX_RESULTS_PER_SYMBOL = 1;

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Build a per-symbol context map for the given symbols, batched and cached.
 *
 * - Corporate actions + announcements come from the local DB (one findMany
 *   each with `symbol IN (...)`).
 * - Financial results come from NSE's single quarterly payload (already
 *   cached 1h by `getCorporateResults`); the call happens ONCE for the whole
 *   batch regardless of symbol count.
 *
 * Never throws — on any internal failure it returns an empty map so the
 * recommendation pipeline is never blocked by context enrichment.
 */
export async function getRecommendationContext(
  symbols: string[],
): Promise<RecommendationContextMap> {
  const map: RecommendationContextMap = {};

  if (symbols.length === 0) return map;

  // Normalize lookups to uppercase; keys stay as caller-provided.
  const upperSymbols = [...new Set(symbols.map((s) => s.toUpperCase()))];

  const [actions, announcements, results] = await Promise.allSettled([
    fetchCorporateActions(upperSymbols),
    fetchAnnouncements(upperSymbols),
    fetchFinancialResults(upperSymbols),
  ]);

  const actionMap = actions.status === "fulfilled" ? actions.value : {};
  const announcementMap =
    announcements.status === "fulfilled" ? announcements.value : {};
  const resultsMap = results.status === "fulfilled" ? results.value : {};

  for (const symbol of symbols) {
    const upper = symbol.toUpperCase();
    const corporateActions = actionMap[upper] ?? [];
    const announcementList = announcementMap[upper] ?? [];
    const financialResults = resultsMap[upper] ?? [];

    // Only attach a symbol entry when there is at least one piece of context.
    if (
      corporateActions.length > 0 ||
      announcementList.length > 0 ||
      financialResults.length > 0
    ) {
      map[symbol] = { corporateActions, announcements: announcementList, financialResults };
    }
  }

  return map;
}

/** Render a symbol's context as a compact prompt block. */
export function formatStockContext(symbol: string, ctx: StockContext): string {
  const lines: string[] = [];

  if (ctx.corporateActions.length > 0) {
    lines.push("Corporate actions:");
    for (const a of ctx.corporateActions) {
      lines.push(
        `  - ${a.actionType}${a.subject ? `: ${a.subject}` : ""}${a.exDate ? ` (ex-date ${a.exDate.slice(0, 10)})` : ""}${a.ratio ? `, ratio ${a.ratio}` : ""}`,
      );
    }
  }

  if (ctx.announcements.length > 0) {
    lines.push("Recent announcements:");
    for (const ann of ctx.announcements) {
      lines.push(
        `  - ${ann.subject} (${new Date(ann.broadcastDateTime).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })})`,
      );
    }
  }

  if (ctx.financialResults.length > 0) {
    lines.push("Latest quarterly results:");
    for (const r of ctx.financialResults) {
      const parts = [`period ${r.period}`];
      if (r.revenue != null) parts.push(`revenue ₹${formatCrores(r.revenue)}`);
      if (r.netProfit != null) parts.push(`net profit ₹${formatCrores(r.netProfit)}`);
      if (r.yoy != null) parts.push(`YoY ${r.yoy >= 0 ? "+" : ""}${r.yoy}%`);
      if (r.qoq != null) parts.push(`QoQ ${r.qoq >= 0 ? "+" : ""}${r.qoq}%`);
      lines.push(`  - ${parts.join(", ")}`);
    }
  }

  return lines.join("\n");
}

// ─── Internal fetchers (batched, best-effort) ────────────────────────────

async function fetchCorporateActions(
  symbols: string[],
): Promise<Record<string, CorporateActionContext[]>> {
  try {
    const rows = await prisma.corporateAction.findMany({
      where: { symbol: { in: symbols } },
      orderBy: { exDate: "desc" },
      select: {
        symbol: true,
        actionType: true,
        subject: true,
        exDate: true,
        ratio: true,
      },
    });

    const bySymbol: Record<string, CorporateActionContext[]> = {};
    for (const row of rows) {
      const key = row.symbol.toUpperCase();
      if ((bySymbol[key]?.length ?? 0) >= MAX_ACTIONS_PER_SYMBOL) continue;
      (bySymbol[key] ??= []).push({
        actionType: row.actionType,
        subject: row.subject,
        exDate: row.exDate ? row.exDate.toISOString() : null,
        ratio: row.ratio,
      });
    }
    return bySymbol;
  } catch (error) {
    logger.warn({
      msg: "Corporate-actions context fetch failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

async function fetchAnnouncements(
  symbols: string[],
): Promise<Record<string, AnnouncementContext[]>> {
  try {
    const rows = await prisma.corporateAnnouncement.findMany({
      where: { symbol: { in: symbols } },
      orderBy: { broadcastDateTime: "desc" },
      select: {
        symbol: true,
        subject: true,
        broadcastDateTime: true,
      },
    });

    const bySymbol: Record<string, AnnouncementContext[]> = {};
    for (const row of rows) {
      const key = row.symbol.toUpperCase();
      if ((bySymbol[key]?.length ?? 0) >= MAX_ANNOUNCEMENTS_PER_SYMBOL) continue;
      (bySymbol[key] ??= []).push({
        subject: row.subject,
        broadcastDateTime: row.broadcastDateTime.toISOString(),
      });
    }
    return bySymbol;
  } catch (error) {
    logger.warn({
      msg: "Announcements context fetch failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

async function fetchFinancialResults(
  symbols: string[],
): Promise<Record<string, FinancialResultContext[]>> {
  try {
    // One cached NSE call for the whole batch (1h TTL inside getCorporateResults).
    const results = await getCorporateResults("Quarterly");
    if (!Array.isArray(results)) return {};

    const symbolSet = new Set(symbols);
    const bySymbol: Record<string, FinancialResultContext[]> = {};

    for (const row of results as Record<string, unknown>[]) {
      const symbol = typeof row.symbol === "string" ? row.symbol.toUpperCase() : "";
      if (!symbolSet.has(symbol)) continue;
      if ((bySymbol[symbol]?.length ?? 0) >= MAX_RESULTS_PER_SYMBOL) continue;

      (bySymbol[symbol] ??= []).push({
        period: typeof row.period === "string" ? row.period : "Quarterly",
        revenue: toNumberOrNull(row.sales ?? row.revenue),
        netProfit: toNumberOrNull(row.np ?? row.profitAfterTax),
        yoy: toNumberOrNull(row.yoy),
        qoq: toNumberOrNull(row.qoq),
      });
    }
    return bySymbol;
  } catch (error) {
    logger.warn({
      msg: "Financial-results context fetch failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = parseFloat(value.replace(/[₹,%]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** NSE results are in lakhs (₹ varies by field) — render in crores. */
function formatCrores(value: number): string {
  const crores = value / 1e7;
  return `${crores >= 100 ? crores.toFixed(0) : crores.toFixed(2)} Cr`;
}