// Next.js 16 compatible logger with file logging support
// Uses console-based logging and writes to date-wise log files

// Check if we're on the server side - always true for API routes and server components
const isServer = typeof window === 'undefined';

// Only import fs and path on the server
let fs: any = null;
let pathModule: any = null;

if (isServer) {
  try {
    fs = require('fs');
    pathModule = require('path');
  } catch (e) {
    // Fallback to console only
  }
}

// Log levels
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

// Trace context import (lazy to avoid circular)
let _traceModule: typeof import('./trace') | null = null;
function getTrace() {
  if (!_traceModule && isServer) {
    try { _traceModule = require('./trace'); } catch { /* ignore */ }
  }
  return _traceModule;
}

// Log entry interface
interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string | object;
  args?: any[];
}

// ── logs-dir resolution (v3.13.1) ──────────────────────────────────────────
// Netlify's deployed bundle dir is read-only — `fs.mkdirSync('<cwd>/logs')`
// throws ENOENT on every prod boot, so `logsDirAvailable` flipped to false and
// NO log file was ever written → the monitoring "Server Logs" tab stayed
// empty on prod (the pre-v3.11.3 Netlify Blob mirror used to mask this).
// Resolution order — first writable candidate wins, remembered per process:
//   1. <cwd>/logs                  (local dev — existing layout/contract)
//   2. <os.tmpdir()>/tradenext-logs (Netlify — /tmp is writable)
//   3. "" (no file logging — console still logs)
let resolvedLogsDir: string | undefined;

export function resolveLogsDir(): string {
  if (resolvedLogsDir !== undefined) return resolvedLogsDir;
  if (!isServer || !fs || !pathModule) {
    resolvedLogsDir = '';
    return '';
  }
  const os = require('os');
  const candidates = [
    pathModule.join(process.cwd(), 'logs'),
    pathModule.join(os.tmpdir(), 'tradenext-logs'),
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
  resolvedLogsDir = '';
  return '';
}

// Server logs directory
const getLogsDir = (): string => {
  return resolveLogsDir();
};

// Test hook — clear the memoized dir resolution (mirrors resetBacktestHistoryGuard)
export function resetResolvedLogsDir(): void {
  resolvedLogsDir = undefined;
}

// Export for use in other files
export const LOGS_DIR = ''; // Will be computed dynamically

// Track if logs directory is available
let logsDirAvailable = true;

// Ensure logs directory exists
function ensureLogsDir() {
  if (!isServer || !fs || !logsDirAvailable) return;

  try {
    const logsDir = getLogsDir();
    if (!logsDir) {
      logsDirAvailable = false;
      return;
    }
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
  } catch (error) {
    // Directory creation failed - disable file logging
    logsDirAvailable = false;
    console.warn('[Logger] File logging disabled - could not create logs directory');
  }
}

// Get today's log file path
function getTodayLogPath(): string {
  if (!isServer || !fs || !pathModule || !logsDirAvailable) return '';

  try {
    const logsDir = getLogsDir();
    if (!logsDir) {
      logsDirAvailable = false;
      return '';
    }

    const today = new Date();
    const dateStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
    const yearMonth = dateStr.substring(0, 7); // YYYY-MM

    const yearMonthDir = pathModule.join(logsDir, yearMonth);
    if (!fs.existsSync(yearMonthDir)) {
      fs.mkdirSync(yearMonthDir, { recursive: true });
    }

    return pathModule.join(yearMonthDir, `${dateStr}.log`);
  } catch (error) {
    logsDirAvailable = false;
    return '';
  }
}

// Get list of available log files
export async function getLogFiles(): Promise<{ date: string; path: string; size: number }[]> {
  const files: { date: string; path: string; size: number }[] = [];

  // Include local logs (if any)
  if (isServer && fs && pathModule) {
    ensureLogsDir();
    const logsDir = getLogsDir();
    if (!logsDir) return files;

    try {
      if (fs.existsSync(logsDir)) {
        const yearDirs = fs.readdirSync(logsDir).filter((f: string) => fs.statSync(pathModule.join(logsDir, f)).isDirectory());

        for (const yearDir of yearDirs) {
          const yearMonthDir = pathModule.join(logsDir, yearDir);
          const logFiles = fs.readdirSync(yearMonthDir).filter((f: string) => f.endsWith('.log'));

          for (const logFile of logFiles) {
            const filePath = pathModule.join(yearMonthDir, logFile);
            const stats = fs.statSync(filePath);
            files.push({
              date: logFile.replace('.log', ''),
              path: filePath,
              size: stats.size
            });
          }
        }
      }
    } catch (error) {
      // Error reading log files
    }
  }

  return files.sort((a, b) => b.date.localeCompare(a.date));
}

// Read log file content
export async function readLogFile(filePath: string, limit: number = 1000): Promise<string[]> {
  if (!isServer || !fs) return [];
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter((line: string) => line.trim());
    return lines.slice(-limit);
  } catch (error) {
    return [];
  }
}

