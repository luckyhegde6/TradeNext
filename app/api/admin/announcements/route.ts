import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getSqliteFallback } from "@/lib/sqlite";
import { createAuditLog } from "@/lib/audit";
import { recordOutboundNotification } from "@/lib/services/outboundNotificationService";

// Force dynamic to prevent pre-rendering during build
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session || !session.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const activeOnly = searchParams.get("activeOnly") === "true";

    const sqlite = getSqliteFallback();
    let announcements: any[];
    if (sqlite) {
      // SQLite-first mirror: zero-Prisma read (Plan 09 §4.8). Mirror stores
      // is_active as 0/1 — coerce back to boolean for the UI contract.
      announcements = (sqlite.getAnnouncements({
        activeOnly: activeOnly || undefined,
        limit: 1000,
      }) as any[]).map((a) => ({ ...a, isActive: !!a.isActive }));
    } else {
      const where: any = {};
      if (activeOnly) {
        const now = new Date();
        where.isActive = true;
        where.OR = [
          { startsAt: null },
          { startsAt: { lte: now } },
        ];
        where.AND = [
          { endsAt: null },
          { endsAt: { gte: now } },
        ];
      }
      announcements = await prisma.adminAnnouncement.findMany({
        where,
        orderBy: { createdAt: "desc" },
      });
    }

    return NextResponse.json(announcements);
  } catch (error) {
    console.error("Admin announcements GET error:", error);
    return NextResponse.json({ error: "Failed to fetch announcements" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session || !session.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminId = Number(session.user.id);
    const body = await req.json();
    const { title, message, type, target, isActive, startsAt, endsAt, link } = body;

    if (!title || !message) {
      return NextResponse.json({ error: "Title and message are required" }, { status: 400 });
    }

    const row = {
      title,
      message,
      type: type || "info",
      target: target || "all",
      isActive: isActive ?? true,
      startsAt: startsAt ? new Date(startsAt) : null,
      endsAt: endsAt ? new Date(endsAt) : null,
      link: link || null,
      createdBy: adminId,
    };
    const sqlite = getSqliteFallback();
    const announcement = sqlite
      ? {
          id: sqlite.upsertAnnouncement(row),
          title,
          message,
          type: type || "info",
          target: target || "all",
          isActive: !!(isActive ?? true),
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          link: link || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      : await prisma.adminAnnouncement.create({ data: row });

    // Record unified outbound send records for active announcements (admin in-app fanout).
    if (announcement.isActive) {
      try {
        const admins = await prisma.user.findMany({
          where: { role: "admin", isBlocked: false },
          select: { id: true },
        });
        if (admins.length > 0) {
          await prisma.notification.createMany({
            data: admins.map((admin) => ({
              userId: admin.id,
              type: announcement.type || "info",
              title: announcement.title,
              message: announcement.message,
              link: announcement.link || null,
            })),
          });
          const batchId = `announcement_create_${announcement.id}_${Date.now()}`;
          for (const admin of admins) {
            await recordOutboundNotification({
              channel: "in_app",
              chatId: null,
              recipientType: "admin",
              recipientId: String(admin.id),
              notificationType: "admin_announcement",
              title: announcement.title,
              message: announcement.message,
              status: "sent",
              attemptCount: 1,
              sentAt: new Date(),
              deliveredAt: new Date(),
              source: "admin_announcements",
              triggeredBy: session?.user?.email || String(session?.user?.id || "admin"),
              batchId,
              metadata: {
                announcementId: announcement.id,
                action: "create",
                target: announcement.target ?? null,
                isActive: true,
                link: announcement.link ?? null,
              },
            }).catch(() => {});
          }
        }
      } catch (notifyErr) {
        console.warn("[admin/announcements] create notification fan-out failed", notifyErr);
      }
    }

    await createAuditLog({
      userId: adminId,
      action: "ADMIN_ANNOUNCEMENT_CREATE",
      resource: "AdminAnnouncement",
      resourceId: announcement.id.toString(),
      metadata: { title, type, target },
    });

    return NextResponse.json(announcement);
  } catch (error) {
    console.error("Admin announcements POST error:", error);
    return NextResponse.json({ error: "Failed to create announcement" }, { status: 500 });
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
    const { id, action, isActive, ...updateData } = body;

    if (!id) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 });
    }

    let updatePayload: any = {};

    if (action === "toggleActive" && typeof isActive === "boolean") {
      updatePayload.isActive = isActive;
    } else {
      // Full update
      const { title, message, type, target, startsAt, endsAt, link } = updateData;
      updatePayload = {
        ...(title && { title }),
        ...(message && { message }),
        ...(type && { type }),
        ...(target && { target }),
        ...(startsAt !== undefined && { startsAt: startsAt ? new Date(startsAt) : null }),
        ...(endsAt !== undefined && { endsAt: endsAt ? new Date(endsAt) : null }),
        ...(link !== undefined && { link: link || null }),
      };
    }

    const sqlite = getSqliteFallback();
    let announcement: any;
    let previousAnnouncement: any = null;
    if (sqlite) {
      const rows = sqlite.getAnnouncements({ limit: 1000 }) as any[];
      const existing = rows.find((r) => Number(r.id) === Number(id));
      if (!existing) {
        return NextResponse.json({ error: "Announcement not found" }, { status: 404 });
      }
      previousAnnouncement = existing;

      sqlite.upsertAnnouncement({ ...existing, ...updatePayload, id: Number(id) });
      announcement = {
        ...existing,
        ...updatePayload,
        isActive: !!((updatePayload.isActive ?? existing.isActive) ? 1 : 0),
      };
    } else {
      // Fetch existing to verify
      const existing = await prisma.adminAnnouncement.findUnique({ where: { id } });
      if (!existing) {
        return NextResponse.json({ error: "Announcement not found" }, { status: 404 });
      }
      previousAnnouncement = existing;

      announcement = await prisma.adminAnnouncement.update({
        where: { id },
        data: updatePayload,
      });
    }

    const wasActive = Boolean(previousAnnouncement?.isActive);
    const isNowActive = Boolean(announcement?.isActive);
    if (!wasActive && isNowActive) {
      try {
        const admins = await prisma.user.findMany({
          where: { role: "admin", isBlocked: false },
          select: { id: true },
        });
        if (admins.length > 0) {
          await prisma.notification.createMany({
            data: admins.map((admin) => ({
              userId: admin.id,
              type: announcement.type || "info",
              title: announcement.title,
              message: announcement.message,
              link: announcement.link || null,
            })),
          });
          const batchId = `announcement_activate_${announcement.id}_${Date.now()}`;
          for (const admin of admins) {
            await recordOutboundNotification({
              channel: "in_app",
              chatId: null,
              recipientType: "admin",
              recipientId: String(admin.id),
              notificationType: "admin_announcement",
              title: announcement.title,
              message: announcement.message,
              status: "sent",
              attemptCount: 1,
              sentAt: new Date(),
              deliveredAt: new Date(),
              source: "admin_announcements",
              triggeredBy: session?.user?.email || String(session?.user?.id || "admin"),
              batchId,
              metadata: {
                announcementId: announcement.id,
                action: "activate",
                target: announcement.target ?? null,
                link: announcement.link ?? null,
              },
            }).catch(() => {});
          }
        }
      } catch (notifyErr) {
        console.warn("[admin/announcements] activation notification fan-out failed", notifyErr);
      }
    }

    await createAuditLog({
      userId: adminId,
      action: action === "toggleActive" ? "ADMIN_ANNOUNCEMENT_TOGGLE" : "ADMIN_ANNOUNCEMENT_UPDATE",
      resource: "AdminAnnouncement",
      resourceId: id.toString(),
      metadata: updatePayload,
    });

    return NextResponse.json(announcement);
  } catch (error) {
    console.error("Admin announcements PUT error:", error);
    return NextResponse.json({ error: "Failed to update announcement" }, { status: 500 });
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

    const sqlite = getSqliteFallback();
    if (sqlite) {
      sqlite.deleteAnnouncement(Number(id));
    } else {
      await prisma.adminAnnouncement.delete({
        where: { id: Number(id) },
      });
    }

    await createAuditLog({
      userId: adminId,
      action: "ADMIN_ANNOUNCEMENT_DELETE",
      resource: "AdminAnnouncement",
      resourceId: id,
      metadata: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin announcements DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete announcement" }, { status: 500 });
  }
}
