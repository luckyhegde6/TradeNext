import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getUserProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  validateTargets,
} from "@/lib/services/rebalancerService";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * GET /api/portfolio/rebalancer/config — List user's rebalancer profiles
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = Number(session.user.id);
    const profiles = await getUserProfiles(userId);
    return NextResponse.json({ profiles });
  } catch (err) {
    logger.error({ msg: "Failed to list rebalancer configs", error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/portfolio/rebalancer/config — Create a new profile
 * Body: { name?: string, categories: AllocationCategory[], driftThreshold?: number }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = Number(session.user.id);
    const body = await req.json();

    if (!body.categories || !Array.isArray(body.categories)) {
      return NextResponse.json(
        { error: "categories array is required" },
        { status: 400 }
      );
    }

    const validation = validateTargets(body.categories);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const profile = await createProfile(userId, body);
    return NextResponse.json({ profile }, { status: 201 });
  } catch (err) {
    logger.error({ msg: "Failed to create rebalancer config", error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PUT /api/portfolio/rebalancer/config — Update a profile
 * Query: ?id=xxx
 * Body: { name?, categories?, driftThreshold? }
 */
export async function PUT(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = Number(session.user.id);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Profile ID required" }, { status: 400 });
    }

    const body = await req.json();
    if (body.categories) {
      const validation = validateTargets(body.categories);
      if (!validation.valid) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }
    }

    const profile = await updateProfile(id, userId, body);
    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }
    return NextResponse.json({ profile });
  } catch (err) {
    logger.error({ msg: "Failed to update rebalancer config", error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/portfolio/rebalancer/config — Delete a profile
 * Query: ?id=xxx
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = Number(session.user.id);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Profile ID required" }, { status: 400 });
    }

    const deleted = await deleteProfile(id, userId);
    if (!deleted) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error({ msg: "Failed to delete rebalancer config", error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
