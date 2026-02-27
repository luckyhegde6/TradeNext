import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";

const recommendationSchema = z.object({
  symbol: z.string().min(1),
  entryRange: z.string().optional(),
  shortTerm: z.string().optional(),
  longTerm: z.string().optional(),
  intraday: z.string().optional(),
  recommendation: z.enum(['ACCUMULATE', 'BUY', 'HOLD', 'SELL', 'NEUTRAL']),
  analystRating: z.string().optional(),
  profitRangeMin: z.number().optional(),
  profitRangeMax: z.number().optional(),
  targetPrice: z.number().optional(),
  analysis: z.string().optional(),
  imageUrl: z.string().optional(),
});

const updateRecommendationSchema = recommendationSchema.partial();

export async function GET() {
  try {
    const session = await auth();
    if (!session || !session.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const recommendations = await prisma.stockRecommendation.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(recommendations);
  } catch (error) {
    console.error('Admin recommendations GET error:', error);
    return NextResponse.json({ error: "Failed to fetch recommendations" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session || !session.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const validatedData = recommendationSchema.parse(body);

    const recommendation = await prisma.stockRecommendation.create({
      data: {
        symbol: validatedData.symbol.toUpperCase(),
        entryRange: validatedData.entryRange,
        shortTerm: validatedData.shortTerm,
        longTerm: validatedData.longTerm,
        intraday: validatedData.intraday,
        recommendation: validatedData.recommendation,
        analystRating: validatedData.analystRating,
        profitRangeMin: validatedData.profitRangeMin,
        profitRangeMax: validatedData.profitRangeMax,
        targetPrice: validatedData.targetPrice,
        analysis: validatedData.analysis,
        imageUrl: validatedData.imageUrl,
        createdBy: parseInt(session.user.id as string),
      },
    });

    return NextResponse.json(recommendation, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: error.issues }, { status: 400 });
    }
    console.error('Admin recommendations POST error:', error);
    return NextResponse.json({ error: "Failed to create recommendation" }, { status: 500 });
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

    const validatedData = updateRecommendationSchema.parse(updateData);

    const recommendation = await prisma.stockRecommendation.update({
      where: { id },
      data: {
        ...validatedData,
        symbol: validatedData.symbol?.toUpperCase(),
      },
    });

    return NextResponse.json(recommendation);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: error.issues }, { status: 400 });
    }
    console.error('Admin recommendations PUT error:', error);
    return NextResponse.json({ error: "Failed to update recommendation" }, { status: 500 });
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

    await prisma.stockRecommendation.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin recommendations DELETE error:', error);
    return NextResponse.json({ error: "Failed to delete recommendation" }, { status: 500 });
  }
}
