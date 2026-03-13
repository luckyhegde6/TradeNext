import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { withAccelerate } from '@prisma/extension-accelerate';
import logger from './logger';

const useRemoteDb = process.env.USE_REMOTE_DB === 'true';

let prismaClient: PrismaClient;

// Helper to check if a URL is a Prisma Accelerate URL
const isAccelerateUrl = (url: string | undefined): boolean => {
  if (!url) return false;
  return url.startsWith('prisma+postgres://') || url.includes('accelerate.prisma-data.net');
};

// Helper to get a direct PostgreSQL URL
const getDirectPostgresUrl = (): string | null => {
  // Check for direct PostgreSQL URL first
  const directUrl = process.env.DATABASE_DIRECT || process.env.DATABASE_URL;
  if (directUrl && !isAccelerateUrl(directUrl) && directUrl.startsWith('postgresql://')) {
    return directUrl;
  }
  
  // Check DATABASE_REMOTE - skip if it's Accelerate
  const remoteUrl = process.env.DATABASE_REMOTE;
  if (remoteUrl && !isAccelerateUrl(remoteUrl) && remoteUrl.startsWith('postgresql://')) {
    return remoteUrl;
  }
  
  return null;
};

if (useRemoteDb) {
  const directPgUrl = getDirectPostgresUrl();
  
  if (directPgUrl) {
    // Use direct PostgreSQL connection
    logger.info({ msg: "Prisma: Using direct PostgreSQL connection", hasUrl: true });
    const pool = new Pool({
      connectionString: directPgUrl,
      max: 5,
      min: 0,
      idleTimeoutMillis: 15000,
      connectionTimeoutMillis: 10000,
      query_timeout: 30000,
    });
    const adapter = new PrismaPg(pool);
    prismaClient = new PrismaClient({
      adapter,
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
  } else {
    // No valid direct PostgreSQL URL - try Accelerate as fallback
    const accelerateUrl = process.env.ACCELERATE_URL || process.env.DATABASE_REMOTE;
    
    if (accelerateUrl) {
      logger.info({ msg: "Prisma: Falling back to Accelerate", hasUrl: true });
      process.env.DATABASE_URL = accelerateUrl;
      prismaClient = new PrismaClient({
        accelerateUrl: process.env.DATABASE_URL,
      }).$extends(withAccelerate()) as unknown as PrismaClient;
    } else {
      // Fall back to local
      logger.warn({ msg: "Prisma: No valid remote URL, falling back to local" });
      const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/tradenext';
      const pool = new Pool({
        connectionString: databaseUrl,
        max: 5,
        min: 0,
        idleTimeoutMillis: 15000,
        connectionTimeoutMillis: 5000,
        query_timeout: 30000,
      });
      const adapter = new PrismaPg(pool);
      prismaClient = new PrismaClient({
        adapter,
        log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
      });
    }
  }
} else {
  const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/tradenext';
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 5,
    min: 0,
    idleTimeoutMillis: 15000,
    connectionTimeoutMillis: 5000,
    query_timeout: 30000,
  });
  const adapter = new PrismaPg(pool);
  prismaClient = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
}

const globalForPrisma = globalThis as unknown as { prismaClient: PrismaClient };

const prismaInstance = globalForPrisma.prismaClient || prismaClient;

export const db = prismaInstance;
export const prisma = prismaInstance;

if (process.env.NODE_ENV !== 'production') globalForPrisma.prismaClient = prismaInstance;

export default prismaInstance;
