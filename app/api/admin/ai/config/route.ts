import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getDefaultConfig, AVAILABLE_MODELS, hasValidConfig } from "@/lib/services/ai/config";
import { resetLLM } from "@/lib/services/ai/llm-provider";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * GET /api/admin/ai/config — Get AI configuration status
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const envConfig = getDefaultConfig();
    const isConfigured = hasValidConfig(envConfig);

    // Try to fetch persisted config from DB (AI config stored as a Secret)
    let dbConfig: any = null;
    try {
      const stored = await prisma.secret.findFirst({ where: { name: "ai_config" } });
      if (stored) {
        dbConfig = stored.metadata as any;
      }
    } catch { /* DB not available */ }

    // Fetch custom models from DB
    let customModels: { id: string; name: string; description?: string; contextLength?: number }[] = [];
    try {
      const customModelsRecord = await prisma.secret.findFirst({ where: { name: "ai_custom_models" } });
      if (customModelsRecord?.metadata && Array.isArray((customModelsRecord.metadata as any).models)) {
        customModels = (customModelsRecord.metadata as any).models;
      }
    } catch { /* DB not available */ }

    // Merge built-in + custom models
    const allModels = [...AVAILABLE_MODELS, ...customModels];

    return NextResponse.json({
      configured: isConfigured,
      hasApiKey: envConfig.apiKey.length > 0,
      model: dbConfig?.model || envConfig.model,
      temperature: dbConfig?.temperature ?? envConfig.temperature,
      maxTokens: dbConfig?.maxTokens ?? envConfig.maxTokens,
      enabled: dbConfig?.enabled ?? envConfig.enabled,
      availableModels: allModels,
      customModels,
      envModel: envConfig.model,
    });
  } catch (err) {
    logger.error({ msg: "Failed to get AI config", error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/admin/ai/config — Update AI configuration
 * Body: { model?: string, temperature?: number, maxTokens?: number, enabled?: boolean }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const update: any = {};

    if (body.model !== undefined) {
      // Validate model: must be in built-in list OR custom models OR valid OpenRouter format
      const builtIn = AVAILABLE_MODELS.find((m) => m.id === body.model);
      
      // Check custom models in DB
      let isCustom = false;
      try {
        const customModelsRecord = await prisma.secret.findFirst({ where: { name: "ai_custom_models" } });
        if (customModelsRecord?.metadata && Array.isArray((customModelsRecord.metadata as any).models)) {
          isCustom = (customModelsRecord.metadata as any).models.some((m: any) => m.id === body.model);
        }
      } catch { /* ignore */ }

      // Accept if built-in, custom, or valid OpenRouter format (org/model-name)
      const isValidFormat = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+(:[a-zA-Z0-9_-]+)?$/.test(body.model);
      
      if (!builtIn && !isCustom && !isValidFormat) {
        return NextResponse.json({ 
          error: `Invalid model format. Use "org/model-name" (e.g., "openrouter/auto-beta" or "nvidia/nemotron-3-embed-1b:free")` 
        }, { status: 400 });
      }
      update.model = body.model;
    }
    if (body.temperature !== undefined) {
      const t = Number(body.temperature);
      if (isNaN(t) || t < 0 || t > 2) {
        return NextResponse.json({ error: "Temperature must be between 0 and 2" }, { status: 400 });
      }
      update.temperature = t;
    }
    if (body.maxTokens !== undefined) {
      const m = Number(body.maxTokens);
      if (isNaN(m) || m < 128 || m > 16384) {
        return NextResponse.json({ error: "maxTokens must be between 128 and 16384" }, { status: 400 });
      }
      update.maxTokens = m;
    }
    if (body.enabled !== undefined) {
      update.enabled = Boolean(body.enabled);
    }

    // Persist in DB via Secret model
    const envConfig = getDefaultConfig();
    const existing = await prisma.secret.findFirst({ where: { name: "ai_config" } });

    const mergedConfig = {
      ...(envConfig as any),
      ...update,
    };

    if (existing) {
      await prisma.secret.update({
        where: { id: existing.id },
        data: {
          metadata: mergedConfig,
          updatedAt: new Date(),
        },
      });
    } else {
      await prisma.secret.create({
        data: {
          name: "ai_config",
          type: "api_key",
          value: "stored_in_env",
          hint: "AI model configuration",
          metadata: mergedConfig,
        },
      });
    }

    // Reset LLM cache so new config takes effect
    resetLLM();

    logger.info({ msg: "AI config updated", updates: Object.keys(update) });

    return NextResponse.json({
      success: true,
      config: mergedConfig,
    });
  } catch (err) {
    logger.error({ msg: "Failed to update AI config", error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/ai/config — Remove a custom model
 * Body: { modelId: string }
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    if (!body.modelId) {
      return NextResponse.json({ error: "modelId is required" }, { status: 400 });
    }

    // Don't allow removing built-in models
    const isBuiltIn = AVAILABLE_MODELS.some((m) => m.id === body.modelId);
    if (isBuiltIn) {
      return NextResponse.json({ error: "Cannot remove built-in models" }, { status: 400 });
    }

    const existing = await prisma.secret.findFirst({ where: { name: "ai_custom_models" } });
    if (!existing?.metadata || !Array.isArray((existing.metadata as any).models)) {
      return NextResponse.json({ error: "Custom model not found" }, { status: 404 });
    }

    const models = (existing.metadata as any).models.filter((m: any) => m.id !== body.modelId);
    
    await prisma.secret.update({
      where: { id: existing.id },
      data: { metadata: { models }, updatedAt: new Date() },
    });

    // If the active model was the one removed, fall back to default
    const aiConfig = await prisma.secret.findFirst({ where: { name: "ai_config" } });
    if (aiConfig?.metadata && (aiConfig.metadata as any).model === body.modelId) {
      await prisma.secret.update({
        where: { id: aiConfig.id },
        data: { metadata: { ...(aiConfig.metadata as any), model: "openrouter/free" }, updatedAt: new Date() },
      });
      resetLLM();
    }

    return NextResponse.json({ success: true, message: `Model "${body.modelId}" removed` });
  } catch (err) {
    logger.error({ msg: "Failed to delete custom model", error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
