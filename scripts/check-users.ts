import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const useRemoteDb = process.env.USE_REMOTE_DB === 'true';

async function main() {
  let prisma: PrismaClient;
  
  if (useRemoteDb) {
    const remoteUrl = process.env.DATABASE_REMOTE || process.env.ACCELERATE_URL;
    if (remoteUrl) {
      process.env.DATABASE_URL = remoteUrl;
    }
    const pool = new Pool({ connectionString: remoteUrl });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });
  } else {
    const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/tradenext';
    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });
  }

  const users = await prisma.user.findMany({
    select: {
      email: true,
      name: true,
      role: true,
      isVerified: true,
      isBlocked: true
    }
  });
  
  console.log(JSON.stringify(users, null, 2));
  await prisma.$disconnect();
}

main().catch(console.error);
