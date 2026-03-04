import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { createAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

const watchlistSchema = z.object({
  name: z.string().min(1).max(100),
});

const watchlistItemSchema = z.object({
  watchlistId: z.string().uuid(),
  symbol: z.string().min(1).max(20),
});

export async function GET() {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = Number(session.user.id);

    const watchlists = await prisma.watchlist.findMany({
      where: { userId },
      include: {
        items: {
          orderBy: { addedAt: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ watchlists });
  } catch (error) {
    console.error("User watchlist GET error:", error);
    return NextResponse.json({ error: "Failed to fetch watchlists" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = Number(session.user.id);
    const body = await req.json();
    const { name } = watchlistSchema.parse(body);

    const watchlist = await prisma.watchlist.create({
      data: {
        userId,
        name,
      },
      include: {
        items: true,
      },
    });

    await createAuditLog({
      userId,
      action: 'WATCHLIST_CREATE',
      resource: 'Watchlist',
      resourceId: watchlist.id,
      metadata: { name }
    });

    return NextResponse.json(watchlist, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: error.issues }, { status: 400 });
    }
    console.error("User watchlist POST error:", error);
    return NextResponse.json({ error: "Failed to create watchlist" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = Number(session.user.id);
    const body = await req.json();
    const { id, name } = body;

    if (!id) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 });
    }

    const watchlist = await prisma.watchlist.update({
      where: { id, userId },
      data: { name },
      include: {
        items: true,
      },
    });

    await createAuditLog({
      userId,
      action: 'WATCHLIST_UPDATE',
      resource: 'Watchlist',
      resourceId: id,
      metadata: { name }
    });

    return NextResponse.json(watchlist);
  } catch (error) {
    console.error("User watchlist PUT error:", error);
    return NextResponse.json({ error: "Failed to update watchlist" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = Number(session.user.id);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 });
    }

    await prisma.watchlist.delete({
      where: { id, userId },
    });

    await createAuditLog({
      userId,
      action: 'WATCHLIST_DELETE',
      resource: 'Watchlist',
      resourceId: id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("User watchlist DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete watchlist" }, { status: 500 });
  }
}
