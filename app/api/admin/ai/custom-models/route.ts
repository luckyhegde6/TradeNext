import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

export const runtime = "nodejs";

interface CustomModel {
  id: string;
  name: string;
  description?: string;
  contextLength?: number;
  addedAt: string;
}

/**
 * POST /api/admin/ai/custom-models — Add or remove custom AI models
 * Body: { action: "add" | "remove", model?: { id, name, description } }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { action, model } = body;

    if (!action || !["add", "remove"].includes(action)) {
      return NextResponse.json({ error: "action must be 'add' or 'remove'" }, { status: 400 });
    }

    // Get or create the ai_custom_models Secret record
    let record = await prisma.secret.findFirst({ where: { name: "ai_custom_models" } });
    let models: CustomModel[] = [];

    if (record?.metadata && Array.isArray((record.metadata as any).models)) {
      models = (record.metadata as any).models;
    }

    if (action === "add") {
      if (!model?.id) {
        return NextResponse.json({ error: "model.id is required" }, { status: 400 });
      }

      // Validate OpenRouter format: org/model-name or org/model-name:variant
      const isValidFormat = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+(:[a-zA-Z0-9_-]+)?$/.test(model.id);
      if (!isValidFormat) {
        return NextResponse.json({
          error: `Invalid model format. Use "org/model-name" (e.g., "openrouter/auto-beta" or "nvidia/nemotron-3-embed-1b:free")`,
        }, { status: 400 });
      }

      // Check for duplicates
      if (models.some((m) => m.id === model.id)) {
        return NextResponse.json({ error: `Model "${model.id}" already exists` }, { status: 409 });
      }

      const newModel: CustomModel = {
        id: model.id,
        name: model.name || model.id,
        description: model.description || undefined,
        addedAt: new Date().toISOString(),
      };

      models.push(newModel);

      if (record) {
        await prisma.secret.update({
          where: { id: record.id },
          data: { metadata: { models } as any, updatedAt: new Date() },
        });
      } else {
        await prisma.secret.create({
          data: {
            name: "ai_custom_models",
            type: "api_key",
            value: "custom_models_storage",
            hint: "User-added OpenRouter models",
            metadata: { models } as any,
          },
        });
      }

      logger.info({ msg: "Custom AI model added", modelId: model.id, modelName: newModel.name });
      return NextResponse.json({ success: true, model: newModel, models });
    }

    // action === "remove"
    if (!model?.id) {
      return NextResponse.json({ error: "model.id is required for remove" }, { status: 400 });
    }

    const idx = models.findIndex((m) => m.id === model.id);
    if (idx === -1) {
      return NextResponse.json({ error: `Model "${model.id}" not found` }, { status: 404 });
    }

    models.splice(idx, 1);

    if (record) {
      await prisma.secret.update({
        where: { id: record.id },
        data: { metadata: { models } as any, updatedAt: new Date() },
      });
    }

    logger.info({ msg: "Custom AI model removed", modelId: model.id });
    return NextResponse.json({ success: true, models });
  } catch (err) {
    logger.error({ msg: "Failed to manage custom models", error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * GET /api/admin/ai/custom-models — List custom AI models
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let models: CustomModel[] = [];
    try {
      const record = await prisma.secret.findFirst({ where: { name: "ai_custom_models" } });
      if (record?.metadata && Array.isArray((record.metadata as any).models)) {
        models = (record.metadata as any).models;
      }
    } catch { /* DB not available */ }

    return NextResponse.json({ models });
  } catch (err) {
    logger.error({ msg: "Failed to list custom models", error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
