import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { createAuditLog } from "@/lib/audit";
import { filterGroupSchema } from "@/lib/screener/condition-tree";

export const runtime = "nodejs";

/**
 * GET /api/alerts/rules — list user's alert rules
 * Query params: isActive (boolean)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = parseInt(session.user.id);
    const url = new URL(req.url);
    const isActive = url.searchParams.get("isActive");

    const where: any = { userId };
    if (isActive !== null) {
      where.isActive = isActive === "true";
    }

    const rules = await prisma.alertRule.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(rules);
  } catch (error) {
    logger.error({
      msg: "Failed to list alert rules",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Failed to list alert rules" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/alerts/rules — create a new alert rule
 * Body: { name, description?, condition (FilterGroup), channels?, schedule?, escalation?, action? }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = parseInt(session.user.id);

    const body = await req.json();
    const { name, description, condition, channels, schedule, escalation, action } = body;

    if (!name || !condition) {
      return NextResponse.json(
        { error: "Name and condition (FilterGroup) are required" },
        { status: 400 }
      );
    }

    // Validate condition as a FilterGroup
    try {
      filterGroupSchema.parse(condition);
    } catch {
      return NextResponse.json(
        { error: "Invalid FilterGroup condition structure" },
        { status: 400 }
      );
    }

    const rule = await prisma.alertRule.create({
      data: {
        userId,
        name,
        description,
        condition: condition as any,
        channels: channels || [],
        schedule: schedule || undefined,
        escalation: escalation || undefined,
        action: action || undefined,
        isActive: true,
      },
    });

    await createAuditLog({
      userId,
      action: "ALERT_RULE_CREATE",
      resource: "AlertRule",
      resourceId: rule.id,
      metadata: { name },
    });

    logger.info({ msg: "Alert rule created", ruleId: rule.id, userId, name });
    return NextResponse.json(rule, { status: 201 });
  } catch (error) {
    logger.error({
      msg: "Failed to create alert rule",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Failed to create alert rule" },
      { status: 500 }
    );
  }
}
