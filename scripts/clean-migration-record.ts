import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

// Use DATABASE_URL from .env (local)
const prisma = new PrismaClient();

async function cleanFailedMigration() {
  try {
    const result = await prisma.$executeRaw`
      DELETE FROM _prisma_migrations 
      WHERE migration_name = '20260311143000_add_corporate_action_unique'
    `;
    console.log('Deleted migration record:', result);
    
    // Verify it's gone
    const remaining = await prisma.$queryRaw`
      SELECT COUNT(*) as count FROM _prisma_migrations 
      WHERE migration_name = '20260311143000_add_corporate_action_unique'
    `;
    console.log('Remaining records:', remaining);
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await prisma.$disconnect();
  }
}

cleanFailedMigration();
