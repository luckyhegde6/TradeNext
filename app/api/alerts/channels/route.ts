import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { createAuditLog } from "@/lib/audit";
import { sendEmailAlert, type EmailConfig } from "@/lib/alerts/delivery/email";
import { sendWebhookAlert, type WebhookConfig } from "@/lib/alerts/delivery/webhook";

export const runtime = "nodejs";

const ALLOWED_CHANNEL_TYPES = ["email", "webhook", "telegram", "push"];

/**
 * GET /api/alerts/channels — list user's delivery channels
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = parseInt(session.user.id);

    const channels = await prisma.alertChannel.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    // Mask sensitive config values for client response
    const masked = channels.map((ch) => ({
      ...ch,
      config: maskSensitiveConfig(ch.type, ch.config as Record<string, unknown>),
    }));

    return NextResponse.json(masked);
  } catch (error) {
    logger.error({
      msg: "Failed to list alert channels",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Failed to list alert channels" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/alerts/channels — create a new delivery channel
 * Body: { type, name, config }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = parseInt(session.user.id);

    const body = await req.json();
    const { type, name, config } = body;

    if (!type || !name || !config) {
      return NextResponse.json(
        { error: "type, name, and config are required" },
        { status: 400 }
      );
    }

    if (!ALLOWED_CHANNEL_TYPES.includes(type)) {
      return NextResponse.json(
        { error: `Invalid channel type. Allowed: ${ALLOWED_CHANNEL_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    const channel = await prisma.alertChannel.create({
      data: {
        userId,
        type,
        name,
        config: config as any,
        isActive: true,
        verified: false,
      },
    });

    await createAuditLog({
      userId,
      action: "ALERT_CHANNEL_CREATE",
      resource: "AlertChannel",
      resourceId: channel.id,
      metadata: { type, name },
    });

    logger.info({ msg: "Alert channel created", channelId: channel.id, userId, type });
    return NextResponse.json(channel, { status: 201 });
  } catch (error) {
    logger.error({
      msg: "Failed to create alert channel",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Failed to create alert channel" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/alerts/channels?action=test — send a test message through a channel
 * Body: { channelId }
 */
export async function POST_TEST(req: NextRequest) {
  // This is handled via a separate route at channels/[id]/test
  return NextResponse.json({ error: "Use POST /api/alerts/channels/:id/test" }, { status: 400 });
}

/**
 * Mask sensitive fields in channel config before sending to client.
 */
function maskSensitiveConfig(type: string, config: Record<string, unknown>): Record<string, unknown> {
  const masked = { ...config };
  const sensitiveKeys = ["smtpPass", "password", "token", "apiKey", "secret", "authorization"];

  for (const key of sensitiveKeys) {
    if (masked[key] && typeof masked[key] === "string") {
      const val = masked[key] as string;
      masked[key] = val.length > 4
        ? val.slice(0, 2) + "****" + val.slice(-4)
        : "****";
    }
  }

  return masked;
}
