// app/api/admin/workers/engine/route.ts
import { NextResponse } from "next/server";
import { startWorker, startScheduler, stopWorkerEngine } from "@/lib/services/worker/worker-engine";
import logger from "@/lib/logger";
import { auth } from "@/lib/auth";

export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session || session.user?.role !== "admin") {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { action } = await req.json();

        if (action === "start") {
            startWorker(5000); // 5s polling
            startScheduler(60000); // 1m check
            logger.info({ msg: "Background services started via API" });
            return NextResponse.json({ success: true, message: "Services started" });
        } else if (action === "stop") {
            stopWorkerEngine();
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
        const session = await auth();
        if (!session || session.user?.role !== "admin") {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // In a real multi-node env, this would check a global flag or local variable
        // For this implementation, we'll return a placeholder status
        return NextResponse.json({
            isRunning: true, // Assuming it might be running if the process is alive
            workerId: process.pid
        });
    } catch (error) {
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
