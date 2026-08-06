import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { broadcastToSubscribers } from "@/lib/services/telegramBotService";
import { createAuditLog } from "@/lib/audit";
import { z } from "zod";

export const runtime = "nodejs";

const broadcastSchema = z.object({
  title: z.string().min(1).max(100),
  message: z.string().min(1).max(4000),
});

/**
 * POST /api/admin/telegram/broadcast — Send broadcast to all verified Telegram subscribers (admin only)
 */
export async function POST(req: Request) {
  try {
    const session = await auth();

    if (!session || !session.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const validated = broadcastSchema.parse(body);

    const sent = await broadcastToSubscribers(validated.title, validated.message);

    await createAuditLog({
      action: "TELEGRAM_BROADCAST",
      resource: "Telegram",
      metadata: {
        title: validated.title,
        messageLength: validated.message.length,
        sent,
        adminId: session.user.id,
      },
    });

    return NextResponse.json({
      success: true,
      sent,
      message: `Broadcast sent to ${sent} subscribers`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Admin telegram broadcast POST error:", error);
    return NextResponse.json(
      { error: "Failed to send broadcast" },
      { status: 500 }
    );
  }
}
