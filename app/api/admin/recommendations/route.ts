import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";

const recommendationSchema = z.object({
  symbol: z.string().min(1),
  entryRange: z.string().optional().nullable(),
  shortTerm: z.string().optional().nullable(),
  longTerm: z.string().optional().nullable(),
  intraday: z.string().optional().nullable(),
  recommendation: z.enum(['ACCUMULATE', 'BUY', 'HOLD', 'SELL', 'NEUTRAL']),
  analystRating: z.string().optional().nullable(),
  profitRangeMin: z.number().optional().nullable(),
  profitRangeMax: z.number().optional().nullable(),
  targetPrice: z.number().optional().nullable(),
  analysis: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
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
    console.log('POST /api/admin/recommendations - body:', JSON.stringify(body));
    const validatedData = recommendationSchema.parse(body);
    console.log('POST /api/admin/recommendations - validated:', JSON.stringify(validatedData));

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
        createdBy: session.user.id ? parseInt(session.user.id as string, 10) : null,
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
