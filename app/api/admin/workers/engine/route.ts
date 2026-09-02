// app/api/admin/workers/engine/route.ts
import { NextResponse } from "next/server";
import { startWorker, stopWorkerEngine } from "@/lib/services/worker/worker-engine";
import { startCronDaemon, stopCronDaemon } from "@/lib/services/worker/cron-daemon";
import logger from "@/lib/logger";
import { auth } from "@/lib/auth";

// Lazy initialization flag
let autoStarted = false;

/**
 * Auto-start the worker engine on first request (lazy initialization)
 * This ensures cron jobs run in production without manual admin intervention.
 *
 * LEADER GATE (v3.22.0): only the elected leader instance actually starts the
 * engine/daemon, so a multi-instance deploy doesn't run N poll loops + N cron
 * schedulers. Other instances log "standby awaiting leadership" and rely on the
 * DB-back leader lock takeover when the current leader dies.
 */
async function autoStartEngine() {
    if (autoStarted) return;

    try {
        const leader = await import("@/lib/services/leader");
        const workerLeader = await leader.acquireLeaderLock("worker");
        if (workerLeader) {
            startWorker(30_000); // v3.20.1: 30s polling (was 5s — saves ~14,400 DB reads/day)
        }
        const cronLeader = await leader.acquireLeaderLock("cron-daemon");
        if (cronLeader) {
            // v3.20.1: Legacy scheduler removed — cron daemon handles scheduling
            // (avoids duplicate cronJob.findMany queries every 60s).
            startCronDaemon().catch((error) => logger.error({ msg: "Failed to auto-start cron daemon", error }));
        } else {
            logger.warn({ msg: "Engine auto-start skipped (another instance leads)", self: leader.LEADER_SELF });
        }
        logger.info({ msg: "Worker engine auto-start evaluated", workerLeader, cronLeader });
        autoStarted = true;
    } catch (error) {
        logger.error({ msg: "Failed to auto-start worker engine", error });
    }
}

export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session || session.user?.role !== "admin") {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { action } = await req.json();

        if (action === "start") {
            const leader = await import("@/lib/services/leader");
            const workerLeader = await leader.acquireLeaderLock("worker");
            if (workerLeader) {
                startWorker(30_000); // v3.20.1: 30s polling (was 5s)
            }
            const cronLeader = await leader.acquireLeaderLock("cron-daemon");
            if (cronLeader) {
                // v3.20.1: Legacy scheduler removed — cron daemon handles scheduling
                await startCronDaemon(); // v3.11.0: node-cron scheduler daemon
            }
            logger.info({ msg: "Background services start evaluated via API", workerLeader, cronLeader });
            return NextResponse.json({
                success: true,
                message: workerLeader || cronLeader ? "Services started (leader gate)" : "Another instance is the active leader — standing by",
                workerLeader,
                cronLeader,
            });
        } else if (action === "stop") {
            stopWorkerEngine();
            stopCronDaemon(); // v3.11.0
            logger.info({ msg: "Background services stopped via API" });
            return NextResponse.json({ success: true, message: "Services stopped" });
        }

        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    } catch (error) {
        logger.error({ msg: "Engine control error", error });
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function GET(req: Request) {
    try {
        // Auto-start engine on first GET request (lazy initialization)
        autoStartEngine();
        
        const session = await auth();
        if (!session || session.user?.role !== "admin") {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // In a real multi-node env, this would check a global flag or local variable
        // For this implementation, we'll return a placeholder status
        return NextResponse.json({
            isRunning: autoStarted,
            workerId: process.pid
        });
    } catch (error) {
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
