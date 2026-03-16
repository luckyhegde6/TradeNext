const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

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
    const adminPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
    const demoPassword = await bcrypt.hash(process.env.DEMO_PASSWORD, 12);
    
    await prisma.user.update({
      where: { email: 'admin@tradenext6.app' },
      data: { password: adminPassword }
    });
    
    await prisma.user.update({
      where: { email: 'demo@tradenext6.app' },
      data: { password: demoPassword }
    });
    
    console.log('Passwords updated successfully!');
    // console.log('Admin: admin@tradenext6.app / ' + process.env.ADMIN_PASSWORD);
    // console.log('Demo: demo@tradenext6.app / ' + process.env.DEMO_PASSWORD);
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
