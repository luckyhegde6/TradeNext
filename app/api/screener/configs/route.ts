import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

export const dynamic = 'force-dynamic';

/**
 * GET /api/screener/configs
 * List all scan configs for the current user.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = typeof session.user.id === 'string' ? parseInt(session.user.id) : session.user.id;

    const configs = await prisma.scanConfig.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        description: true,
        isPublic: true,
        schedule: true,
        lastRunAt: true,
        runCount: true,
        createdAt: true,
        updatedAt: true,
        // Exclude filters/columns for list view (load individually)
      },
    });

    return NextResponse.json(configs);
  } catch (error) {
    logger.error({ msg: "Failed to list scan configs", error });
    return NextResponse.json({ error: "Failed to list configs" }, { status: 500 });
  }
}

/**
 * POST /api/screener/configs
 * Create a new scan configuration.
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = typeof session.user.id === 'string' ? parseInt(session.user.id) : session.user.id;
    const body = await req.json();

    if (!body.name || !body.filters) {
      return NextResponse.json({ error: "Name and filters are required" }, { status: 400 });
    }

    // Validate filter group has at least one condition
    const hasConditions = body.filters.conditions?.length > 0 || body.filters.groups?.length > 0;
    if (!hasConditions) {
      return NextResponse.json({ error: "Filter must have at least one condition" }, { status: 400 });
    }

    const config = await prisma.scanConfig.create({
      data: {
        userId,
        name: body.name,
        description: body.description || null,
        filters: body.filters,
        columns: body.columns || null,
        schedule: body.schedule || null,
        isPublic: body.isPublic || false,
      },
    });

    logger.info({ msg: "Scan config created", configId: config.id, userId, name: config.name });

    return NextResponse.json(config, { status: 201 });
  } catch (error) {
    logger.error({ msg: "Failed to create scan config", error });
    return NextResponse.json({ error: "Failed to create config" }, { status: 500 });
  }
}
