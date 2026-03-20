// lib/services/worker/worker-logger.ts
// Worker logger with graceful fallback to DB logging on serverless platforms

import { writeBlobLog, readBlobLog, deleteBlobLog } from "@/lib/netlify-logger";
import { logToDb, cleanupOldLogs } from "@/lib/services/db-logger";
import logger from "@/lib/logger";

// Track if file logging is available
let fileLoggingAvailable = true;

// Check if we're on a serverless platform
const isServerless = () => {
  return !!(process.env.NETLIFY || process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
};

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

  // Try file logging first (only if not serverless)
  if (!isServerless() && fileLoggingAvailable) {
    try {
      const safeTaskId = sanitizeTaskIdForPath(taskId);
      if (!safeTaskId) {
        // Invalid taskId - skip file logging
        throw new Error("Invalid taskId");
      }
      
      const fs = require("fs");
      const path = require("path");
      const logsDir = path.join(process.cwd(), ".next", "server_logs");
      
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true, mode: 0o777 });
      }
      
      const logFile = path.join(logsDir, `${safeTaskId}.log`);
      fs.appendFileSync(logFile, logEntry + "\n");
      return;
    } catch (error) {
      // File logging failed, disable it
      fileLoggingAvailable = false;
      // Don't log error to console on serverless to avoid spam
      if (!isServerless()) {
        console.warn("[WorkerLogger] File logging disabled:", error);
      }
    }
  }

  // Try Netlify Blobs if on Netlify
  if (process.env.NETLIFY) {
    try {
      await writeBlobLog(taskId, logEntry);
      return;
    } catch (error) {
      // Blob logging failed, continue to DB fallback
      console.warn("[WorkerLogger] Blob logging failed:", error);
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
  // Try Netlify Blobs first
  if (process.env.NETLIFY) {
    try {
      const blobContent = await readBlobLog(taskId);
      if (blobContent) return blobContent;
    } catch (error) {
      // Continue to fallback
    }
  }

  // Try file (only if not serverless)
  if (!isServerless()) {
    try {
      const safeTaskId = sanitizeTaskIdForPath(taskId);
      if (safeTaskId) {
        const fs = require("fs");
        const path = require("path");
        const logsDir = path.join(process.cwd(), ".next", "server_logs");
        const logFile = path.join(logsDir, `${safeTaskId}.log`);
        if (fs.existsSync(logFile)) {
          return fs.readFileSync(logFile, "utf-8");
        }
      }
    } catch (error) {
      // Continue to DB
    }
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
  // On serverless, return empty - logs are in DB/Blobs
  if (isServerless()) {
    return [];
  }

  try {
    const fs = require("fs");
    const path = require("path");
    const logsDir = path.join(process.cwd(), ".next", "server_logs");
    
    if (!fs.existsSync(logsDir)) {
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

  // Delete from Netlify Blobs
  if (process.env.NETLIFY) {
    try {
      await deleteBlobLog(taskId);
      deleted = true;
    } catch (error) {
      // Continue
    }
  }

  // Delete local file (only if not serverless)
  if (!isServerless()) {
    try {
      const safeTaskId = sanitizeTaskIdForPath(taskId);
      if (safeTaskId) {
        const fs = require("fs");
        const path = require("path");
        const logsDir = path.join(process.cwd(), ".next", "server_logs");
        const logFile = path.join(logsDir, `${safeTaskId}.log`);
        if (fs.existsSync(logFile)) {
          fs.unlinkSync(logFile);
          deleted = true;
        }
      }
    } catch (error) {
      // Continue
    }
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
  
  // On local/server, also cleanup file logs
  let deletedFromFiles = 0;
  if (!isServerless()) {
    try {
      const fs = require("fs");
      const path = require("path");
      const logsDir = path.join(process.cwd(), ".next", "server_logs");
      const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
      
      if (fs.existsSync(logsDir)) {
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
  }

  return deletedFromDb + deletedFromFiles;
}
