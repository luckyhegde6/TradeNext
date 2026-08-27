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
 * This ensures cron jobs run in production without manual admin intervention
 */
function autoStartEngine() {
    if (autoStarted) return;
    
    try {
        startWorker(30_000); // v3.20.1: 30s polling (was 5s — saves ~14,400 DB reads/day)
        // v3.20.1: Legacy scheduler removed — cron daemon handles scheduling
        // (avoids duplicate cronJob.findMany queries every 60s).
        startCronDaemon().catch((error) => logger.error({ msg: "Failed to auto-start cron daemon", error }));
        logger.info({ msg: "Worker engine auto-started on first request" });
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
            startWorker(30_000); // v3.20.1: 30s polling (was 5s)
            // v3.20.1: Legacy scheduler removed — cron daemon handles scheduling
            await startCronDaemon(); // v3.11.0: node-cron scheduler daemon
            logger.info({ msg: "Background services started via API" });
            return NextResponse.json({ success: true, message: "Services started" });
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
