// app/api/admin/workers/logs/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAllLogFiles, readLog, deleteLog } from "@/lib/services/worker/worker-logger";
import logger from "@/lib/logger";

export const runtime = "nodejs";

// GET - List all log files or read a specific log
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const taskId = searchParams.get("taskId");

    if (taskId) {
      const content = await readLog(taskId);
      return NextResponse.json({ taskId, content });
    }

    // List all log files
    const files = getAllLogFiles();
    return NextResponse.json({ files });
  } catch (error) {
    logger.error({ msg: "Failed to fetch worker logs", error });
    return NextResponse.json({ error: "Failed to fetch worker logs" }, { status: 500 });
  }
}

// DELETE - Delete a log file
export async function DELETE(req: Request) {
  try {
    const session = await auth();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const taskId = searchParams.get("taskId");

    if (!taskId) {
      return NextResponse.json({ error: "Missing taskId" }, { status: 400 });
    }

    const deleted = await deleteLog(taskId);

    if (deleted) {
      logger.info({ msg: "Worker log deleted", taskId });
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json({ error: "Log file not found" }, { status: 404 });
    }
  } catch (error) {
    logger.error({ msg: "Failed to delete worker log", error });
    return NextResponse.json({ error: "Failed to delete worker log" }, { status: 500 });
  }
}