// Read log file with date filter
export async function readLogsByDate(date: string, limit: number = 1000): Promise<string[]> {
  if (!isServer || !fs || !pathModule) return [];
  const logsDir = getLogsDir();
  if (!logsDir) return [];
  const yearMonth = date.substring(0, 7); // YYYY-MM
  const filePath = pathModule.join(logsDir, yearMonth, `${date}.log`);

  if (!fs.existsSync(filePath)) {
    return [];
  }

  return await readLogFile(filePath, limit);
}

// Delete log file
export async function deleteLogFile(filePath: string): Promise<boolean> {
  if (!isServer || !fs) return false;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch (error) {
    return false;
  }
}

// Format log entry for file - human readable format
function formatLogEntry(level: LogLevel, message: string | object, ...args: any[]): string {
  const now = new Date();
  const timestamp = now.toISOString().replace('T', ' ').substring(0, 19); // YYYY-MM-DD HH:mm:ss

  // Level formatting with colors (for console)
  const levelStr = level.toUpperCase().padEnd(5);
  const levelColor = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : level === 'debug' ? '🔍' : 'ℹ️';

  let msgStr: string;

  if (typeof message === 'object') {
    // Format object as readable key: value pairs
    const entries = Object.entries(message as Record<string, unknown>);
    if (entries.length === 1 && entries[0][0] === 'msg') {
      // Special case for { msg: "..." } format
      msgStr = String(entries[0][1]);
    } else {
      // Format as key=value pairs
      msgStr = entries
        .map(([k, v]) => {
          if (typeof v === 'object') {
            return `${k}=${JSON.stringify(v)}`;
          }
          return `${k}=${v}`;
        })
        .join(', ');
    }
  } else {
    msgStr = message;
  }

  // Add extra args if present
  const extraArgs = args.length > 0
    ? ' | ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(', ')
    : '';

  // Add trace context if available
  const trace = getTrace();
  const traceCtx = trace?.getTraceContext();
  const tracePrefix = traceCtx
    ? `[trace=${traceCtx.traceId} span=${traceCtx.spanId} corr=${traceCtx.correlationId}] `
    : '';

  return `${timestamp} | ${levelColor} ${levelStr} | ${tracePrefix}${msgStr}${extraArgs}`;
}

// Write to file - but ALWAYS log to console first
function writeToFile(entry: string, level: LogLevel = 'info') {
  // ALWAYS log to console - this is critical for debugging
  if (level === 'error' || level === 'warn') {
    console.error(entry);
  } else if (level === 'debug') {
    console.debug(entry);
  } else {
    console.log(entry);
  }

  // Then try to write to file
  if (!isServer || !fs) return;
  try {
    ensureLogsDir();
    const filePath = getTodayLogPath();
    if (filePath && logsDirAvailable) {
      fs.appendFileSync(filePath, entry + '\n', 'utf-8');
    }
  } catch (error) {
    // File writing failed - we already logged to console above
    logsDirAvailable = false;
  }
}

