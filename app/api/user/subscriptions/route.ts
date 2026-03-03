import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";

const subscriptionSchema = z.object({
  recommendationId: z.string().uuid(),
});

export async function GET() {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = Number(session.user.id);

    const subscriptions = await prisma.recommendationSubscription.findMany({
      where: { userId },
      include: {
        recommendation: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ subscriptions });
  } catch (error) {
    console.error("User subscriptions GET error:", error);
    return NextResponse.json({ error: "Failed to fetch subscriptions" }, { status: 500 });
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
    const { recommendationId } = subscriptionSchema.parse(body);

    const existing = await prisma.recommendationSubscription.findFirst({
      where: { userId, recommendationId },
    });

    if (existing) {
      return NextResponse.json({ error: "Already subscribed" }, { status: 400 });
    }

    const subscription = await prisma.recommendationSubscription.create({
      data: {
        userId,
        recommendationId,
      },
    });

    return NextResponse.json(subscription, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: error.issues }, { status: 400 });
    }
    console.error("User subscriptions POST error:", error);
    return NextResponse.json({ error: "Failed to subscribe" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = Number(session.user.id);
    const body = await req.json();
    const { recommendationId } = subscriptionSchema.parse(body);

    await prisma.recommendationSubscription.deleteMany({
      where: { userId, recommendationId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: error.issues }, { status: 400 });
    }
    console.error("User subscriptions DELETE error:", error);
    return NextResponse.json({ error: "Failed to unsubscribe" }, { status: 500 });
  }
}
