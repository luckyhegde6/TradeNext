// Very early console log - should appear in Netlify logs
console.log('>>> Prisma module loading...');

import { PrismaClient } from '@prisma/client';
import { withAccelerate } from '@prisma/extension-accelerate';
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

// Check if using Prisma Accelerate (URL starts with prisma+postgres://)
const isAccelerateUrl = (url: string): boolean => {
  return url.startsWith('prisma+postgres://');
};

const databaseUrl = process.env.DATABASE_URL || '';
const useAccelerate = isAccelerateUrl(databaseUrl);

console.log('>>> Use Accelerate:', useAccelerate);

try {
  if (useAccelerate) {
    console.log('>>> Creating Prisma client with Accelerate extension...');
    prismaClient = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    }).$extends(withAccelerate());
  } else {
    console.log('>>> Creating standard Prisma client...');
    prismaClient = new PrismaClient({
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
