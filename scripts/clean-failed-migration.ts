import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

// Use DATABASE_REMOTE if DATABASE_URL not set
if (process.env.DATABASE_REMOTE && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_REMOTE;
}

const prisma = new PrismaClient();

async function cleanFailedMigration() {
  try {
    const result = await prisma.$executeRaw`
      DELETE FROM _prisma_migrations 
      WHERE migration_name = '20260311143000_add_corporate_action_unique'
    `;
    console.log('Deleted migration record:', result);
  } catch (e) {
    console.error('Error deleting migration record:', e);
  } finally {
    await prisma.$disconnect();
  }
}

cleanFailedMigration();
