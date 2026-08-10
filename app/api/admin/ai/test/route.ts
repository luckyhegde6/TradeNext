import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { directPrompt } from "@/lib/services/ai/llm-provider";
import { loadConfig } from "@/lib/services/ai/config";
import { trackAiCall } from "@/lib/services/ai/ai-monitoring";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * POST /api/admin/ai/test — Test AI connection with a simple prompt
 * Body: { prompt?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const prompt = body.prompt || "What is 2 + 2? Reply with just the number.";

    // Use the current saved config (DB ai_config Secret + env fallback)
    const config = await loadConfig();

    const start = Date.now();
    const response = await directPrompt(prompt, config);
    const elapsed = Date.now() - start;

    const isError = response.startsWith("AI") && (response.includes("not configured") || response.includes("failed"));

    // Track the test call (await so the write lands before the response)
    await trackAiCall({
      timestamp: new Date().toISOString(),
      action: "test",
      model: config.model,
      status: isError ? "error" : "success",
      tokensUsed: 0,
      responseTimeMs: elapsed,
      error: isError ? response : undefined,
    });

    logger.info({ msg: "AI test connection", model: config.model, elapsed, success: !isError });

    return NextResponse.json({
      success: !isError,
      response,
      model: config.model,
      elapsed,
    });
  } catch (err) {
    logger.error({ msg: "AI test failed", error: err });
    return NextResponse.json(
      { success: false, error: "Test failed" },
      { status: 500 }
    );
  }
}
