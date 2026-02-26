import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { withAccelerate } from '@prisma/extension-accelerate';

const useRemoteDb = process.env.USE_REMOTE_DB === 'true';

let prismaClient: PrismaClient;

if (useRemoteDb) {
  const remoteUrl = process.env.DATABASE_REMOTE || process.env.ACCELERATE_URL;
  if (remoteUrl) {
    process.env.DATABASE_URL = remoteUrl;
  }
  prismaClient = new PrismaClient({
    accelerateUrl: process.env.DATABASE_URL,
  }).$extends(withAccelerate()) as unknown as PrismaClient;
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
