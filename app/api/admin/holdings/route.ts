import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { z } from "zod";
import { randomUUID } from "crypto";
import { getSqliteFallback } from "@/lib/sqlite";

export const runtime = "nodejs";

const updateHoldingSchema = z.object({
  userId: z.number(),
  transactionId: z.string().optional(),
  ticker: z.string(),
  side: z.enum(['BUY', 'SELL']),
  quantity: z.number().positive(),
  price: z.number().positive(),
  tradeDate: z.string().transform(str => new Date(str)),
  fees: z.number().optional(),
  notes: z.string().optional(),
});

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session || !session.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    const portfolioId = searchParams.get('portfolioId');

    if (!userId && !portfolioId) {
      return NextResponse.json({ error: "userId or portfolioId is required" }, { status: 400 });
    }

    const where: any = {};
    if (userId) {
      where.portfolio = { userId: parseInt(userId) };
    }
    if (portfolioId) {
      where.portfolioId = portfolioId;
    }

    const sqlite = getSqliteFallback();
    if (sqlite) {
      // SQLite-first mirror read (Plan 09 §4.8): userId/portfolioId filters
      // applied in-memory; Prisma name/email enrichment is best-effort.
      let rows = (sqlite.getTransactions({ limit: 5000 }) as any[]).map((t) => ({
        ...t,
        userId: t.userId != null ? Number(t.userId) : null,
        portfolio: {
          id: t.portfolioId,
          name: t.portfolioName,
          user: t.userId != null ? { id: Number(t.userId) } : null,
        },
      }));
      if (userId) rows = rows.filter((r) => r.userId === parseInt(userId));
      if (portfolioId) rows = rows.filter((r) => r.portfolioId === portfolioId);
      rows.sort((a, b) =>
        (b.tradeDate && a.tradeDate ? new Date(b.tradeDate).getTime() - new Date(a.tradeDate).getTime() : 0));

      // Best-effort Prisma enrichment of user name/email (never blocks).
      try {
        const ids = [...new Set(rows.map((r) => r.userId).filter((id): id is number => id !== null))];
        const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
        const userMap = new Map(users.map((u) => [u.id, u]));
        rows = rows.map((r) =>
          r.userId != null
            ? { ...r, portfolio: { ...r.portfolio, user: { id: r.userId, ...userMap.get(r.userId) } } }
            : r,
        );
      } catch (err) {
        logger.warn({
          msg: "Admin holdings: Prisma user enrichment skipped (mirror-only)",
          error: err instanceof Error ? err.message : String(err),
        });
      }

      return NextResponse.json(rows);
    }

    const transactions = await prisma.transaction.findMany({
      where,
      include: {
        portfolio: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: { tradeDate: 'desc' },
    });

    return NextResponse.json(transactions);
  } catch (error) {
    console.error('Admin holdings GET error:', error);
    return NextResponse.json({ error: "Failed to fetch holdings" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session || !session.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const validatedData = updateHoldingSchema.parse(body);

    const sqlite = getSqliteFallback();
    if (sqlite) {
      const { portfolioId, portfolioName } = await resolvePortfolio(validatedData.userId);
      if (!portfolioId) {
        return NextResponse.json({ error: "User does not have a portfolio" }, { status: 400 });
      }
      let id: string;
      try {
        id = randomUUID();
      } catch {
        id = `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      }
      const transaction = {
        id,
        portfolioId: String(portfolioId),
        userId: validatedData.userId,
        portfolioName: portfolioName ?? null,
        ticker: validatedData.ticker.toUpperCase(),
        side: validatedData.side,
        quantity: validatedData.quantity,
        price: validatedData.price,
        tradeDate: validatedData.tradeDate,
        fees: validatedData.fees ?? null,
        notes: validatedData.notes ?? null,
      };
      sqlite.upsertTransaction(transaction);
      return NextResponse.json(transaction, { status: 201 });
    }

    const portfolio = await prisma.portfolio.findFirst({
      where: { userId: validatedData.userId },
    });

    if (!portfolio) {
      return NextResponse.json({ error: "User does not have a portfolio" }, { status: 400 });
    }

    const transaction = await prisma.transaction.create({
      data: {
        portfolioId: portfolio.id,
        ticker: validatedData.ticker.toUpperCase(),
        side: validatedData.side,
        quantity: validatedData.quantity,
        price: validatedData.price,
        tradeDate: validatedData.tradeDate,
        fees: validatedData.fees,
        notes: validatedData.notes,
      },
    });

    return NextResponse.json(transaction, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: error.issues }, { status: 400 });
    }
    console.error('Admin holdings POST error:', error);
    return NextResponse.json({ error: "Failed to create transaction" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await auth();
    if (!session || !session.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { id, ...updateData } = body;

    if (!id) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 });
    }

    const sqlite = getSqliteFallback();
    if (sqlite) {
      const txns = sqlite.getTransactions({ limit: 5000 }) as any[];
      const existing = txns.find((t) => t.id === id);
      if (!existing) {
        return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
      }
      const merged: any = { ...existing, ...updateData, id };
      if (updateData.ticker) merged.ticker = String(updateData.ticker).toUpperCase();
      if (updateData.tradeDate) merged.tradeDate = new Date(updateData.tradeDate);
      if (updateData.quantity != null) merged.quantity = Number(updateData.quantity);
      if (updateData.price != null) merged.price = Number(updateData.price);
      if (updateData.fees != null) merged.fees = Number(updateData.fees);
      if (updateData.portfolioId) merged.portfolioId = String(updateData.portfolioId);
      if (updateData.userId != null) merged.userId = Number(updateData.userId);
      sqlite.upsertTransaction(merged);
      return NextResponse.json(merged);
    }

    const transaction = await prisma.transaction.update({
      where: { id },
      data: {
        ...updateData,
        ticker: updateData.ticker?.toUpperCase(),
      },
    });

    return NextResponse.json(transaction);
  } catch (error) {
    console.error('Admin holdings PUT error:', error);
    return NextResponse.json({ error: "Failed to update transaction" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await auth();
    if (!session || !session.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 });
    }

    const sqlite = getSqliteFallback();
    if (sqlite) {
      sqlite.deleteTransaction(id);
    } else {
      await prisma.transaction.delete({
        where: { id },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin holdings DELETE error:', error);
    return NextResponse.json({ error: "Failed to delete transaction" }, { status: 500 });
  }
}

// Portfolio resolution shared by POST/PUT: Prisma-first (authoritative), SQLite
// mirror fallback so admin can still record a trade during a DB outage.
async function resolvePortfolio(userId: number): Promise<{ portfolioId: string | null; portfolioName: string | null }> {
  try {
    const portfolio = await prisma.portfolio.findFirst({ where: { userId } });
    if (portfolio) return { portfolioId: portfolio.id, portfolioName: portfolio.name };
  } catch (e) {
    logger.warn({
      msg: "Admin holdings: Prisma portfolio lookup failed, trying SQLite mirror",
      error: e instanceof Error ? e.message : String(e),
    });
  }
  const sqlite = getSqliteFallback();
  if (sqlite) {
    const txns = sqlite.getTransactions({ limit: 5000 }) as any[];
    const found = txns.find((t) => t.userId === userId && t.portfolioId);
    if (found) return { portfolioId: String(found.portfolioId), portfolioName: found.portfolioName ?? null };
  }
  return { portfolioId: null, portfolioName: null };
}
