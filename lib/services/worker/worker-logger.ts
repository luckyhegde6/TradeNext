// lib/services/worker/worker-logger.ts
import fs from "fs";
import path from "path";

const LOGS_DIR = path.join(process.cwd(), ".next", "server_logs");

/**
 * Ensure logs directory exists with elevated permissions
 */
function ensureLogsDir(): void {
  try {
    if (!fs.existsSync(LOGS_DIR)) {
      // Create .next if it doesn't exist (though it should in build/dev)
      const nextDir = path.join(process.cwd(), ".next");
      if (!fs.existsSync(nextDir)) {
        fs.mkdirSync(nextDir, { recursive: true, mode: 0o777 });
      }

      // Create server_logs with elevated permissions (0o777)
      fs.mkdirSync(LOGS_DIR, { recursive: true, mode: 0o777 });

      // Explicitly set permissions if already exists but might be restricted
      fs.chmodSync(LOGS_DIR, 0o777);
    }
  } catch (error) {
    console.error("Failed to ensure logs directory:", error);
    // Fallback to local directory if .next is not writable
    const fallbackDir = path.join(process.cwd(), "worker_logs");
    if (!fs.existsSync(fallbackDir)) {
      fs.mkdirSync(fallbackDir, { recursive: true });
    }
  }
}

/**
 * Get log file path for a task
 */
export function getLogFilePath(taskId: string): string {
  ensureLogsDir();
  return path.join(LOGS_DIR, `${taskId}.log`);
}

/**
 * Write log entry to file
 */
export function writeLog(taskId: string, level: string, message: string, data?: unknown): void {
  try {
    const logFile = getLogFilePath(taskId);
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}${data ? ` ${JSON.stringify(data)}` : ""}\n`;

    fs.appendFileSync(logFile, logEntry);
  } catch (error) {
    console.error("Failed to write worker log:", error);
  }
}

/**
 * Read log file for a task
 */
export function readLog(taskId: string): string {
  try {
    const logFile = getLogFilePath(taskId);
    if (fs.existsSync(logFile)) {
      return fs.readFileSync(logFile, "utf-8");
    }
    return "";
  } catch (error) {
    console.error("Failed to read worker log:", error);
    return "";
  }
}

/**
 * Get list of all log files
 */
export function getAllLogFiles(): { taskId: string; path: string; size: number; created: Date }[] {
  try {
    ensureLogsDir();
    const files = fs.readdirSync(LOGS_DIR);

    return files
      .filter(f => f.endsWith(".log"))
      .map(f => {
        const taskId = f.replace(".log", "");
        const filePath = path.join(LOGS_DIR, f);
        const stats = fs.statSync(filePath);

        return {
          taskId,
          path: filePath,
          size: stats.size,
          created: stats.birthtime,
        };
      })
      .sort((a, b) => b.created.getTime() - a.created.getTime());
  } catch (error) {
    console.error("Failed to get log files:", error);
    return [];
  }
}

/**
 * Delete log file
 */
export function deleteLog(taskId: string): boolean {
  try {
    const logFile = getLogFilePath(taskId);
    if (fs.existsSync(logFile)) {
      fs.unlinkSync(logFile);
      return true;
    }
    return false;
  } catch (error) {
    console.error("Failed to delete worker log:", error);
    return false;
  }
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
