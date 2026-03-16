// Prisma client singleton - only log in development for debugging
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import logger from './logger';

// Use DATABASE_URL if set, otherwise fall back to ACCELERATE_URL for Prisma Accelerate
let databaseUrl = process.env.DATABASE_URL || '';

// If DATABASE_URL is not set but ACCELERATE_URL is, use ACCELERATE_URL
if (!databaseUrl && process.env.ACCELERATE_URL) {
  databaseUrl = process.env.ACCELERATE_URL;
}

// If still no database URL, check DATABASE_REMOTE
if (!databaseUrl && process.env.DATABASE_REMOTE) {
  databaseUrl = process.env.DATABASE_REMOTE;
}

// Check if using Prisma Accelerate (URL starts with prisma+postgres:// or prisma://)
const isAccelerateUrl = (url: string): boolean => {
  return url.startsWith('prisma+postgres://') || url.startsWith('prisma://');
};

const useAccelerate = isAccelerateUrl(databaseUrl);

// Only log in development for debugging
const isDev = process.env.NODE_ENV !== 'production';
if (isDev) {
  logger.info({ 
    msg: "Prisma: Initializing", 
    nodeEnv: process.env.NODE_ENV,
    hasDatabaseUrl: !!databaseUrl,
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

if (isDev) {
  globalForPrisma.prismaClient = prismaClient;
}
