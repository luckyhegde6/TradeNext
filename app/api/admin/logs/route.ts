// app/api/admin/logs/route.ts - Server logs API for admin monitoring
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDbLogs, getLogStats } from "@/lib/services/db-logger";
import { readLog, getAllLogFiles, cleanupLogs } from "@/lib/services/worker/worker-logger";
import type { LogLevel } from "@/lib/services/db-logger";

/**
 * GET /api/admin/logs
 * Get server logs with filtering options
 */
export async function GET(request: NextRequest) {
  // Check authentication
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check admin role
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const searchParams = request.nextUrl.searchParams;
  const type = searchParams.get("type"); // "db" | "worker" | "files" | "stats"
  const level = searchParams.get("level") as LogLevel | null;
  const source = searchParams.get("source");
  const taskId = searchParams.get("taskId");
  const limit = parseInt(searchParams.get("limit") || "100");
  const offset = parseInt(searchParams.get("offset") || "0");

  // Return stats
  if (type === "stats") {
    try {
      const stats = await getLogStats();
      return NextResponse.json(stats);
    } catch (error) {
      return NextResponse.json({ error: "Failed to get stats" }, { status: 500 });
    }
  }

  // Return worker file logs
  if (type === "files") {
    try {
      const files = getAllLogFiles();
      return NextResponse.json({ files });
    } catch (error) {
      return NextResponse.json({ error: "Failed to get files" }, { status: 500 });
    }
  }

  // Return specific worker log content
  if (taskId && (type === "worker" || type === "content")) {
    try {
      const content = await readLog(taskId);
      return NextResponse.json({ taskId, content });
    } catch (error) {
      return NextResponse.json({ error: "Failed to read log" }, { status: 500 });
    }
  }

  // Default: Return DB logs
  try {
    const result = await getDbLogs({
      level: level || undefined,
      source: source || undefined,
      taskId: taskId || undefined,
      limit,
      offset,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: "Failed to get logs" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/logs
 * Cleanup old logs
 */
export async function DELETE(request: NextRequest) {
  // Check authentication
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check admin role
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const searchParams = request.nextUrl.searchParams;
  const retentionDays = parseInt(searchParams.get("retentionDays") || "7");

  try {
    const deleted = await cleanupLogs(retentionDays);
    return NextResponse.json({ deleted, retentionDays });
  } catch (error) {
    return NextResponse.json({ error: "Failed to cleanup logs" }, { status: 500 });
  }
}
