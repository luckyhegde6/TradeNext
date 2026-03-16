const { PrismaClient } = require('@prisma/client');

// Use the same logic as our prisma.ts to determine the database URL
let databaseUrl = process.env.DATABASE_URL || '';

if (!databaseUrl && process.env.ACCELERATE_URL) {
  databaseUrl = process.env.ACCELERATE_URL;
}

if (!databaseUrl && process.env.DATABASE_REMOTE) {
  databaseUrl = process.env.DATABASE_REMOTE;
}

async function main() {
  let prisma;
  
  if (databaseUrl.startsWith('prisma+postgres://') || databaseUrl.startsWith('prisma://')) {
    // Using Prisma Accelerate
    console.log('Using Prisma Accelerate...');
    prisma = new PrismaClient({
      accelerateUrl: databaseUrl
    });
  } else {
    // Using PG adapter
    console.log('Using PG adapter...');
    const { PrismaPg } = require('@prisma/adapter-pg');
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: databaseUrl });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });
  }
  
  try {
    // Check if tokenVersion column exists
    const result = await prisma.$queryRaw`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'User' AND column_name = 'tokenVersion'
    `;
    
    console.log('tokenVersion column:', result);
    
    if (result.length === 0) {
      console.log('Adding tokenVersion column...');
      await prisma.$executeRaw`
        ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 1
      `;
      console.log('Column added successfully!');
    } else {
      console.log('Column already exists');
    }
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
