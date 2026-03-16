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

const databaseUrl = process.env.DATABASE_URL || '';

// Create Prisma client with PG adapter - works for any PostgreSQL connection
// For Prisma Accelerate, use the accelerateUrl option instead of adapter
try {
  console.log('>>> Creating Prisma client with PG adapter...');
  const pool = new Pool({ 
    connectionString: databaseUrl,
    // Add connection pool settings for serverless
    max: 5,
    min: 1,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  });
  const adapter = new PrismaPg(pool);
  prismaClient = new PrismaClient({ adapter });
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
