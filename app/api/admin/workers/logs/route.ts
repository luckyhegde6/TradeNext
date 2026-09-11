// app/api/admin/workers/logs/route.ts
// Worker task logs — list / read / delete (Fix 2, issue #119).
// The admin Workers page's Logs tab had called /api/admin/workers/logs since
// v3.14.0 but NO route existed, so every fetch 404'd and the tab was dead
// ("no execution logs in timeline" on prod incident #119).
//
// Contract (matches the page fetches):
//   GET /api/admin/workers/logs            -> { files: {taskId,path,size,created}[] }
//   GET /api/admin/workers/logs?taskId=    -> { content: string }
//   DELETE /api/admin/workers/logs?taskId= -> { deleted: boolean }
//
// Auth mirrors the cron/daemon route (auth() + admin role → else 401) — NOT
// the no-auth workers/status heartbeat POST.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getAllLogFiles,
  readLog,
  deleteLog,
} from "@/lib/services/worker/worker-logger";
import logger from "@/lib/logger";

export const runtime = "nodejs";

const MAX_TASK_ID_LEN = 128;

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const taskId = searchParams.get("taskId")?.trim() ?? "";

    if (taskId) {
      // Single-task log read (traversal-guarded + sanitized inside worker-logger)
      if (taskId.length > MAX_TASK_ID_LEN) {
        return NextResponse.json({ error: "Invalid taskId" }, { status: 400 });
      }
      const content = await readLog(taskId);
      return NextResponse.json({ content });
    }

    const files = getAllLogFiles();
    return NextResponse.json({ files });
  } catch (error) {
    logger.error({ msg: "Failed to list worker logs", error });
    return NextResponse.json({ error: "Failed to list worker logs" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await auth();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const taskId = searchParams.get("taskId")?.trim() ?? "";
    if (!taskId || taskId.length > MAX_TASK_ID_LEN) {
      return NextResponse.json({ error: "Invalid taskId" }, { status: 400 });
    }

    const deleted = await deleteLog(taskId);
    return NextResponse.json({ deleted });
  } catch (error) {
    logger.error({ msg: "Failed to delete worker log", error });
    return NextResponse.json({ error: "Failed to delete worker log" }, { status: 500 });
  }
}