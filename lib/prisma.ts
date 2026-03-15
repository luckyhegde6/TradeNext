// Very early console log - should appear in Netlify logs
console.log('>>> Prisma module loading...');

import { PrismaClient } from '@prisma/client';
import logger from './logger';

console.log('>>> Prisma imports done, environment:', process.env.NODE_ENV);
console.log('>>> DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'NOT SET');
console.log('>>> DATABASE_URL prefix:', process.env.DATABASE_URL?.substring(0, 20));

logger.info({ 
  msg: "Prisma: Initializing", 
  nodeEnv: process.env.NODE_ENV,
  hasDatabaseUrl: !!process.env.DATABASE_URL
});

let prismaClient: PrismaClient;

// For Prisma 7 with library engine type, we can use simple PrismaClient
// No adapter needed - the DATABASE_URL should be available
try {
  prismaClient = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
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
