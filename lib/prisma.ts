// Very early console log - should appear in Netlify logs
console.log('>>> Prisma module loading...');

import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { withAccelerate } from '@prisma/extension-accelerate';
import logger from './logger';

console.log('>>> Prisma imports done, environment:', process.env.NODE_ENV);

const useRemoteDb = process.env.USE_REMOTE_DB === 'true';

console.log('>>> USE_REMOTE_DB:', useRemoteDb);
console.log('>>> DATABASE_URL:', process.env.DATABASE_URL ? 'set' : 'NOT SET');
console.log('>>> DATABASE_URL starts with:', process.env.DATABASE_URL?.substring(0, 20));

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

// Check if using Prisma Accelerate
const isAccelerateUrl = (url: string): boolean => {
  return url.startsWith('prisma+postgres://') || url.includes('accelerate.prisma-data.net');
};

// For Prisma 7, we need to use a driver adapter or Accelerate
const getDatabaseUrl = (): string => {
  const dbUrl = process.env.DATABASE_URL;
  
  if (!dbUrl || dbUrl.trim() === '') {
    // No URL set
    if (process.env.NODE_ENV !== 'production') {
      return process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/tradenext';
    }
    console.error('>>> FATAL: No DATABASE_URL set for production!');
    return 'postgresql://invalid:invalid@localhost:5432/invalid';
  }
  
  // Check if it's an Accelerate URL
  if (isAccelerateUrl(dbUrl)) {
    console.log('>>> Detected Accelerate URL - will use Accelerate extension');
    return dbUrl;
  }
  
  // Standard PostgreSQL URL
  if (dbUrl.startsWith('postgresql://')) {
    return dbUrl;
  }
  
  // Fallback
  return dbUrl;
};

const databaseUrl = getDatabaseUrl();
console.log('>>> Using database URL:', databaseUrl.substring(0, 30) + '...');

logger.info({ msg: "Prisma: Creating client with URL", urlPreview: databaseUrl?.substring(0, 30) + '...' });

try {
  if (isAccelerateUrl(databaseUrl)) {
    // Use Prisma Accelerate
    console.log('>>> Creating Prisma client with Accelerate...');
    prismaClient = new PrismaClient({
      accelerateUrl: databaseUrl,
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    }).$extends(withAccelerate()) as unknown as PrismaClient;
  } else {
    // Use driver adapter for standard PostgreSQL
    console.log('>>> Creating Prisma client with adapter...');
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
  }
  
  console.log('>>> Prisma client created successfully');
} catch (error) {
  console.error('>>> Prisma initialization failed:', error);
  prismaClient = new PrismaClient();
}

const globalForPrisma = globalThis as unknown as { prismaClient: PrismaClient };

const prismaInstance = globalForPrisma.prismaClient || prismaClient;

export const db = prismaInstance;
export const prisma = prismaInstance;

if (process.env.NODE_ENV !== 'production') globalForPrisma.prismaClient = prismaInstance;

export default prismaInstance;
