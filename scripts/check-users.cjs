const { PrismaClient } = require('@prisma/client');

let databaseUrl = process.env.DATABASE_URL || '';
if (!databaseUrl && process.env.ACCELERATE_URL) databaseUrl = process.env.ACCELERATE_URL;
if (!databaseUrl && process.env.DATABASE_REMOTE) databaseUrl = process.env.DATABASE_REMOTE;

async function main() {
  let prisma;
  
  if (databaseUrl.startsWith('prisma+postgres://') || databaseUrl.startsWith('prisma://')) {
    prisma = new PrismaClient({ accelerateUrl: databaseUrl });
  } else {
    const { PrismaPg } = require('@prisma/adapter-pg');
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: databaseUrl });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });
  }
  
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, isVerified: true, isBlocked: true }
    });
    console.log('Users in database:', JSON.stringify(users, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
