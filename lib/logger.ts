// Next.js 16 compatible logger
// Uses console-based logging to avoid Turbopack symlink issues

interface Logger {
  info: (message: string | object, ...args: any[]) => void;
  warn: (message: string | object, ...args: any[]) => void;
  error: (message: string | object, ...args: any[]) => void;
  debug: (message: string | object, ...args: any[]) => void;
}

const createCompatibleLogger = (): Logger => {
  const formatMessage = (level: string, message: string | object, ...args: any[]) => {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] ${level}:`;

    if (typeof message === 'object') {
      return [prefix, message, ...args];
    }
    return [prefix, message, ...args];
  };

  // Check if we're in development or production
  const isDev = process.env.NODE_ENV === 'development';

  return {
    info: (message, ...args) => {
      if (isDev) {
        console.log(...formatMessage('INFO', message, ...args));
      }
    },
    warn: (message, ...args) => {
      console.warn(...formatMessage('WARN', message, ...args));
    },
    error: (message: unknown, ...args: unknown[]) => {
      if (message instanceof Error) {
        console.error("[ERROR]", message.message, message.stack);
      } else if (typeof message === "string") {
        console.error("[ERROR]", message, ...args);
      } else {
        console.error("[ERROR]", JSON.stringify(message), ...args);
      }
    },
    debug: (message, ...args) => {
      if (isDev) {
        console.debug(...formatMessage('DEBUG', message, ...args));
      }
    },
  };
};

const logger = createCompatibleLogger();

export default logger;
