import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

// Get database URL from environment or use default for local development
const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/tradenext';

// Create connection pool and adapter with better serverless configuration
const pool = new Pool({
  connectionString: databaseUrl,
  max: 5, // Reduce max connections for serverless
  min: 0,  // Minimum number of connections
  idleTimeoutMillis: 15000, // Close idle connections after 15s (shorter for serverless)
  connectionTimeoutMillis: 5000, // Connection timeout (longer for remote DB)
  query_timeout: 30000, // Query timeout
});
const adapter = new PrismaPg(pool);

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
