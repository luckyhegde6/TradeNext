/**
 * PUT/DELETE /api/screener/configs/:id
 *
 * Update or delete a saved scan configuration.
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { filterGroupSchema } from "@/lib/screener/condition-tree";
import logger from "@/lib/logger";

export const runtime = "nodejs";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();

    // Verify ownership
    const existing = await prisma.scanConfig.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Config not found" }, { status: 404 });
    }
    if (existing.userId !== Number(session.user.id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Validate filterGroup if provided
    if (body.filterGroup) {
      const result = filterGroupSchema.safeParse(body.filterGroup);
      if (!result.success) {
        return NextResponse.json({ error: "Invalid filterGroup", details: result.error.issues }, { status: 400 });
      }
    }

    const updated = await prisma.scanConfig.update({
      where: { id },
      data: {
        name: body.name ?? undefined,
        description: body.description ?? undefined,
        filters: body.filterGroup ?? undefined,
        columns: body.columns ?? undefined,
        schedule: body.schedule ?? undefined,
        isPublic: body.isPublic ?? undefined,
      },
    });

    logger.info({ msg: "Scan config updated", id, userId: session.user.id });

    return NextResponse.json({ success: true, config: updated });
  } catch (error) {
    logger.error({ msg: "Failed to update scan config", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to update scan config" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    const existing = await prisma.scanConfig.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Config not found" }, { status: 404 });
    }
    if (existing.userId !== Number(session.user.id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await prisma.scanConfig.delete({ where: { id } });

    logger.info({ msg: "Scan config deleted", id, userId: session.user.id });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ msg: "Failed to delete scan config", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to delete scan config" }, { status: 500 });
  }
}
