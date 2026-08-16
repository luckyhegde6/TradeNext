// lib/services/worker/worker-logger.ts
// Worker logger — file logging with DB logging fallback.

import { logToDb, cleanupOldLogs } from "@/lib/services/db-logger";
import logger from "@/lib/logger";

// Track if file logging is available
let fileLoggingAvailable = true;

// ── logs-dir resolution (v3.12.0) ──────────────────────────────────────────
// Netlify's prod filesystem is read-only except /tmp — mkdirSync of
// `<cwd>/.next/server_logs` threw ENOENT, which permanently disabled worker
// file logging on every prod boot (`[WorkerLogger] File logging disabled:
// Error: ENOENT mkdir '/var/task/.next/server_logs'`). Resolution order —
// first writable candidate wins, remembered for the process:
//   1. <cwd>/.next/server_logs   (local dev — existing behavior)
//   2. <os.tmpdir()>/tradenext-logs   (Netlify — /tmp is writable)
//   3. "" (no file logging — the DB log fallback takes over)
let resolvedLogsDir: string | undefined;

export function resolveLogsDir(): string {
  if (resolvedLogsDir !== undefined) return resolvedLogsDir;
  const fs = require("fs");
  const path = require("path");
  const os = require("os");
  const candidates = [
    path.join(process.cwd(), ".next", "server_logs"),
    path.join(os.tmpdir(), "tradenext-logs"),
  ];
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o777 });
      resolvedLogsDir = dir;
      return dir;
    } catch {
      // candidate not writable — try the next one
    }
  }
  resolvedLogsDir = "";
  return "";
}

/**
 * Sanitize task ID for safe filesystem usage
 * Prevents path traversal attacks by allowing only safe filename characters
 * @returns Sanitized taskId or null if invalid
 */
const sanitizeTaskIdForPath = (taskId: string): string | null => {
  // Limit length to prevent abuse
  const trimmed = taskId.trim();
  if (!trimmed || trimmed.length > 128) {
    return null;
  }
  // Allow only safe filename characters (no path separators or traversal)
  const safePattern = /^[A-Za-z0-9_\-:.]+$/;
  if (!safePattern.test(trimmed)) {
    return null;
  }
  return trimmed;
};

/**
 * Log to both file (if available) and DB
 */
