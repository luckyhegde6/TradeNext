import { NextResponse } from "next/server";
import logger from "@/lib/logger";
import {
  getChartinkCategories,
  getChartinkTemplates,
} from "@/lib/services/chartinkTemplates";
import {
  getChartinkScreeners,
  type ChartinkScreenerOverview,
} from "@/lib/services/chartinkScreenerService";
import {
  runChartinkScreenerById,
} from "@/lib/services/chartinkUnifiedScreenerService";
import { getSqliteFallback } from "@/lib/sqlite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/screener/chartink
 *
 * List the full Chartink template registry (117) merged with per-template DB
 * run metadata. Each entry reports whether the template is fetchable (has a
 * scan clause), when it was last captured, and whether captured rows are
 * stale (72h TTL).
 *
 * Response: {
 *   categories: [{ id, name, count, fetchableCount }],
 *   templates: [{
 *     id, name, url, categoryId, categoryName,
 *     fetchable, enabled, lastRunAt, nextRunAt, resultCount, stale
 *   }]
 * }
 */
export async function GET() {
  try {
    const categories = getChartinkCategories();
    const registry = getChartinkTemplates();
    const overviews = await getChartinkScreeners();
    const overviewById = new Map<string, ChartinkScreenerOverview>(
      overviews.map((o) => [o.id, o]),
    );

    const templates = registry.map((t) => {
      const ov = overviewById.get(t.id);
      return {
        id: t.id,
        name: t.name,
        url: t.url,
        categoryId: t.categoryId,
        categoryName: categories.find((c) => c.id === t.categoryId)?.name ?? t.categoryId,
        fetchable: !!t.scanClause,
        enabled: ov?.enabled ?? true,
        lastRunAt: ov?.lastRunAt ?? null,
        nextRunAt: ov?.nextRunAt ?? null,
        resultCount: ov?.resultCount ?? 0,
        stale: ov?.stale ?? true,
      };
    });

    return NextResponse.json({ categories, templates });
  } catch (error) {
    // --- SQLite fallback for template listing ---
    const sqlite = getSqliteFallback();
    if (sqlite?.isReady()) {
      try {
        const screeners = sqlite.getChartinkScreeners();
        if (screeners.length) {
          logger.warn({ msg: "Chartink templates: DB unavailable — serving SQLite backup" });
          // Rebuild categories from SQLite data
          const catMap = new Map<string, { id: string; name: string; count: number; fetchableCount: number }>();
          for (const s of screeners) {
            const catId = (s.category_id as string) || "uncategorized";
            const catName = (s.category_name as string) || catId;
            if (!catMap.has(catId)) catMap.set(catId, { id: catId, name: catName, count: 0, fetchableCount: 0 });
            const cat = catMap.get(catId)!;
            cat.count++;
            if (s.scan_clause) cat.fetchableCount++;
          }
          return NextResponse.json({
            categories: [...catMap.values()],
            templates: screeners.map((s) => ({
              id: s.id,
              name: s.name,
              url: s.url,
              categoryId: s.category_id,
              categoryName: s.category_name,
              fetchable: Boolean(s.scan_clause),
              enabled: s.enabled,
              lastRunAt: s.last_run_at,
              nextRunAt: s.next_run_at,
              resultCount: s.result_count ?? 0,
              stale: true,
            })),
            source: "sqlite_backup",
          });
        }
      } catch {
        // SQLite fallback itself failed — fall through to error
      }
    }
    logger.error({ msg: "Chartink template list failed", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: "Failed to list Chartink templates" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/screener/chartink
 *
 * Run a single Chartink template through the unified source chain:
 * fresh DB captured rows → live /screener/process → TradingView fallback.
 *
 * Body: { templateId: string, forceRefresh?: boolean, limit?: number }
 *
 * Response: {
 *   template: { id, name, url, categoryId },
 *   source: "chartink_db" | "chartink_live" | "tradingview",
 *   stocks: [{ symbol, name, close, changePercent, volume }]
 * }
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      templateId?: string;
      forceRefresh?: boolean;
      limit?: number;
    };

    if (!body.templateId || typeof body.templateId !== "string") {
      return NextResponse.json(
        { error: "templateId is required" },
        { status: 400 },
      );
    }

    const start = Date.now();
    const { template, stocks, source, warning } = await runChartinkScreenerById(
      body.templateId,
      {
        forceRefresh: !!body.forceRefresh,
        tvFallbackLimit: body.limit ?? 100,
      },
    );

    return NextResponse.json({
      template: {
        id: template.id,
        name: template.name,
        url: template.url,
        categoryId: template.categoryId,
      },
      source,
      stocks: stocks.map((s) => ({
        symbol: s.nse_script_code,
        name: s.name,
        close: s.close,
        changePercent: s.pChange,
        volume: s.volume,
      })),
      count: stocks.length,
      executionMs: Date.now() - start,
      ...(warning ? { warning } : {}),
    });
  } catch (error) {
    logger.error({ msg: "Chartink template run failed", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to run Chartink template" },
      { status: 500 },
    );
  }
}