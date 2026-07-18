import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getPositions,
  createPosition,
  getPortfolioSummary,
} from "@/lib/services/foService";
import { computePnL } from "@/lib/services/foPnlService";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * GET /api/fo/positions — List user's F&O positions
 * Query: ?status=OPEN&symbol=NIFTY
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = Number(session.user.id);
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || undefined;
    const symbol = searchParams.get("symbol") || undefined;

    const positions = await getPositions(userId, { status, symbol } as any);
    const summary = await getPortfolioSummary(userId);
    const computed = computePnL(positions);

    return NextResponse.json({ positions, computed, summary });
  } catch (err) {
    logger.error({ msg: "Failed to list F&O positions", error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/fo/positions — Create a new F&O position
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = Number(session.user.id);
    const body = await req.json();

    if (!body.symbol || !body.type || !body.direction || !body.quantity || !body.entryPrice) {
      return NextResponse.json(
        { error: "Missing required fields: symbol, type, direction, quantity, entryPrice" },
        { status: 400 }
      );
    }

    if (!["FUTURES", "CALL", "PUT"].includes(body.type)) {
      return NextResponse.json({ error: "Invalid type. Must be FUTURES, CALL, or PUT" }, { status: 400 });
    }
    if (!["LONG", "SHORT"].includes(body.direction)) {
      return NextResponse.json({ error: "Invalid direction. Must be LONG or SHORT" }, { status: 400 });
    }

    const position = await createPosition(userId, body);
    return NextResponse.json({ position }, { status: 201 });
  } catch (err) {
    logger.error({ msg: "Failed to create F&O position", error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
