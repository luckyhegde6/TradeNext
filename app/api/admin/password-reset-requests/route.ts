import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPendingPasswordResetRequests } from "@/lib/services/userService";
import logger from "@/lib/logger";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await auth();

    if (!session || !session.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const requests = await getPendingPasswordResetRequests();
    return NextResponse.json(requests);
  } catch (error) {
    logger.error({ msg: "Failed to fetch password reset requests", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Failed to fetch requests" }, { status: 500 });
  }
}