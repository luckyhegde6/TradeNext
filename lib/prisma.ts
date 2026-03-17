// Prisma client singleton - only log in development for debugging
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import logger from './logger';

// Determine environment from ENVIRONMENT env var (defaults to 'development')
// Options: local, development, production
const env = process.env.ENVIRONMENT || 'development';
const isDev = env === 'development' || env === 'local';
const isLocal = env === 'local';
const useRemoteDb = process.env.USE_REMOTE_DB === 'true';

// Database URL selection logic:
// - ENVIRONMENT=local + USE_REMOTE_DB=true → use DATABASE_REMOTE (Prisma Accelerate)
// - ENVIRONMENT=local + USE_REMOTE_DB=false → use DATABASE_URL (local PostgreSQL)  
// - ENVIRONMENT=production → use DATABASE_URL if Prisma Accelerate format, else DATABASE_REMOTE

let databaseUrl = '';

if (isLocal) {
  // Local environment - check USE_REMOTE_DB flag
  if (useRemoteDb && process.env.DATABASE_REMOTE) {
    databaseUrl = process.env.DATABASE_REMOTE;
  } else {
    // Use local DATABASE_URL (postgresql://postgres:postgres@localhost:5432/tradenext)
    databaseUrl = process.env.DATABASE_URL || '';
  }
} else {
  // Production environment - prefer DATABASE_URL if it's Prisma Accelerate format
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl && (dbUrl.startsWith('prisma+postgres://') || dbUrl.startsWith('prisma://'))) {
    databaseUrl = dbUrl;
  } else if (process.env.DATABASE_REMOTE) {
    // Fall back to DATABASE_REMOTE if available
    databaseUrl = process.env.DATABASE_REMOTE;
  } else {
    databaseUrl = dbUrl || '';
  }
}

// Check if using Prisma Accelerate (URL starts with prisma+postgres:// or prisma://)
const isAccelerateUrl = (url: string): boolean => {
  return url.startsWith('prisma+postgres://') || url.startsWith('prisma://');
};

const useAccelerate = isAccelerateUrl(databaseUrl);

// Only log in local/development for debugging
if (isDev) {
  logger.info({ 
    msg: "Prisma: Initializing", 
    environment: env,
    isLocal,
    useRemoteDb,
    hasDatabaseUrl: !!databaseUrl,
    dbUrlPrefix: databaseUrl ? databaseUrl.substring(0, 30) + "..." : "none",
    useAccelerate
  });
}

// Create Prisma client singleton
let prismaClient: PrismaClient;

try {
  if (useAccelerate) {
    // For Prisma Accelerate, use the accelerateUrl option
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismaClient = new PrismaClient({ 
      accelerateUrl: databaseUrl 
    } as any);
  } else {
    const pool = new Pool({ 
      connectionString: databaseUrl,
      max: 5,
      min: 1,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
    });
    const adapter = new PrismaPg(pool);
    prismaClient = new PrismaClient({ adapter });
  }
} catch (error) {
  logger.error({ msg: "Prisma: Initialization failed", error: error instanceof Error ? error.message : String(error) });
  // Last resort fallback
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prismaClient = new PrismaClient({} as any);
}

// Use global singleton to avoid multiple connections in development
const globalForPrisma = globalThis as unknown as { prismaClient: PrismaClient | undefined };

export const db = globalForPrisma.prismaClient ?? prismaClient;
export const prisma = globalForPrisma.prismaClient ?? prismaClient;

// Default export for backward compatibility
export default prisma;

// Only cache in dev/local to avoid issues in production
if (isDev) {
  globalForPrisma.prismaClient = prismaClient;
}
