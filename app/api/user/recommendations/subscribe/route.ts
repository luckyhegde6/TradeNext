import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { recordTelegramEvent } from "@/lib/services/unifiedEventService";
import logger from "@/lib/logger";

export const runtime = "nodejs";

// POST /api/user/recommendations/subscribe — Subscribe/unsubscribe to recommendation alerts
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const userId = Number(session.user.id);
    const body = await request.json();
    const { action, chatId, notifyOn } = body;

    if (action === "subscribe") {
      if (!chatId) {
        return NextResponse.json({ success: false, error: "chatId required" }, { status: 400 });
      }

      const subscription = await prisma.recommendationAlertSubscription.upsert({
        where: { userId },
        update: { chatId, notifyOn: notifyOn || "all", isActive: true },
        create: { userId, chatId, notifyOn: notifyOn || "all" },
      });

      await recordTelegramEvent("recommendation_subscribe", "User subscribed to recommendations", userId, { chatId, notifyOn });

      return NextResponse.json({ success: true, subscription });
    }

    if (action === "unsubscribe") {
      await prisma.recommendationAlertSubscription.updateMany({
        where: { userId },
        data: { isActive: false },
      });

      await recordTelegramEvent("recommendation_unsubscribe", "User unsubscribed from recommendations", userId);

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 });
  } catch (error) {
    logger.error({ msg: "Recommendation subscribe failed", error });
    return NextResponse.json({ success: false, error: "Failed to process subscription" }, { status: 500 });
  }
}

// GET /api/user/recommendations/subscribe — Get subscription status
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const userId = Number(session.user.id);
    const subscription = await prisma.recommendationAlertSubscription.findUnique({
      where: { userId },
    });

    return NextResponse.json({
      success: true,
      subscribed: subscription?.isActive || false,
      notifyOn: subscription?.notifyOn || "all",
      chatId: subscription?.chatId || null,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: "Failed to fetch subscription" }, { status: 500 });
  }
}
