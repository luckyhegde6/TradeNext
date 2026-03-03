import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";

const notificationSchema = z.object({
  type: z.enum(["alert_triggered", "recommendation", "system", "watchlist"]),
  title: z.string().min(1),
  message: z.string().min(1),
  link: z.string().optional(),
});

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = Number(session.user.id);
    const { searchParams } = new URL(req.url);
    const unreadOnly = searchParams.get("unread") === "true";

    const where: any = { userId };
    if (unreadOnly) {
      where.isRead = false;
    }

    const notifications = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const unreadCount = await prisma.notification.count({
      where: { userId, isRead: false },
    });

    return NextResponse.json({ notifications, unreadCount });
  } catch (error) {
    console.error("User notifications GET error:", error);
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 });
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
    const validatedData = notificationSchema.parse(body);

    const notification = await prisma.notification.create({
      data: {
        userId,
        ...validatedData,
      },
    });

    return NextResponse.json(notification, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: error.issues }, { status: 400 });
    }
    console.error("User notifications POST error:", error);
    return NextResponse.json({ error: "Failed to create notification" }, { status: 500 });
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
    const { id, markAllRead } = body;

    if (markAllRead) {
      await prisma.notification.updateMany({
        where: { userId, isRead: false },
        data: { isRead: true },
      });
    } else if (id) {
      await prisma.notification.updateMany({
        where: { id, userId },
        data: { isRead: true },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("User notifications PUT error:", error);
    return NextResponse.json({ error: "Failed to update notification" }, { status: 500 });
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

    if (id) {
      await prisma.notification.deleteMany({
        where: { id, userId },
      });
    } else {
      await prisma.notification.deleteMany({
        where: { userId },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("User notifications DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete notification" }, { status: 500 });
  }
}
