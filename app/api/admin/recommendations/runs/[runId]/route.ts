import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

export const runtime = "nodejs";

// GET /api/admin/recommendations/runs/[runId] — Get run details with stocks
export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
    }

    const { runId } = await params;

    const run = await prisma.dailyRecommendationRun.findUnique({
      where: { id: runId },
      include: {
        stocks: {
          orderBy: { screenerCount: "desc" },
        },
      },
    });

    if (!run) {
      return NextResponse.json({ success: false, error: "Run not found" }, { status: 404 });
    }

    // Cast to access optional error field that may not be in the Prisma type
    const runAny = run as typeof run & { error?: string | null };

    return NextResponse.json({
      success: true,
      run: {
        id: runAny.id,
        runDate: runAny.runDate,
        status: runAny.status,
        totalScreeners: runAny.totalScreeners,
        uniqueStocks: runAny.uniqueStocks,
        aiProcessed: runAny.aiProcessed,
        executionTimeMs: runAny.executionTimeMs,
        error: runAny.error || null,
      },
      stocks: run.stocks.map(s => ({
        id: s.id,
        symbol: s.symbol,
        price: s.price,
        change: s.change,
        changePercent: s.changePercent,
        volume: s.volume ? Number(s.volume) : null,
        screenerAttribution: s.screenerAttribution,
        screenerCount: s.screenerCount,
        aiRecommendation: s.aiRecommendation,
        confidence: s.confidence,
        targetPrice: s.targetPrice,
        stopLoss: s.stopLoss,
        timeHorizon: s.timeHorizon,
        reasoning: s.reasoning,
        riskFactors: s.riskFactors,
        createdAt: s.createdAt,
      })),
    });
  } catch (error) {
    logger.error({ msg: "Failed to fetch run details", error });
    return NextResponse.json({ success: false, error: "Failed to fetch run details" }, { status: 500 });
  }
}

// DELETE /api/admin/recommendations/runs/[runId] — Delete a run and its stocks, or a single stock if stockId provided
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
    }

    const { runId } = await params;

    // Check if deleting a single stock
    let stockId: string | undefined;
    try {
      const body = await request.json();
      stockId = body?.stockId;
    } catch { /* no body */ }

    if (stockId) {
      // Delete single stock
      const stock = await prisma.dailyRecommendationStock.findFirst({
        where: { id: stockId, runId },
      });
      if (!stock) {
        return NextResponse.json({ success: false, error: "Stock not found in this run" }, { status: 404 });
      }
      await prisma.dailyRecommendationStock.delete({ where: { id: stockId } });
      logger.info({ msg: "Stock deleted from run", stockId, symbol: stock.symbol, runId });
      return NextResponse.json({ success: true });
    }

    // Delete entire run and its stocks
    await prisma.dailyRecommendationStock.deleteMany({
      where: { runId },
    });

    await prisma.dailyRecommendationRun.delete({
      where: { id: runId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ msg: "Failed to delete", error });
    return NextResponse.json({ success: false, error: "Failed to delete" }, { status: 500 });
  }
}

// PUT /api/admin/recommendations/runs/[runId] — Update a stock recommendation within a run
// Body: { stockId, updates: { aiRecommendation?, confidence?, targetPrice?, stopLoss?, reasoning? } }
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
    }

    const { runId } = await params;
    const body = await request.json();
    const { stockId, updates } = body;

    if (!stockId || !updates) {
      return NextResponse.json({ success: false, error: "stockId and updates are required" }, { status: 400 });
    }

    // Verify the stock belongs to this run
    const stock = await prisma.dailyRecommendationStock.findFirst({
      where: { id: stockId, runId },
    });

    if (!stock) {
      return NextResponse.json({ success: false, error: "Stock not found in this run" }, { status: 404 });
    }

    // Build update data from allowed fields
    const allowedFields = ["aiRecommendation", "confidence", "targetPrice", "stopLoss", "reasoning", "timeHorizon"];
    const updateData: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        updateData[field] = updates[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ success: false, error: "No valid fields to update" }, { status: 400 });
    }

    const updated = await prisma.dailyRecommendationStock.update({
      where: { id: stockId },
      data: updateData,
    });

    logger.info({ msg: "Stock recommendation updated", stockId, symbol: updated.symbol, fields: Object.keys(updateData) });

    return NextResponse.json({
      success: true,
      stock: {
        id: updated.id,
        symbol: updated.symbol,
        aiRecommendation: updated.aiRecommendation,
        confidence: updated.confidence,
        targetPrice: updated.targetPrice,
        stopLoss: updated.stopLoss,
        reasoning: updated.reasoning,
        timeHorizon: updated.timeHorizon,
      },
    });
  } catch (error) {
    logger.error({ msg: "Failed to update stock recommendation", error });
    return NextResponse.json({ success: false, error: "Failed to update stock" }, { status: 500 });
  }
}
