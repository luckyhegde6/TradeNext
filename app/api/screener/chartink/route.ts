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
    const { template, stocks, source } = await runChartinkScreenerById(
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
    });
  } catch (error) {
    logger.error({ msg: "Chartink template run failed", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to run Chartink template" },
      { status: 500 },
    );
  }
}