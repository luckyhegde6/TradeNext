import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";

const alertSchema = z.object({
  symbol: z.string().optional(),
  alertType: z.enum(['price_above', 'price_below', 'volume_spike', 'custom']),
  title: z.string().min(1),
  message: z.string().optional(),
  targetPrice: z.number().optional(),
});

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseInt(session.user.id as string);
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const today = searchParams.get('today');

    const where: any = { userId };
    
    if (status) where.status = status;
    
    if (today === 'true') {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      where.createdAt = { gte: startOfDay };
    }

    const alerts = await prisma.userAlert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: today === 'true' ? 5 : 50,
    });

    return NextResponse.json(alerts);
  } catch (error) {
    console.error('User alerts GET error:', error);
    return NextResponse.json({ error: "Failed to fetch alerts" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseInt(session.user.id as string);
    const body = await req.json();
    const validatedData = alertSchema.parse(body);

    const alert = await prisma.userAlert.create({
      data: {
        userId,
        symbol: validatedData.symbol?.toUpperCase(),
        alertType: validatedData.alertType,
        title: validatedData.title,
        message: validatedData.message,
        targetPrice: validatedData.targetPrice,
      },
    });

    return NextResponse.json(alert, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: error.issues }, { status: 400 });
    }
    console.error('User alerts POST error:', error);
    return NextResponse.json({ error: "Failed to create alert" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseInt(session.user.id as string);
    const body = await req.json();
    const { id, status, currentPrice } = body;

    if (!id) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 });
    }

    const updateData: any = {};
    if (status) {
      updateData.status = status;
      if (status === 'triggered') {
        updateData.triggeredAt = new Date();
      }
    }
    if (currentPrice !== undefined) {
      updateData.currentPrice = currentPrice;
    }

    const alert = await prisma.userAlert.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json(alert);
  } catch (error) {
    console.error('User alerts PUT error:', error);
    return NextResponse.json({ error: "Failed to update alert" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseInt(session.user.id as string);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 });
    }

    await prisma.userAlert.delete({
      where: { id, userId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('User alerts DELETE error:', error);
    return NextResponse.json({ error: "Failed to delete alert" }, { status: 500 });
  }
}
