import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { createAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * GET /api/alerts/channels/:id — get a single delivery channel
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = parseInt(session.user.id);
    const { id } = await params;

    const channel = await prisma.alertChannel.findFirst({
      where: { id, userId },
    });
    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    return NextResponse.json(channel);
  } catch (error) {
    logger.error({
      msg: "Failed to get alert channel",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to get alert channel" }, { status: 500 });
  }
}

/**
 * PUT /api/alerts/channels/:id — update a delivery channel
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = parseInt(session.user.id);
    const { id } = await params;

    const existing = await prisma.alertChannel.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const body = await req.json();
    const { type, name, config, isActive } = body;

    const data: any = {};
    if (type !== undefined) data.type = type;
    if (name !== undefined) data.name = name;
    if (config !== undefined) data.config = config;
    if (isActive !== undefined) data.isActive = isActive;

    const channel = await prisma.alertChannel.update({
      where: { id },
      data,
    });

    await createAuditLog({
      userId,
      action: "ALERT_CHANNEL_UPDATE",
      resource: "AlertChannel",
      resourceId: id,
      metadata: { name: channel.name },
    });

    logger.info({ msg: "Alert channel updated", channelId: id, userId });
    return NextResponse.json(channel);
  } catch (error) {
    logger.error({
      msg: "Failed to update alert channel",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to update alert channel" }, { status: 500 });
  }
}

/**
 * DELETE /api/alerts/channels/:id — delete a delivery channel
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = parseInt(session.user.id);
    const { id } = await params;

    const existing = await prisma.alertChannel.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    await prisma.alertChannel.delete({ where: { id } });

    await createAuditLog({
      userId,
      action: "ALERT_CHANNEL_DELETE",
      resource: "AlertChannel",
      resourceId: id,
      metadata: { name: existing.name },
    });

    logger.info({ msg: "Alert channel deleted", channelId: id, userId });
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({
      msg: "Failed to delete alert channel",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to delete alert channel" }, { status: 500 });
  }
}