// NSE API call tracking - use global to persist across hot reloads
const getGlobalNseCalls = () => {
  if (!((global as any)._nseApiCalls)) {
    (global as any)._nseApiCalls = [] as typeof nseApiCalls;
  }
  return (global as any)._nseApiCalls;
};

const nseApiCalls: {
  timestamp: string;
  endpoint: string;
  method: string;
  status: 'success' | 'error' | 'pending';
  responseTime?: number;
  error?: string;
}[] = [];

// Track NSE API calls
export function trackNseApiCall(
  endpoint: string,
  method: string = 'GET',
  status: 'success' | 'error' | 'pending' = 'pending',
  responseTime?: number,
  error?: string
) {
  const calls = getGlobalNseCalls();
  calls.unshift({
    timestamp: new Date().toISOString(),
    endpoint,
    method,
    status,
    responseTime,
    error
  });

  // Keep only last 1000 calls in memory
  if (calls.length > 1000) {
    calls.pop();
  }
}

// Get NSE API calls
export function getNseApiCalls(limit: number = 100): typeof nseApiCalls {
  return getGlobalNseCalls().slice(0, limit);
}

// Logger interface
interface Logger {
  info: (message: string | object, ...args: any[]) => void;
  warn: (message: string | object, ...args: any[]) => void;
  error: (message: string | object, ...args: any[]) => void;
  debug: (message: string | object, ...args: any[]) => void;
  nse: (endpoint: string, method?: string) => {
    success: (responseTime: number) => void;
    error: (error: string, responseTime?: number) => void;
  };
}

// Create logger
const createLogger = (): Logger => {
  // Use ENVIRONMENT env var: local, development, production
  // - local: debug logs enabled
  // - development: debug logs enabled  
  // - production: debug logs disabled (default if not set)
  const env = process.env.ENVIRONMENT || 'production';
  const isLocal = env === 'local';
  const isDev = env === 'development' || isLocal;
  const enableDebug = isDev;

  const formatMessage = (level: string, message: string | object, ...args: any[]) => {
    const now = new Date();
    const timestamp = now.toISOString().replace('T', ' ').substring(0, 19);

    // Level formatting
    const levelColor = level === 'ERROR' ? '\x1b[31m' :
      level === 'WARN' ? '\x1b[33m' :
        level === 'DEBUG' ? '\x1b[36m' : '\x1b[32m';
    const reset = '\x1b[0m';

    let msgStr: string;
    if (typeof message === 'object') {
      const entries = Object.entries(message as Record<string, unknown>);
      if (entries.length === 1 && entries[0][0] === 'msg') {
        msgStr = String(entries[0][1]);
      } else {
        msgStr = entries
          .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
          .join(', ');
      }
    } else {
      msgStr = message;
    }

    const extraArgs = args.length > 0
      ? ' | ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(', ')
      : '';

    return `${timestamp} | ${levelColor}${level.padEnd(5)}${reset} | ${msgStr}${extraArgs}`;
  };

  return {
    info: (message, ...args) => {
      const entry = formatLogEntry('info', message, ...args);
      writeToFile(entry, 'info');
    },

    warn: (message, ...args) => {
      const entry = formatLogEntry('warn', message, ...args);
      writeToFile(entry, 'warn');
    },

    error: (message: unknown, ...args: unknown[]) => {
      let msgObj: object;
      if (message instanceof Error) {
        msgObj = { error: message.message, stack: message.stack };
      } else if (typeof message === 'string') {
        msgObj = { error: message };
      } else {
        msgObj = message as object;
      }

      const entry = formatLogEntry('error', msgObj, ...args);
      writeToFile(entry, 'error');
    },

    // Skip DEBUG logs unless in local/development
    debug: (message, ...args) => {
      if (!enableDebug) return; // Skip debug in production
      const entry = formatLogEntry('debug', message, ...args);
      writeToFile(entry, 'debug');
    },

    // NSE API tracking helper
    nse: (endpoint: string, method: string = 'GET') => {
      const startTime = Date.now();
      trackNseApiCall(endpoint, method, 'pending');

      return {
        success: (responseTime: number = Date.now() - startTime) => {
          trackNseApiCall(endpoint, method, 'success', responseTime);
        },
        error: (error: string, responseTime: number = Date.now() - startTime) => {
          trackNseApiCall(endpoint, method, 'error', responseTime, error);
        }
      };
    }
  };
};

