import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const recommendations = await prisma.stockRecommendation.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return NextResponse.json(recommendations);
  } catch (error) {
    console.error('User recommendations GET error:', error);
    return NextResponse.json({ error: "Failed to fetch recommendations" }, { status: 500 });
  }
}
