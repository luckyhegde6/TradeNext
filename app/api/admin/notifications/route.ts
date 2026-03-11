import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { auth as getAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();

    if (!session || !session.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminId = Number(session.user.id);
    const { searchParams } = new URL(req.url);
    const addressed = searchParams.get("addressed");

    const where: any = { userId: adminId };
    if (addressed === "false") {
      where.isAddressed = false;
    } else if (addressed === "true") {
      where.isAddressed = true;
    }

    const notifications = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return NextResponse.json(notifications);
  } catch (error) {
    console.error("Admin notifications GET error:", error);
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await auth();

    if (!session || !session.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminId = Number(session.user.id);
    const body = await req.json();
    const { id, action, response } = body;

    if (!id) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 });
    }

    if (action === "markRead") {
      const notification = await prisma.notification.update({
        where: { id },
        data: { isRead: true },
      });

      await createAuditLog({
        userId: adminId,
        action: "NOTIFICATION_MARK_READ",
        resource: "Notification",
        resourceId: id,
      });

      return NextResponse.json(notification);
    }

    if (action === "address") {
      const notification = await prisma.notification.update({
        where: { id },
        data: {
          isAddressed: true,
          addressedAt: new Date(),
          addressedBy: adminId,
        },
      });

      await createAuditLog({
        userId: adminId,
        action: "NOTIFICATION_ADDRESSED",
        resource: "Notification",
        resourceId: id,
        metadata: { response }
      });

      return NextResponse.json(notification);
    }

    if (action === "markAllRead") {
      await prisma.notification.updateMany({
        where: { userId: adminId, isRead: false },
        data: { isRead: true },
      });

      await createAuditLog({
        userId: adminId,
        action: "NOTIFICATIONS_MARK_ALL_READ",
        resource: "Notification",
        resourceId: "bulk"
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Admin notifications PUT error:", error);
    return NextResponse.json({ error: "Failed to update notification" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await auth();

    if (!session || !session.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminId = Number(session.user.id);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 });
    }

    await prisma.notification.delete({
      where: { id, userId: adminId },
    });

    await createAuditLog({
      userId: adminId,
      action: "NOTIFICATION_DELETE",
      resource: "Notification",
      resourceId: id
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin notifications DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete notification" }, { status: 500 });
  }
}
