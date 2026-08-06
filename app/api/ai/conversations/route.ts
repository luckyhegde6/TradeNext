import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDefaultConfig, hasValidConfig } from "@/lib/services/ai/config";
import {
  trackAiCall,
  persistAiCallToDb,
} from "@/lib/services/ai/ai-monitoring";
import logger from "@/lib/logger";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * GET /api/ai/conversations — List user's AI conversations
 * Query params: limit (default 20), offset (default 0)
 */
export async function GET(req: NextRequest) {
  const startTime = Date.now();
  const userId = (await auth())?.user?.id;
  let status: "success" | "error" = "success";

  try {
    if (!userId) {
      status = "error";
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "20", 10) || 20, 1), 100);
    const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10) || 0, 0);

    const conversations = await prisma.aIConversation.findMany({
      where: { userId: Number(userId) },
      orderBy: { updatedAt: "desc" },
      take: limit,
      skip: offset,
      select: {
        id: true,
        title: true,
        analysisType: true,
        createdAt: true,
        updatedAt: true,
        messageCount: true,
      },
    });

    const total = await prisma.aIConversation.count({
      where: { userId: Number(userId) },
    });

    return NextResponse.json({ conversations, total, limit, offset });
  } catch (err) {
    status = "error";
    logger.error({ msg: "Failed to list AI conversations", error: err });
    return NextResponse.json(
      { error: "Failed to load conversations" },
      { status: 500 }
    );
  } finally {
    trackAiCall({
      timestamp: new Date().toISOString(),
      action: "conversations",
      model: "n/a",
      status,
      tokensUsed: 0,
      responseTimeMs: Date.now() - startTime,
      userId: userId ? Number(userId) : undefined,
    });
  }
}

/**
 * POST /api/ai/conversations — Create a new conversation context
 * Body: { analysisType: string; title?: string }
 */
export async function POST(req: NextRequest) {
  const startTime = Date.now();
  const userId = (await auth())?.user?.id;
  let status: "success" | "error" = "error";
  let analysisType = "general";

  try {
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const config = getDefaultConfig();
    if (!hasValidConfig(config)) {
      return NextResponse.json(
        { error: "AI is not configured. Admin must set OPENROUTERKEY in .env and enable AI in settings." },
        { status: 503 }
      );
    }

    const body = await req.json();
    if (!body.analysisType || typeof body.analysisType !== "string") {
      return NextResponse.json({ error: "analysisType is required" }, { status: 400 });
    }

    const validTypes = ["screener", "portfolio", "dividend", "market", "alert", "general"];
    if (!validTypes.includes(body.analysisType)) {
      return NextResponse.json(
        { error: `Invalid analysisType. Must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    analysisType = body.analysisType;

    const conversation = await prisma.aIConversation.create({
      data: {
        userId: Number(userId),
        analysisType: body.analysisType,
        title: body.title || null,
        messageCount: 0,
        tokenCount: 0,
        messages: [],
      },
    });

    status = "success";
    return NextResponse.json({
      success: true,
      conversation: {
        id: conversation.id,
        title: conversation.title,
        analysisType: conversation.analysisType,
        createdAt: conversation.createdAt,
      },
    });
  } catch (err) {
    logger.error({ msg: "Failed to create AI conversation", error: err });
    return NextResponse.json(
      { error: "Failed to create conversation" },
      { status: 500 }
    );
  } finally {
    trackAiCall({
      timestamp: new Date().toISOString(),
      action: "create_conversation",
      model: "n/a",
      status,
      tokensUsed: 0,
      responseTimeMs: Date.now() - startTime,
      userId: userId ? Number(userId) : undefined,
      analysisType,
    });
    persistAiCallToDb({
      timestamp: new Date().toISOString(),
      action: "create_conversation",
      model: "n/a",
      status,
      tokensUsed: 0,
      responseTimeMs: Date.now() - startTime,
      userId: userId ? Number(userId) : undefined,
      analysisType,
    }).catch(() => {});
  }
}
