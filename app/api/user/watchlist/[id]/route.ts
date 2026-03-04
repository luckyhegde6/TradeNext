import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { createAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

const watchlistItemSchema = z.object({
  symbol: z.string().min(1).max(20),
});

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = Number(session.user.id);
    const { id } = await params;

    const watchlist = await prisma.watchlist.findFirst({
      where: { id, userId },
      include: {
        items: {
          orderBy: { addedAt: "desc" },
        },
      },
    });

    if (!watchlist) {
      return NextResponse.json({ error: "Watchlist not found" }, { status: 404 });
    }

    return NextResponse.json(watchlist);
  } catch (error) {
    console.error("User watchlist item GET error:", error);
    return NextResponse.json({ error: "Failed to fetch watchlist items" }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = Number(session.user.id);
    const { id: watchlistId } = await params;
    const body = await req.json();
    const { symbol } = watchlistItemSchema.parse(body);

    const watchlist = await prisma.watchlist.findFirst({
      where: { id: watchlistId, userId },
    });

    if (!watchlist) {
      return NextResponse.json({ error: "Watchlist not found" }, { status: 404 });
    }

    const existingItem = await prisma.watchlistItem.findFirst({
      where: { watchlistId, symbol: symbol.toUpperCase() },
    });

    if (existingItem) {
      return NextResponse.json({ error: "Symbol already in watchlist" }, { status: 400 });
    }

    const item = await prisma.watchlistItem.create({
      data: {
        watchlistId,
        symbol: symbol.toUpperCase(),
      },
    });

    await createAuditLog({
      userId,
      action: 'WATCHLIST_UPDATE',
      resource: 'WatchlistItem',
      resourceId: item.id,
      metadata: { symbol: symbol.toUpperCase(), watchlistId }
    });

    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: error.issues }, { status: 400 });
    }
    console.error("User watchlist item POST error:", error);
    return NextResponse.json({ error: "Failed to add to watchlist" }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = Number(session.user.id);
    const { id: watchlistId } = await params;
    const { searchParams } = new URL(req.url);
    const itemId = searchParams.get("itemId");
    const symbol = searchParams.get("symbol");

    const watchlist = await prisma.watchlist.findFirst({
      where: { id: watchlistId, userId },
    });

    if (!watchlist) {
      return NextResponse.json({ error: "Watchlist not found" }, { status: 404 });
    }

    if (itemId) {
      await prisma.watchlistItem.delete({
        where: { id: itemId },
      });
    } else if (symbol) {
      await prisma.watchlistItem.deleteMany({
        where: { watchlistId, symbol: symbol.toUpperCase() },
      });
    } else {
      return NextResponse.json({ error: "itemId or symbol is required" }, { status: 400 });
    }

    await createAuditLog({
      userId,
      action: 'WATCHLIST_UPDATE',
      resource: 'WatchlistItem',
      metadata: { watchlistId, itemId, symbol: symbol?.toUpperCase() }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("User watchlist item DELETE error:", error);
    return NextResponse.json({ error: "Failed to remove from watchlist" }, { status: 500 });
  }
}
