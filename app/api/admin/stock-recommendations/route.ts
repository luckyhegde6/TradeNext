import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

// GET — list all stock recommendations
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    const recs = await (prisma as any).stockRecommendation.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(recs);
  } catch {
    return NextResponse.json([]);
  }
}

// POST — create
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    const body = await request.json();
    const rec = await (prisma as any).stockRecommendation.create({
      data: {
        symbol: body.symbol?.toUpperCase(),
        entryRange: body.entryRange || null,
        shortTerm: body.shortTerm || null,
        longTerm: body.longTerm || null,
        intraday: body.intraday || null,
        recommendation: body.recommendation || "HOLD",
        analystRating: body.analystRating || null,
        profitRangeMin: body.profitRangeMin ?? null,
        profitRangeMax: body.profitRangeMax ?? null,
        targetPrice: body.targetPrice ?? null,
        analysis: body.analysis || null,
        imageUrl: body.imageUrl || null,
        isActive: true,
      },
    });
    return NextResponse.json(rec);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to create";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PUT — update
export async function PUT(request: Request) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    const { id, ...data } = body;
    if (data.symbol) data.symbol = data.symbol.toUpperCase();
    const rec = await (prisma as any).stockRecommendation.update({
      where: { id },
      data,
    });
    return NextResponse.json(rec);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to update";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE — remove by ?id=
export async function DELETE(request: Request) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    await (prisma as any).stockRecommendation.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to delete";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