async function writeToBoth(taskId: string, level: string, message: string, data?: unknown): Promise<void> {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}${data ? ` ${JSON.stringify(data)}` : ""}`;

  // Try file logging first
  if (fileLoggingAvailable) {
    try {
      // Only use sanitized taskId - already validated by sanitizeTaskIdForPath
      const safeTaskId = sanitizeTaskIdForPath(taskId);
      if (!safeTaskId) {
        // Invalid taskId - skip file logging, fall through to DB
        throw new Error("Invalid taskId");
      }
      
      const fs = require("fs");
      const path = require("path");
      const logsDir = resolveLogsDir();
      if (!logsDir) {
        throw new Error("No writable logs directory");
      }
      
      // Use only the validated safeTaskId - no user input in path construction
      const logFileName = safeTaskId + ".log";
      const logFile = path.join(logsDir, logFileName);
      
      // Security: Verify path is within logsDir to prevent traversal
      if (!logFile.startsWith(logsDir + path.sep)) {
        throw new Error("Path traversal attempt detected");
      }
      
      fs.appendFileSync(logFile, logEntry + "\n");
      return;
    } catch (error) {
      // File logging failed, disable it
      fileLoggingAvailable = false;
      console.warn("[WorkerLogger] File logging disabled:", error);
    }
  }

  // DB fallback - always works
  await logToDb({
    level: level as "info" | "warn" | "error" | "debug",
    message,
    source: "worker",
    taskId,
    metadata: data as Record<string, unknown> | undefined,
  });
}

/**
 * Write log entry
 */
export async function writeLog(taskId: string, level: string, message: string, data?: unknown): Promise<void> {
  try {
    await writeToBoth(taskId, level, message, data);
  } catch (error) {
    // Last resort: console only
    console.error(`[${level.toUpperCase()}] ${message}`, data);
  }
}

/**
 * Read log for a task
 */
export async function readLog(taskId: string): Promise<string> {
  // Try file log
  try {
    // Only use sanitized taskId - already validated by sanitizeTaskIdForPath
    const safeTaskId = sanitizeTaskIdForPath(taskId);
    if (safeTaskId) {
      const fs = require("fs");
      const path = require("path");
      const logsDir = resolveLogsDir();
      // Use only the validated safeTaskId - no user input in path construction
      const logFileName = safeTaskId + ".log";
      const logFile = path.join(logsDir, logFileName);

      // Security: Verify path is within logsDir to prevent traversal
      if (logFile.startsWith(logsDir + path.sep)) {
        if (fs.existsSync(logFile)) {
          return fs.readFileSync(logFile, "utf-8");
        }
      }
    }
  } catch (error) {
    // Continue to DB
  }

  // DB fallback - get from server logs
  try {
    const { getDbLogs } = await import("@/lib/services/db-logger");
    const { logs } = await getDbLogs({ taskId, limit: 1000 });
    if (logs.length > 0) {
      return logs
        .map(log => `[${log.createdAt.toISOString()}] [${log.level.toUpperCase()}] ${log.message}`)
        .join("\n");
    }
  } catch (error) {
    // DB also failed
  }

  return "";
}

/**
 * Get list of all log files
 */
export function getAllLogFiles(): { taskId: string; path: string; size: number; created: Date }[] {
  try {
    const fs = require("fs");
    const path = require("path");
    const logsDir = resolveLogsDir();
    
    if (!logsDir || !fs.existsSync(logsDir)) {
      return [];
    }

    const files = fs.readdirSync(logsDir);

    return files
      .filter((f: string) => f.endsWith(".log"))
      .map((f: string) => {
        const taskId = f.replace(".log", "");
        const filePath = path.join(logsDir, f);
        const stats = fs.statSync(filePath);

        return {
          taskId,
          path: filePath,
          size: stats.size,
          created: stats.birthtime,
        };
      })
      .sort((a: { created: Date }, b: { created: Date }) => b.created.getTime() - a.created.getTime());
  } catch (error) {
    logger.warn({ msg: "Failed to get log files", error });
    return [];
  }
}

/**
 * Delete log file
 */
export async function deleteLog(taskId: string): Promise<boolean> {
  let deleted = false;

  // Delete local file
  try {
    // Only use sanitized taskId - already validated by sanitizeTaskIdForPath
    const safeTaskId = sanitizeTaskIdForPath(taskId);
    if (safeTaskId) {
      const fs = require("fs");
      const path = require("path");
      const logsDir = resolveLogsDir();
      // Use only the validated safeTaskId - no user input in path construction
      const logFileName = safeTaskId + ".log";
      const logFile = path.join(logsDir, logFileName);

      // Security: Verify path is within logsDir to prevent traversal
      if (logsDir && logFile.startsWith(logsDir + path.sep) && fs.existsSync(logFile)) {
        fs.unlinkSync(logFile);
        deleted = true;
      }
    }
  } catch (error) {
    // Continue
  }

  return deleted;
}

/**
 * Create a logger instance for a specific task
 */
export function createTaskLogger(taskId: string) {
  return {
    info: (message: string, data?: unknown) => writeLog(taskId, "INFO", message, data),
    warn: (message: string, data?: unknown) => writeLog(taskId, "WARN", message, data),
    error: (message: string, data?: unknown) => writeLog(taskId, "ERROR", message, data),
    debug: (message: string, data?: unknown) => writeLog(taskId, "DEBUG", message, data),
    read: () => readLog(taskId),
  };
}

/**
 * Cleanup old logs - call this periodically
 */
export async function cleanupLogs(retentionDays = 7): Promise<number> {
  // Cleanup DB logs
  const deletedFromDb = await cleanupOldLogs(retentionDays);
  
  // Cleanup file logs
  let deletedFromFiles = 0;
  try {
      const fs = require("fs");
      const path = require("path");
      const logsDir = resolveLogsDir();
      const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
      
      if (logsDir && fs.existsSync(logsDir)) {
    const files = fs.readdirSync(logsDir).filter((f: string) => f.endsWith(".log"));
      
        for (const file of files) {
          const filePath = path.join(logsDir, file);
          const stats = fs.statSync(filePath);
          if (stats.mtimeMs < cutoffTime) {
            fs.unlinkSync(filePath);
            deletedFromFiles++;
          }
        }
      }
    } catch (error) {
      logger.warn({ msg: "Failed to cleanup file logs", error });
    }

  return deletedFromDb + deletedFromFiles;
}
