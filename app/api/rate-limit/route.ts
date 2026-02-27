import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

const RATE_LIMIT_WINDOW = 60; // seconds
const MAX_REQUESTS = 10; // max requests per window

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseInt(session.user.id as string);
    const { searchParams } = new URL(req.url);
    const endpoint = searchParams.get('endpoint') || 'refresh';

    const rateLimit = await prisma.rateLimit.findUnique({
      where: {
        userId_endpoint: { userId, endpoint },
      },
    });

    if (!rateLimit) {
      return NextResponse.json({
        allowed: true,
        remaining: MAX_REQUESTS,
        resetIn: RATE_LIMIT_WINDOW,
      });
    }

    const now = new Date();
    const windowStart = new Date(rateLimit.windowStart);
    const secondsSinceWindowStart = (now.getTime() - windowStart.getTime()) / 1000;

    if (secondsSinceWindowStart >= RATE_LIMIT_WINDOW) {
      return NextResponse.json({
        allowed: true,
        remaining: MAX_REQUESTS,
        resetIn: RATE_LIMIT_WINDOW,
      });
    }

    const remaining = MAX_REQUESTS - rateLimit.requestCount;

    return NextResponse.json({
      allowed: remaining > 0,
      remaining: Math.max(0, remaining),
      resetIn: Math.ceil(RATE_LIMIT_WINDOW - secondsSinceWindowStart),
      isFlagged: rateLimit.isFlagged,
    });
  } catch (error) {
    console.error('Rate limit check error:', error);
    return NextResponse.json({ error: "Failed to check rate limit" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = parseInt(session.user.id as string);
    const { searchParams } = new URL(req.url);
    const endpoint = searchParams.get('endpoint') || 'refresh';

    const now = new Date();

    const rateLimit = await prisma.rateLimit.findUnique({
      where: {
        userId_endpoint: { userId, endpoint },
      },
    });

    if (!rateLimit) {
      await prisma.rateLimit.create({
        data: {
          userId,
          endpoint,
          requestCount: 1,
          windowStart: now,
          lastRequestAt: now,
        },
      });

      return NextResponse.json({
        allowed: true,
        remaining: MAX_REQUESTS - 1,
        resetIn: RATE_LIMIT_WINDOW,
      });
    }

    const windowStart = new Date(rateLimit.windowStart);
    const secondsSinceWindowStart = (now.getTime() - windowStart.getTime()) / 1000;

    let newRequestCount: number;
    let newWindowStart: Date;

    if (secondsSinceWindowStart >= RATE_LIMIT_WINDOW) {
      newRequestCount = 1;
      newWindowStart = now;
    } else {
      newRequestCount = rateLimit.requestCount + 1;
      newWindowStart = windowStart;
    }

    if (newRequestCount > MAX_REQUESTS) {
      const isFlagged = rateLimit.isFlagged || (newRequestCount > MAX_REQUESTS * 2);

      await prisma.rateLimit.update({
        where: { userId_endpoint: { userId, endpoint } },
        data: {
          requestCount: newRequestCount,
          windowStart: newWindowStart,
          lastRequestAt: now,
          isFlagged,
        },
      });

      return NextResponse.json(
        {
          error: "Too many requests",
          retryAfter: Math.ceil(RATE_LIMIT_WINDOW - secondsSinceWindowStart),
          isFlagged,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil(RATE_LIMIT_WINDOW - secondsSinceWindowStart)),
            'X-RateLimit-Limit': String(MAX_REQUESTS),
            'X-RateLimit-Remaining': '0',
          },
        }
      );
    }

    const isFlagged = rateLimit.isFlagged || (newRequestCount > MAX_REQUESTS * 1.5);

    await prisma.rateLimit.update({
      where: { userId_endpoint: { userId, endpoint } },
      data: {
        requestCount: newRequestCount,
        windowStart: newWindowStart,
        lastRequestAt: now,
        isFlagged,
      },
    });

    return NextResponse.json({
      allowed: true,
      remaining: MAX_REQUESTS - newRequestCount,
      resetIn: Math.ceil(RATE_LIMIT_WINDOW - secondsSinceWindowStart),
    });
  } catch (error) {
    console.error('Rate limit update error:', error);
    return NextResponse.json({ error: "Failed to update rate limit" }, { status: 500 });
  }
}
