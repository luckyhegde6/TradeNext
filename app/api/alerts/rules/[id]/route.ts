import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { createAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * GET /api/alerts/rules/:id — get a single alert rule
 */
export async function GET(
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

    const rule = await prisma.alertRule.findFirst({
      where: { id, userId },
    });

    if (!rule) {
      return NextResponse.json({ error: "Alert rule not found" }, { status: 404 });
    }

    return NextResponse.json(rule);
  } catch (error) {
    logger.error({
      msg: "Failed to get alert rule",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Failed to get alert rule" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/alerts/rules/:id — update an alert rule
 */
export async function PUT(
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

    // Verify ownership
    const existing = await prisma.alertRule.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Alert rule not found" }, { status: 404 });
    }

    const body = await req.json();
    const { name, description, condition, channels, schedule, escalation, action, isActive } = body;

    const data: any = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (condition !== undefined) data.condition = condition;
    if (channels !== undefined) data.channels = channels;
    if (schedule !== undefined) data.schedule = schedule;
    if (escalation !== undefined) data.escalation = escalation;
    if (action !== undefined) data.action = action;
    if (isActive !== undefined) data.isActive = isActive;

    const rule = await prisma.alertRule.update({
      where: { id },
      data,
    });

    await createAuditLog({
      userId,
      action: "ALERT_RULE_UPDATE",
      resource: "AlertRule",
      resourceId: id,
      metadata: { name },
    });

    logger.info({ msg: "Alert rule updated", ruleId: id, userId });
    return NextResponse.json(rule);
  } catch (error) {
    logger.error({
      msg: "Failed to update alert rule",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Failed to update alert rule" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/alerts/rules/:id — delete an alert rule
 */
export async function DELETE(
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

    // Verify ownership
    const existing = await prisma.alertRule.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Alert rule not found" }, { status: 404 });
    }

    await prisma.alertRule.delete({ where: { id } });

    await createAuditLog({
      userId,
      action: "ALERT_RULE_DELETE",
      resource: "AlertRule",
      resourceId: id,
      metadata: { name: existing.name },
    });

    logger.info({ msg: "Alert rule deleted", ruleId: id, userId });
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({
      msg: "Failed to delete alert rule",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Failed to delete alert rule" },
      { status: 500 }
    );
  }
}
