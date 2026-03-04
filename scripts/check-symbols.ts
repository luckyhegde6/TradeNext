import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const count = await prisma.symbol.count();
  console.log(`Total symbols in database: ${count}`);
  
  const sample = await prisma.symbol.findMany({ take: 5 });
  console.log('Sample symbols:', JSON.stringify(sample, null, 2));
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
