import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * GET /api/admin/alerts/channels — admin view of all delivery channels
 * Query: userId (optional filter), type (optional filter), includeSecrets (bool)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const url = new URL(req.url);
    const userId = url.searchParams.get("userId");
    const type = url.searchParams.get("type");
    const includeSecrets = url.searchParams.get("includeSecrets") === "true";

    const where: any = {};
    if (userId) where.userId = parseInt(userId);
    if (type) where.type = type;

    const channels = await prisma.alertChannel.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    // If includeSecrets, resolve secrets referenced in config
    if (includeSecrets) {
      for (const ch of channels) {
        const config = typeof ch.config === "string" ? JSON.parse(ch.config) : ch.config;
        if (config.secretRefs) {
          const secrets = await prisma.secret.findMany({
            where: { id: { in: config.secretRefs } },
          });
          (config as any)._resolvedSecrets = secrets.map((s) => ({
            id: s.id,
            name: s.name,
            type: s.type,
            hint: s.hint,
          }));
        }
      }
    }

    // Stats
    const stats = {
      total: channels.length,
      byType: {} as Record<string, number>,
      active: channels.filter((c) => c.isActive).length,
      systemChannels: channels.filter((c) => c.userId === 0).length,
    };
    for (const ch of channels) {
      stats.byType[ch.type] = (stats.byType[ch.type] || 0) + 1;
    }

    return NextResponse.json({ channels, stats });
  } catch (error) {
    logger.error({
      msg: "Admin: Failed to list alert channels",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to list channels" }, { status: 500 });
  }
}

/**
 * POST /api/admin/alerts/channels — create a system-wide (admin) channel
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await req.json();
    const { type, name, config, isActive } = body;

    if (!type || !name || !config) {
      return NextResponse.json(
        { error: "type, name, and config are required" },
        { status: 400 }
      );
    }

    const channel = await prisma.alertChannel.create({
      data: {
        userId: 0, // system-wide
        type,
        name,
        config,
        isActive: isActive !== false,
      },
    });

    logger.info({
      msg: "Admin: System alert channel created",
      channelId: channel.id,
      type,
      name,
    });

    return NextResponse.json(channel, { status: 201 });
  } catch (error) {
    logger.error({
      msg: "Admin: Failed to create alert channel",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to create channel" }, { status: 500 });
  }
}

/**
 * PUT /api/admin/alerts/channels?id=xxx — update a channel (toggle active, update config)
 */
export async function PUT(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id query param is required" }, { status: 400 });
    }

    const body = await req.json();
    const data: any = {};
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.name) data.name = body.name;
    if (body.config) data.config = body.config;
    if (body.type) data.type = body.type;

    const channel = await prisma.alertChannel.update({
      where: { id },
      data,
    });

    logger.info({ msg: "Admin: Alert channel updated", channelId: id });
    return NextResponse.json(channel);
  } catch (error) {
    logger.error({
      msg: "Admin: Failed to update alert channel",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to update channel" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/alerts/channels?id=xxx — delete a channel
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id query param is required" }, { status: 400 });
    }

    await prisma.alertChannel.delete({ where: { id } });

    logger.info({ msg: "Admin: Alert channel deleted", channelId: id });
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({
      msg: "Admin: Failed to delete alert channel",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to delete channel" }, { status: 500 });
  }
}
