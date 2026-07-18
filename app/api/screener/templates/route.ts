import { NextResponse } from "next/server";
import { SCREENER_TEMPLATES, searchTemplates, getTemplatesByCategory } from "@/lib/screener/screener-templates";

export const dynamic = 'force-dynamic';

/**
 * GET /api/screener/templates
 *
 * List available screener preset templates.
 * Query params:
 *   category: string  — filter by category
 *   search: string    — search by name/description
 *
 * Returns: { templates: ScreenerTemplate[] }
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const query = searchParams.get("search");

  let templates = SCREENER_TEMPLATES;

  if (category) {
    templates = getTemplatesByCategory(category as any);
  }

  if (query) {
    templates = searchTemplates(query);
  }

  return NextResponse.json({
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      timeframe: t.timeframe,
      popularity: t.popularity,
    })),
    total: templates.length,
  });
}
