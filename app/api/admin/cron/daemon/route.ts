// app/api/admin/cron/daemon/route.ts
// Cron daemon liveness for the admin Cron tab (v3.11.0).
// The daemon runs in-process (see instrumentation.ts); this endpoint reports
// whether it is running on THIS server instance, how many jobs are registered
// on the node-cron scheduler, and the last heartbeat age.
//
// Dev caveat: Turbopack dev may bundle cron-daemon.ts separately for the
// instrumentation entry vs this route, so the in-memory module state here can
// read as "not running" even though the real daemon (same daemonId) is alive
// and heartbeating in the instrumentation context. We therefore cross-check
// the persisted worker_status heartbeat row — in `next start` (single server
// bundle) both agree.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import {
  getCronDaemonStatus,
  isDaemonHeartbeatFresh,
  DAEMON_ID,
} from "@/lib/services/worker/cron-daemon";
import logger from "@/lib/logger";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await auth();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const status = getCronDaemonStatus();
    const heartbeat = await prisma.workerStatus
      .findUnique({ where: { workerId: DAEMON_ID } })
      .catch(() => null);
    const lastHeartbeatAt = heartbeat?.lastHeartbeat ?? status.lastHeartbeatAt;
    const running = isDaemonHeartbeatFresh(lastHeartbeatAt) || status.running;
    return NextResponse.json({
      ...status,
      running,
      lastHeartbeatAt,
      lastHeartbeatAgeMs: lastHeartbeatAt ? Date.now() - lastHeartbeatAt.getTime() : null,
    });
  } catch (error) {
    logger.error({ msg: "Failed to read cron daemon status", error });
    return NextResponse.json({ error: "Failed to read daemon status" }, { status: 500 });
  }
}
