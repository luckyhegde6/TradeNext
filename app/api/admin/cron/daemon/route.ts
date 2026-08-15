// app/api/admin/cron/daemon/route.ts
// Cron daemon liveness for the admin Cron tab (v3.11.0).
// The daemon runs in-process (see instrumentation.ts); this endpoint reports
// whether it is running on THIS server instance, how many jobs are registered
// on the node-cron scheduler, and the last heartbeat age.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCronDaemonStatus } from "@/lib/services/worker/cron-daemon";
import logger from "@/lib/logger";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await auth();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const status = getCronDaemonStatus();
    return NextResponse.json({
      ...status,
      lastHeartbeatAgeMs: status.lastHeartbeatAt ? Date.now() - status.lastHeartbeatAt.getTime() : null,
    });
  } catch (error) {
    logger.error({ msg: "Failed to read cron daemon status", error });
    return NextResponse.json({ error: "Failed to read daemon status" }, { status: 500 });
  }
}
