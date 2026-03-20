// lib/services/db-logger.ts - Database-backed logger for serverless environments
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

export type LogLevel = "info" | "warn" | "error" | "debug";

export interface LogEntry {
  level: LogLevel;
  message: string;
  source?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

// Default retention period in days
const DEFAULT_RETENTION_DAYS = 7;

/**
 * Log an entry to the database
 */
export async function logToDb(entry: LogEntry): Promise<void> {
  try {
    await prisma.serverLog.create({
      data: {
        level: entry.level,
        message: entry.message,
        source: entry.source || "system",
        taskId: entry.taskId || null,
        metadata: entry.metadata ? (entry.metadata as never) : undefined,
        ipAddress: entry.ipAddress || null,
        userAgent: entry.userAgent || null,
        requestId: entry.requestId || null,
      },
    });
  } catch (error) {
    // If DB logging fails, at least log to console
    console.error("[DB-Logger] Failed to log to database:", error);
    console.log(`[${entry.level.toUpperCase()}] ${entry.message}`, entry.metadata);
  }
}

/**
 * Quick log helpers
 */
export async function dbInfo(message: string, metadata?: Record<string, unknown>, source = "system"): Promise<void> {
  return logToDb({ level: "info", message, source, metadata });
}

export async function dbWarn(message: string, metadata?: Record<string, unknown>, source = "system"): Promise<void> {
  return logToDb({ level: "warn", message, source, metadata });
}

export async function dbError(message: string, metadata?: Record<string, unknown>, source = "system"): Promise<void> {
  return logToDb({ level: "error", message, source, metadata });
}

export async function dbDebug(message: string, metadata?: Record<string, unknown>, source = "system"): Promise<void> {
  return logToDb({ level: "debug", message, source, metadata });
}

/**
 * Get logs from database
 */
export async function getDbLogs(options: {
  level?: LogLevel;
  source?: string;
  taskId?: string;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
} = {}): Promise<{ logs: Array<{
  id: string;
  level: string;
  message: string;
  source: string | null;
  taskId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}>; total: number }> {
  const { level, source, taskId, fromDate, toDate, limit = 100, offset = 0 } = options;

  const where: Record<string, unknown> = {};
  
  if (level) where.level = level;
  if (source) where.source = source;
  if (taskId) where.taskId = taskId;
  
  if (fromDate || toDate) {
    where.createdAt = {};
    if (fromDate) (where.createdAt as Record<string, Date>).gte = fromDate;
    if (toDate) (where.createdAt as Record<string, Date>).lte = toDate;
  }

  const [rawLogs, total] = await Promise.all([
    prisma.serverLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.serverLog.count({ where }),
  ]);

  // Transform logs to ensure metadata is properly typed
  const logs = rawLogs.map((log: typeof rawLogs[number]) => ({
    ...log,
    metadata: log.metadata as Record<string, unknown> | null,
  }));

  return { logs, total };
}

/**
 * Clean up old logs - keeps logs for specified days
 */
export async function cleanupOldLogs(retentionDays = DEFAULT_RETENTION_DAYS): Promise<number> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await prisma.serverLog.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
      },
    });

    logger.info({ msg: "Cleaned up old server logs", deleted: result.count, retentionDays });
    return result.count;
  } catch (error) {
    logger.error({ msg: "Failed to cleanup old logs", error });
    return 0;
  }
}

/**
 * Get log statistics
 */
export async function getLogStats(): Promise<{
  total: number;
  byLevel: Record<string, number>;
  bySource: Record<string, number>;
  oldest: Date | null;
  newest: Date | null;
}> {
  const [total, byLevelRaw, bySourceRaw, oldest, newest] = await Promise.all([
    prisma.serverLog.count(),
    prisma.serverLog.groupBy({
      by: ["level"],
      _count: { id: true },
    }),
    prisma.serverLog.groupBy({
      by: ["source"],
      _count: { id: true },
    }),
    prisma.serverLog.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.serverLog.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);

  const byLevel: Record<string, number> = {};
  for (const item of byLevelRaw) {
    byLevel[item.level] = item._count.id;
  }

  const bySource: Record<string, number> = {};
  for (const item of bySourceRaw) {
    bySource[item.source || "null"] = item._count.id;
  }

  return {
    total,
    byLevel,
    bySource,
    oldest: oldest?.createdAt || null,
    newest: newest?.createdAt || null,
  };
}
