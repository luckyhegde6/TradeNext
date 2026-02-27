import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";

const createTransactionSchema = z.object({
  ticker: z.string().min(1),
  side: z.enum(['BUY', 'SELL']),
  quantity: z.number().positive(),
  price: z.number().positive(),
  tradeDate: z.string().transform(str => new Date(str)),
  fees: z.number().optional(),
  notes: z.string().optional(),
});

const updateTransactionSchema = createTransactionSchema.partial();

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseInt(session.user.id);
    if (isNaN(userId)) {
      return NextResponse.json({ error: "User ID not found" }, { status: 400 });
    }

    const portfolio = await prisma.portfolio.findFirst({
      where: { userId },
    });

    if (!portfolio) {
      return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
    }

    const transactions = await prisma.transaction.findMany({
      where: { portfolioId: portfolio.id },
      orderBy: { tradeDate: 'desc' },
    });

    return NextResponse.json(transactions);
  } catch (error) {
    console.error('User holdings GET error:', error);
    return NextResponse.json({ error: "Failed to fetch holdings" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseInt(session.user.id);
    if (isNaN(userId)) {
      return NextResponse.json({ error: "User ID not found" }, { status: 400 });
    }

    const body = await req.json();
    const validatedData = createTransactionSchema.parse(body);

    let portfolio = await prisma.portfolio.findFirst({
      where: { userId },
    });

    if (!portfolio) {
      portfolio = await prisma.portfolio.create({
        data: { userId, name: "My Portfolio" },
      });
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
    console.error('User holdings POST error:', error);
    return NextResponse.json({ error: "Failed to create transaction" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseInt(session.user.id);
    if (isNaN(userId)) {
      return NextResponse.json({ error: "User ID not found" }, { status: 400 });
    }

    const body = await req.json();
    const { id, ...updateData } = body;

    if (!id) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 });
    }

    const existingTransaction = await prisma.transaction.findFirst({
      where: {
        id,
        portfolio: { userId },
      },
    });

    if (!existingTransaction) {
      return NextResponse.json({ error: "Transaction not found or unauthorized" }, { status: 404 });
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
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: error.issues }, { status: 400 });
    }
    console.error('User holdings PUT error:', error);
    return NextResponse.json({ error: "Failed to update transaction" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseInt(session.user.id);
    if (isNaN(userId)) {
      return NextResponse.json({ error: "User ID not found" }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 });
    }

    const existingTransaction = await prisma.transaction.findFirst({
      where: {
        id,
        portfolio: { userId },
      },
    });

    if (!existingTransaction) {
      return NextResponse.json({ error: "Transaction not found or unauthorized" }, { status: 404 });
    }

    await prisma.transaction.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('User holdings DELETE error:', error);
    return NextResponse.json({ error: "Failed to delete transaction" }, { status: 500 });
  }
}
