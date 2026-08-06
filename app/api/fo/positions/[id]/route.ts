import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getPositionById,
  updatePosition,
  deletePosition,
  computePositionPnl,
} from "@/lib/services/foService";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * GET /api/fo/positions/[id] — Get a single position
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = Number(session.user.id);
    const { id } = await params;

    const position = await getPositionById(id, userId);
    if (!position) {
      return NextResponse.json({ error: "Position not found" }, { status: 404 });
    }

    const pnlResult = computePositionPnl(position);
    return NextResponse.json({ position, pnl: pnlResult.pnl, currentPriceUsed: pnlResult.currentPriceUsed });
  } catch (err) {
    logger.error({ msg: "Failed to get F&O position", error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PUT /api/fo/positions/[id] — Update a position (mark-to-market, close)
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = Number(session.user.id);
    const { id } = await params;
    const body = await req.json();

    const updated = await updatePosition(id, userId, body);
    if (!updated) {
      return NextResponse.json({ error: "Position not found" }, { status: 404 });
    }

    return NextResponse.json({ position: updated });
  } catch (err) {
    logger.error({ msg: "Failed to update F&O position", error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/fo/positions/[id] — Delete a position
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = Number(session.user.id);
    const { id } = await params;

    const deleted = await deletePosition(id, userId);
    if (!deleted) {
      return NextResponse.json({ error: "Position not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error({ msg: "Failed to delete F&O position", error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
