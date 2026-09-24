// app/api/decision/evaluate/route.ts
// ph22 Decision engine — public evaluation endpoint (admin-only).
// POST { state, questions[], model? } → engine answers.
// 400 invalid body · 401 non-admin · 503 engine failed/inert · 200 answers.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import { getDecisionClient } from "@/lib/services/decision/client";
import logger from "@/lib/logger";

export const runtime = "nodejs";

const questionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("choice"),
    name: z.string().min(1).max(64),
    options: z.array(z.string().min(1)).min(2).max(8),
    instruction: z.string().max(500).optional(),
    statePath: z.string().max(128).optional(),
  }),
  z.object({
    type: z.literal("score"),
    name: z.string().min(1).max(64),
    criteria: z.array(z.string().min(1)).min(1).max(12),
    instruction: z.string().max(500).optional(),
    statePath: z.string().max(128).optional(),
  }),
  z.object({
    type: z.literal("noul"),
    name: z.string().min(1).max(64),
    instruction: z.string().max(500).optional(),
    statePath: z.string().max(128).optional(),
  }),
]);

const bodySchema = z
  .object({
    state: z.unknown(),
    questions: z.array(questionSchema).min(1).max(10),
    model: z.string().max(128).optional(),
  })
  .refine((b) => JSON.stringify(b.state ?? {}).length <= 16_384, {
    message: "state exceeds 16KB",
  });

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ success: false, error: "Admin only" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? "Invalid payload" },
      { status: 400 },
    );
  }

  const client = getDecisionClient();
  let response;
  try {
    response = await client.evaluate(parsed.data);
  } catch (error) {
    logger.error({
      msg: "Decision engine evaluate failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: "Decision engine unavailable" },
      { status: 503 },
    );
  }

  if (!response) {
    return NextResponse.json(
      {
        success: false,
        error: "Decision engine is inert (DECISION_PROVIDER=none)",
        mode: client.mode(),
      },
      { status: 503 },
    );
  }

  await createAuditLog({
    action: "DECISION_EVALUATED",
    resource: "decision",
    path: "/api/decision/evaluate",
    metadata: {
      questionCount: parsed.data.questions.length,
      provider: response.provider,
      model: response.model,
      latencyMs: response.latencyMs,
    },
  }).catch((err: unknown) =>
    logger.warn({ msg: "Decision evaluate audit failed (non-fatal)", error: err instanceof Error ? err.message : String(err) }),
  );

  return NextResponse.json({ success: true, response }, { status: 200 });
}