// =============================================================================
// HTTP Request Logging (Morgan-style)
// =============================================================================

// HTTP request log entry
export interface HttpLogEntry {
  timestamp: string;
  method: string;
  url: string;
  status: number;
  responseTime: number;
  ip?: string;
  userAgent?: string;
}

// Store HTTP logs in global to persist across hot reloads
const getGlobalHttpLogs = () => {
  if (!((global as any)._httpLogs)) {
    (global as any)._httpLogs = [] as HttpLogEntry[];
  }
  return (global as any)._httpLogs;
};

// Track HTTP request (Morgan-style)
export function logHttpRequest(
  method: string,
  url: string,
  status: number,
  responseTime: number,
  ip?: string,
  userAgent?: string
) {
  const logs = getGlobalHttpLogs();
  logs.unshift({
    timestamp: new Date().toISOString(),
    method,
    url,
    status,
    responseTime,
    ip,
    userAgent
  });

  // Keep only last 2000 HTTP requests
  if (logs.length > 2000) {
    logs.pop();
  }

  // Also write to file in readable format (only if available)
  if (isServer && fs && logsDirAvailable) {
    try {
      const now = new Date();
      const timestamp = now.toISOString().replace('T', ' ').substring(0, 19);
      const statusColor = status >= 400 ? '❌' : status >= 300 ? '⚠️' : '✅';

      const logLine = `${timestamp} | ${statusColor} ${method.padEnd(6)} | ${status} | ${responseTime}ms | ${url}`;

      ensureLogsDir();
      const filePath = getTodayLogPath();
      if (filePath) {
        fs.appendFileSync(filePath, logLine + '\n', 'utf-8');
      }
    } catch (e) {
      // Silently fail - disable file logging
      logsDirAvailable = false;
    }
  }
}

// Get HTTP logs
export function getHttpLogs(limit: number = 100): HttpLogEntry[] {
  return getGlobalHttpLogs().slice(0, limit);
}

// Clear HTTP logs
export function clearHttpLogs(): void {
  (global as any)._httpLogs = [];
}

// =============================================================================
// HTTP Request Logging Utility for API Routes
// =============================================================================

/**
 * Create a Next.js route handler wrapper that logs HTTP requests
 * Usage: export const GET = withHttpLogging('GET', async (req) => { ... })
 */
export function withHttpLogging<P extends string, T extends { status: number }>(
  method: P,
  handler: (req: Request) => Promise<T>
): (req: Request) => Promise<T> {
  return async function (req: Request, ...args: unknown[]): Promise<T> {
    const startTime = Date.now();
    const url = req.url || '';
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ||
      req.headers.get('x-real-ip') ||
      'unknown';
    const userAgent = req.headers.get('user-agent') || '';

    try {
      const response = await handler(req);
      const responseTime = Date.now() - startTime;

      // Log the request
      logHttpRequest(
        method,
        url,
        response.status,
        responseTime,
        ip,
        userAgent
      );

      return response;
    } catch (error) {
      const responseTime = Date.now() - startTime;

      // Log error requests
      logHttpRequest(
        method,
        url,
        500,
        responseTime,
        ip,
        userAgent
      );

      throw error;
    }
  };
}

const logger = createLogger();

export default logger;
export const info = logger.info;
export const warn = logger.warn;
export const error = logger.error;
export const debug = logger.debug;
