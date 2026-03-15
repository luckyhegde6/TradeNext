import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";

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

    const announcements = await prisma.adminAnnouncement.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

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

    const announcement = await prisma.adminAnnouncement.create({
      data: {
        title,
        message,
        type: type || "info",
        target: target || "all",
        isActive: isActive ?? true,
        startsAt: startsAt ? new Date(startsAt) : null,
        endsAt: endsAt ? new Date(endsAt) : null,
        link: link || null,
        createdBy: adminId,
      },
    });

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

    // Fetch existing to verify
    const existing = await prisma.adminAnnouncement.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Announcement not found" }, { status: 404 });
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

    const announcement = await prisma.adminAnnouncement.update({
      where: { id },
      data: updatePayload,
    });

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

    await prisma.adminAnnouncement.delete({
      where: { id: Number(id) },
    });

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
