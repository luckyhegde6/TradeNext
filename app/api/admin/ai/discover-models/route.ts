import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import logger from "@/lib/logger";

export const runtime = "nodejs";

interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  pricing: { prompt: string; completion: string; image?: string; request?: string };
  context_length?: number;
  top_provider?: { max_completion_tokens?: number; is_moderated?: boolean };
  architecture?: { modality?: string; tokenizer?: string };
}

interface DiscoveredModel {
  id: string;
  name: string;
  description: string;
  contextLength: number;
  promptPrice: string;
  completionPrice: string;
  isFree: boolean;
  modality: string;
}

/**
 * GET /api/admin/ai/discover-models
 *
 * Fetch available models from OpenRouter API, filter and sort by various criteria.
 * Auth: Admin only.
 *
 * Query params:
 *   sort=free | pricing | latency | newest | top
 *   search=<query>         — filter by name/id
 *   freeOnly=true          — only free models
 *   limit=50               — max results (default 50, max 200)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const sort = searchParams.get("sort") || "free";
    const search = searchParams.get("search") || "";
    const freeOnly = searchParams.get("freeOnly") === "true";
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);

    // Fetch from OpenRouter API
    const apiKey = process.env.OPENROUTERKEY || process.env.OPENROUTER_API_KEY || "";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers,
      next: { revalidate: 300 }, // Cache for 5 minutes
    });

    if (!response.ok) {
      logger.error({ msg: "OpenRouter API error", status: response.status });
      return NextResponse.json(
        { error: `OpenRouter API returned ${response.status}` },
        { status: 502 }
      );
    }

    const data = await response.json();
    const models: OpenRouterModel[] = data.data || [];

    // Transform and filter
    let discovered: DiscoveredModel[] = models.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description || "",
      contextLength: m.context_length || 0,
      promptPrice: m.pricing?.prompt || "0",
      completionPrice: m.pricing?.completion || "0",
      isFree:
        m.pricing?.prompt === "0" && m.pricing?.completion === "0",
      modality: m.architecture?.modality || "unknown",
    }));

    // Filter by search
    if (search) {
      const q = search.toLowerCase();
      discovered = discovered.filter(
        (m) =>
          m.id.toLowerCase().includes(q) ||
          m.name.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q)
      );
    }

    // Filter free only
    if (freeOnly) {
      discovered = discovered.filter((m) => m.isFree);
    }

    // Sort
    switch (sort) {
      case "free":
        discovered.sort((a, b) => {
          if (a.isFree !== b.isFree) return a.isFree ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        break;
      case "pricing":
        discovered.sort((a, b) => {
          const aPrice = parseFloat(a.promptPrice) || 0;
          const bPrice = parseFloat(b.promptPrice) || 0;
          return aPrice - bPrice;
        });
        break;
      case "newest":
        // OpenRouter doesn't have a creation date; reverse order (newest first in API)
        discovered.reverse();
        break;
      case "top":
        // Move models with :free suffix and high context to top
        discovered.sort((a, b) => {
          const aScore = (a.isFree ? 1000 : 0) + a.contextLength / 1000;
          const bScore = (b.isFree ? 1000 : 0) + b.contextLength / 1000;
          return bScore - aScore;
        });
        break;
      case "latency":
        // Sort by prompt price as proxy (lower = faster/cheaper)
        discovered.sort((a, b) => {
          const aP = parseFloat(a.promptPrice) || 0;
          const bP = parseFloat(b.promptPrice) || 0;
          return aP - bP;
        });
        break;
    }

    // Limit
    const result = discovered.slice(0, limit);

    logger.info({
      msg: "OpenRouter model discovery",
      total: models.length,
      filtered: discovered.length,
      returned: result.length,
      sort,
      freeOnly,
    });

    return NextResponse.json({
      models: result,
      total: models.length,
      filtered: discovered.length,
      returned: result.length,
      sort,
      freeOnly,
    });
  } catch (err) {
    logger.error({
      msg: "Failed to discover OpenRouter models",
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Failed to fetch models from OpenRouter" },
      { status: 500 }
    );
  }
}
