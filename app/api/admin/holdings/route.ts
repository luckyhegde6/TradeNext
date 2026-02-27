import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";

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

    await prisma.transaction.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin holdings DELETE error:', error);
    return NextResponse.json({ error: "Failed to delete transaction" }, { status: 500 });
  }
}
