// Very early console log - should appear in Netlify logs
console.log('>>> Prisma module loading...');

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import logger from './logger';

console.log('>>> Prisma imports done, environment:', process.env.NODE_ENV);
console.log('>>> DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'NOT SET');
console.log('>>> DATABASE_URL prefix:', process.env.DATABASE_URL?.substring(0, 30));

logger.info({ 
  msg: "Prisma: Initializing", 
  nodeEnv: process.env.NODE_ENV,
  hasDatabaseUrl: !!process.env.DATABASE_URL,
  dbUrlPrefix: process.env.DATABASE_URL?.substring(0, 30)
});

let prismaClient: PrismaClient;

// Use DATABASE_URL if set, otherwise fall back to ACCELERATE_URL for Prisma Accelerate
let databaseUrl = process.env.DATABASE_URL || '';

// If DATABASE_URL is not set but ACCELERATE_URL is, use ACCELERATE_URL
if (!databaseUrl && process.env.ACCELERATE_URL) {
  databaseUrl = process.env.ACCELERATE_URL;
  console.log('>>> Using ACCELERATE_URL as DATABASE_URL');
}

// If still no database URL, check DATABASE_REMOTE
if (!databaseUrl && process.env.DATABASE_REMOTE) {
  databaseUrl = process.env.DATABASE_REMOTE;
  console.log('>>> Using DATABASE_REMOTE as DATABASE_URL');
}

console.log('>>> Final DATABASE_URL:', databaseUrl ? 'SET' : 'NOT SET');
console.log('>>> DATABASE_URL prefix:', databaseUrl?.substring(0, 30));

// Check if using Prisma Accelerate (URL starts with prisma+postgres:// or prisma://)
const isAccelerateUrl = (url: string): boolean => {
  return url.startsWith('prisma+postgres://') || url.startsWith('prisma://');
};

const useAccelerate = isAccelerateUrl(databaseUrl);

console.log('>>> Use Accelerate:', useAccelerate);

// Create Prisma client - use accelerateUrl for Accelerate, adapter for direct PostgreSQL
try {
  if (useAccelerate) {
    console.log('>>> Creating Prisma client with Accelerate URL...');
    // For Prisma Accelerate, use the accelerateUrl option
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismaClient = new PrismaClient({ 
      accelerateUrl: databaseUrl 
    } as any);
  } else {
    console.log('>>> Creating Prisma client with PG adapter...');
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
  console.log('>>> Prisma client created successfully');
} catch (error) {
  console.error('>>> Prisma initialization failed:', error);
  // Last resort fallback
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prismaClient = new PrismaClient({} as any);
}

const globalForPrisma = globalThis as unknown as { prismaClient: PrismaClient };

const prismaInstance = globalForPrisma.prismaClient || prismaClient;

export const db = prismaInstance;
export const prisma = prismaInstance;

if (process.env.NODE_ENV !== 'production') globalForPrisma.prismaClient = prismaInstance;

export default prismaInstance;
