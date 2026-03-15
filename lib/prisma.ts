import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import logger from './logger';

const useRemoteDb = process.env.USE_REMOTE_DB === 'true';

logger.info({ 
  msg: "Prisma: Initializing", 
  useRemoteDb, 
  nodeEnv: process.env.NODE_ENV,
  hasDatabaseUrl: !!process.env.DATABASE_URL,
  hasDatabaseRemote: !!process.env.DATABASE_REMOTE,
  hasAccelerateUrl: !!process.env.ACCELERATE_URL,
  databaseUrlPreview: process.env.DATABASE_URL?.substring(0, 25) + '...'
});

let prismaClient: PrismaClient;

// For Prisma 7, we need to use a driver adapter
// Use the PostgreSQL adapter with connection pooling
const getDatabaseUrl = (): string => {
  if (useRemoteDb) {
    // For remote/production: prioritize DATABASE_REMOTE, then ACCELERATE_URL, then DATABASE_URL
    // DATABASE_REMOTE and ACCELERATE_URL can be either:
    // - Standard PostgreSQL: postgresql://user:pass@host:5432/db
    // - Prisma Accelerate: prisma+postgres://... (only works with Accelerate extension)
    const remoteUrl = process.env.DATABASE_REMOTE || process.env.ACCELERATE_URL;
    if (remoteUrl) {
      // Check if it's a standard PostgreSQL URL
      if (remoteUrl.startsWith('postgresql://')) {
        return remoteUrl;
      }
      // If it's an Accelerate URL, we need to fall back to local for now
      // Or use a direct PostgreSQL connection if available
      logger.warn({ msg: "Prisma: DATABASE_REMOTE is Accelerate URL, need direct PostgreSQL for adapter" });
    }
    // Fall back to DATABASE_URL if available
    return process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/tradenext';
  }
  return process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/tradenext';
};

const databaseUrl = getDatabaseUrl();
logger.info({ msg: "Prisma: Creating client with URL", urlPreview: databaseUrl?.substring(0, 30) + '...' });

// Use driver adapter for Prisma 7
const pool = new Pool({
  connectionString: databaseUrl,
  max: 10,
  min: 2,
  idleTimeoutMillis: 15000,
  connectionTimeoutMillis: 10000,
  query_timeout: 30000,
});

const adapter = new PrismaPg(pool);

prismaClient = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

const globalForPrisma = globalThis as unknown as { prismaClient: PrismaClient };

const prismaInstance = globalForPrisma.prismaClient || prismaClient;

export const db = prismaInstance;
export const prisma = prismaInstance;

if (process.env.NODE_ENV !== 'production') globalForPrisma.prismaClient = prismaInstance;

export default prismaInstance;
