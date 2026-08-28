// app/api/company/[ticker]/intelligence/route.ts
// GET /api/company/[ticker]/intelligence — AI Investment Intelligence for a stock
// POST with { force: true } to bypass cache and regenerate

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { z } from "zod";
import { createAuditLog } from "@/lib/audit";
import { getInvestmentIntelligence } from "@/lib/services/ai/intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tickerSchema = z.string().min(1).max(20).regex(/^[A-Z0-9.]+$/i);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized", message: "Sign in to access AI intelligence" },
      { status: 401 },
    );
  }

  const { ticker } = await params;
  const parsed = tickerSchema.safeParse(ticker);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid ticker", message: parsed.error.issues[0].message },
      { status: 400 },
    );
  }

  const symbol = ticker.toUpperCase();
  const force = req.nextUrl.searchParams.get("force") === "1";

  await createAuditLog({
    action: "INTELLIGENCE_REQUESTED",
    userId: Number(session.user.id),
    metadata: { symbol, force, method: "GET" },
  });

  const result = await getInvestmentIntelligence(symbol, {
    force,
    userId: Number(session.user.id),
  });

  const statusMap: Record<string, number> = {
    cached: 200,
    generated: 200,
    failed: 500,
    quota_exhausted: 503,
    no_data: 404,
  };

  return NextResponse.json(
    {
      success: result.status === "cached" || result.status === "generated",
      status: result.status,
      symbol,
      report: result.report ?? null,
      error: result.error ?? null,
    },
    { status: statusMap[result.status] ?? 500 },
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized", message: "Sign in to access AI intelligence" },
      { status: 401 },
    );
  }

  const { ticker } = await params;
  const parsed = tickerSchema.safeParse(ticker);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid ticker", message: parsed.error.issues[0].message },
      { status: 400 },
    );
  }

  const symbol = ticker.toUpperCase();

  // POST body: { force?, documents?: { annualReport?, concall? } }
  // Documents are optional raw-text (.md/.txt) up to ~50KB each; oversized → 400.
  const postSchema = z.object({
    force: z.boolean().optional(),
    documents: z
      .object({
        annualReport: z.string().max(50_000).optional(),
        concall: z.string().max(50_000).optional(),
      })
      .optional(),
  });

  let body: z.infer<typeof postSchema> = {};
  try {
    const json = await req.json();
    const parsedBody = postSchema.safeParse(json);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "Invalid body", message: parsedBody.error.issues[0]?.message ?? "Bad request body" },
        { status: 400 },
      );
    }
    body = parsedBody.data;
  } catch {
    // Empty body is fine — defaults to force=false, no documents
  }

  const force = body.force === true;
  const hasDocs = Boolean(body.documents?.annualReport || body.documents?.concall);

  await createAuditLog({
    action: "INTELLIGENCE_REQUESTED",
    userId: Number(session.user.id),
    metadata: { symbol, force, method: "POST", hasDocuments: hasDocs },
  });

  const result = await getInvestmentIntelligence(symbol, {
    force,
    userId: Number(session.user.id),
    documents: body.documents,
  });

  const statusMap: Record<string, number> = {
    cached: 200,
    generated: 200,
    failed: 500,
    quota_exhausted: 503,
    no_data: 404,
  };

  return NextResponse.json(
    {
      success: result.status === "cached" || result.status === "generated",
      status: result.status,
      symbol,
      report: result.report ?? null,
      error: result.error ?? null,
    },
    { status: statusMap[result.status] ?? 500 },
  );
}
