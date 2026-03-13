import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { withAccelerate } from '@prisma/extension-accelerate';
import logger from './logger';

const useRemoteDb = process.env.USE_REMOTE_DB === 'true';

let prismaClient: PrismaClient;

if (useRemoteDb) {
  // Use direct PostgreSQL connection (not Accelerate which can fail)
  const remoteUrl = process.env.DATABASE_REMOTE || process.env.DATABASE_URL;
  if (remoteUrl) {
    logger.info({ msg: "Prisma: Using remote PostgreSQL connection", hasUrl: !!remoteUrl });
    const pool = new Pool({
      connectionString: remoteUrl,
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
    logger.warn({ msg: "Prisma: No remote URL found, falling back to local" });
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
