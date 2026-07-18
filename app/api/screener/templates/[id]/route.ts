import { NextResponse } from "next/server";
import { getTemplateById } from "@/lib/screener/screener-templates";

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

/**
 * GET /api/screener/templates/:id
 *
 * Get a specific screener template by ID, including its FilterGroup.
 *
 * Returns: { template: ScreenerTemplate }
 */
export async function GET(
  _req: Request,
  { params }: { params: Params }
) {
  const { id } = await params;

  const template = getTemplateById(id);

  if (!template) {
    return NextResponse.json(
      { error: "Template not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    template: {
      id: template.id,
      name: template.name,
      description: template.description,
      category: template.category,
      timeframe: template.timeframe,
      popularity: template.popularity,
    },
    filterGroup: template.filterGroup,
  });
}
