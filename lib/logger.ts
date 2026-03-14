// Next.js 16 compatible logger with file logging support
// Uses console-based logging and writes to date-wise log files

// Check if we're on the server side
const isServer = typeof window === 'undefined' && process.env.NODE_ENV !== 'test';

// Only import fs and path on the server
let fs: any = null;
let path: any = null;

if (isServer) {
  try {
    fs = require('fs');
    path = require('path');
  } catch (e) {
    console.warn('Could not load fs/path for logger');
  }
}

// Log levels
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

// Log entry interface
interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string | object;
  args?: any[];
}

// Server logs directory
const getLogsDir = (): string => {
  const cwd = process.cwd();
  return isServer ? path.join(cwd, 'server_logs') : '';
};

// Export for use in other files
export const LOGS_DIR = ''; // Will be computed dynamically

// Ensure logs directory exists
function ensureLogsDir() {
  if (!isServer || !fs) return;
  const logsDir = getLogsDir();
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
}

// Get today's log file path
function getTodayLogPath(): string {
  if (!isServer || !fs || !path) return '';
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
  const yearMonth = dateStr.substring(0, 7); // YYYY-MM
  
  const logsDir = getLogsDir();
  const yearMonthDir = path.join(logsDir, yearMonth);
  if (!fs.existsSync(yearMonthDir)) {
    fs.mkdirSync(yearMonthDir, { recursive: true });
  }
  
  return path.join(yearMonthDir, `${dateStr}.log`);
}

// Get list of available log files
export function getLogFiles(): { date: string; path: string; size: number }[] {
  if (!isServer || !fs || !path) return [];
  ensureLogsDir();
  
  const files: { date: string; path: string; size: number }[] = [];
  const logsDir = getLogsDir();
  
  try {
    if (!fs.existsSync(logsDir)) return [];
    const yearDirs = fs.readdirSync(logsDir).filter((f: string) => fs.statSync(path.join(logsDir, f)).isDirectory());
    
    for (const yearDir of yearDirs) {
      const yearMonthDir = path.join(logsDir, yearDir);
      const logFiles = fs.readdirSync(yearMonthDir).filter((f: string) => f.endsWith('.log'));
      
      for (const logFile of logFiles) {
        const filePath = path.join(yearMonthDir, logFile);
        const stats = fs.statSync(filePath);
        files.push({
          date: logFile.replace('.log', ''),
          path: filePath,
          size: stats.size
        });
      }
    }
  } catch (error) {
    console.error('Error reading log files:', error);
  }
  
  return files.sort((a, b) => b.date.localeCompare(a.date));
}

// Read log file content
export function readLogFile(filePath: string, limit: number = 1000): string[] {
  if (!isServer || !fs) return [];
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter((line: string) => line.trim());
    return lines.slice(-limit);
  } catch (error) {
    console.error('Error reading log file:', error);
    return [];
  }
}

// Read log file with date filter
export function readLogsByDate(date: string, limit: number = 1000): string[] {
  if (!isServer || !fs || !path) return [];
  const logsDir = getLogsDir();
  const dateStr = date.replace(/-/g, '');
  const yearMonth = dateStr.substring(0, 6); // YYYYMM
  const filePath = path.join(logsDir, yearMonth.substring(0, 4), yearMonth, `${date}.log`);
  
  if (!fs.existsSync(filePath)) {
    return [];
  }
  
  return readLogFile(filePath, limit);
}

// Delete log file
export function deleteLogFile(filePath: string): boolean {
  if (!isServer || !fs) return false;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error deleting log file:', error);
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
  
  return `${timestamp} | ${levelColor} ${levelStr} | ${msgStr}${extraArgs}`;
}

// Write to file
function writeToFile(entry: string) {
  if (!isServer || !fs) return;
  try {
    ensureLogsDir();
    const filePath = getTodayLogPath();
    if (filePath) {
      fs.appendFileSync(filePath, entry + '\n', 'utf-8');
    }
  } catch (error) {
    console.error('Error writing to log file:', error);
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
  // Check if we're in development or production
  const isDev = process.env.NODE_ENV === 'development';
  
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
      writeToFile(entry);
      
      if (isDev) {
        console.log(...formatMessage('INFO', message, ...args));
      }
    },
    
    warn: (message, ...args) => {
      const entry = formatLogEntry('warn', message, ...args);
      writeToFile(entry);
      console.warn(...formatMessage('WARN', message, ...args));
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
      writeToFile(entry);
      
      // Use consistent formatting for console
      const msgForConsole = typeof message === 'object' ? message : { error: String(message) };
      if (message instanceof Error) {
        console.error(...formatMessage('ERROR', { error: message.message, stack: message.stack?.split('\n').slice(0, 3).join(' | ') }));
      } else if (typeof message === "string") {
        console.error(...formatMessage('ERROR', message, ...args));
      } else {
        console.error(...formatMessage('ERROR', msgObj, ...args));
      }
    },
    
    debug: (message, ...args) => {
      const entry = formatLogEntry('debug', message, ...args);
      writeToFile(entry);
      
      if (isDev) {
        console.debug(...formatMessage('DEBUG', message, ...args));
      }
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
  
  // Also write to file in readable format
  const now = new Date();
  const timestamp = now.toISOString().replace('T', ' ').substring(0, 19);
  const statusColor = status >= 400 ? '❌' : status >= 300 ? '⚠️' : '✅';
  
  const logLine = `${timestamp} | ${statusColor} ${method.padEnd(6)} | ${status} | ${responseTime}ms | ${url}`;
  
  if (isServer && fs) {
    try {
      ensureLogsDir();
      const filePath = getTodayLogPath();
      if (filePath) {
        fs.appendFileSync(filePath, logLine + '\n', 'utf-8');
      }
    } catch (e) {
      console.error('Error writing HTTP log to file:', e);
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
