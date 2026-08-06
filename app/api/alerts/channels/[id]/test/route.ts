import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { sendEmailAlert, buildAlertEmailHtml, type EmailConfig } from "@/lib/alerts/delivery/email";
import { sendWebhookAlert, type WebhookConfig } from "@/lib/alerts/delivery/webhook";

export const runtime = "nodejs";

/**
 * POST /api/alerts/channels/:id/test — send a test message through this channel
 */
export async function POST(
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

    const config = typeof channel.config === "string"
      ? JSON.parse(channel.config)
      : channel.config;

    let success = false;
    let errorMsg: string | undefined;

    switch (channel.type) {
      case "email": {
        const emailConfig = config as EmailConfig;
        const html = buildAlertEmailHtml({
          ruleName: "Test Alert",
          message: "This is a test message from TradeNext. Your email channel is configured correctly!",
          link: "/alerts",
        });
        const result = await sendEmailAlert(emailConfig, "[TradeNext] Test Alert", html);
        success = result.success;
        errorMsg = result.error;
        break;
      }
      case "webhook": {
        const webhookConfig = config as WebhookConfig;
        const result = await sendWebhookAlert(webhookConfig, {
          title: "TradeNext Test Alert",
          message: "This is a test message. Your webhook channel is configured correctly!",
          fields: { Status: "OK", Timestamp: new Date().toISOString() },
          color: "green",
        });
        success = result.success;
        errorMsg = result.error;
        break;
      }
      default:
        errorMsg = `Test not supported for channel type: ${channel.type}`;
    }

    return NextResponse.json({ success, error: errorMsg });
  } catch (error) {
    logger.error({
      msg: "Failed to test alert channel",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to test channel" }, { status: 500 });
  }
}
