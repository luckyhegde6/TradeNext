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
// the persisted worker_status heartbeat rows — the daemon's own row AND the
// shared leader-cron-daemon row (v3.37.0, issue #119 Fix 5) — in `next start`
// (single server bundle) both agree.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import {
  getCronDaemonStatus,
  isDaemonHeartbeatFresh,
  DAEMON_ID,
} from "@/lib/services/worker/cron-daemon";
import { leaderWorkerId, LEADER_STALENESS_MS } from "@/lib/services/leader";
import logger from "@/lib/logger";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await auth();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const status = getCronDaemonStatus();
    const [heartbeat, leaderRow] = await Promise.all([
      prisma.workerStatus
        .findUnique({ where: { workerId: DAEMON_ID } })
        .catch(() => null),
      // v3.37.0 (issue #119 Fix 5): the in-process daemon ALSO refreshes the
      // shared leader-cron-daemon row (watchLeaderRole heartbeats it every
      // LEADER_HEARTBEAT_MS), so even in a split module graph the leader row
      // proves the scheduler is alive on SOME instance of this server.
      prisma.workerStatus
        .findUnique({ where: { workerId: leaderWorkerId("cron-daemon") } })
        .catch(() => null),
    ]);
    const lastHeartbeatAt =
      [status.lastHeartbeatAt, heartbeat?.lastHeartbeat, leaderRow?.lastHeartbeat]
        .filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()))
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const leaderFresh =
      leaderRow?.lastHeartbeat != null &&
      Date.now() - leaderRow.lastHeartbeat.getTime() < LEADER_STALENESS_MS;
    const running = status.running || isDaemonHeartbeatFresh(lastHeartbeatAt) || leaderFresh;
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
