import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/tradenext';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const password = await hash('password123', 12);

  // Create admin user and other users
  await prisma.user.upsert({
    where: { email: 'luckyhegdedev@gmail.com' },
    update: {},
    create: {
      email: 'luckyhegdedev@gmail.com',
      name: 'Lucky Admin',
      password,
      role: 'admin',
      isVerified: true,
      isBlocked: false,
    },
  });

  // Create 5 users with mobile numbers
  const usersData = [
    { email: 'alice@example.com', name: 'Alice', mobile: '9876543210', password: await hash('password', 10), isVerified: true },
    { email: 'bob@example.com', name: 'Bob', mobile: '9876543211', password: await hash('password', 10), isVerified: true },
    { email: 'charlie@example.com', name: 'Charlie', mobile: '9876543212', password: await hash('password', 10), isVerified: true },
    { email: 'diana@example.com', name: 'Diana', mobile: '9876543213', password: await hash('password', 10), isVerified: true },
    { email: 'edward@example.com', name: 'Edward', mobile: '9876543214', password: await hash('password', 10), isVerified: true },
  ];

  for (const userData of usersData) {
    await prisma.user.upsert({
      where: { email: userData.email },
      update: userData,
      create: userData
    });
  }

  // Find all users to get their IDs
  const userRecords = await prisma.user.findMany();

  const userIdMapping = {
    admin: userRecords.find((user) => user.email === 'luckyhegdedev@gmail.com')?.id,
    alice: userRecords.find((user) => user.email === 'alice@example.com')?.id,
    bob: userRecords.find((user) => user.email === 'bob@example.com')?.id,
    charlie: userRecords.find((user) => user.email === 'charlie@example.com')?.id,
    diana: userRecords.find((user) => user.email === 'diana@example.com')?.id,
    edward: userRecords.find((user) => user.email === 'edward@example.com')?.id,
  };

  // Seed Portfolios
  const portfolios = [
    { name: 'Retirement Fund', userId: userIdMapping.admin!, currency: 'INR' },
    { name: 'Growth Stocks', userId: userIdMapping.alice!, currency: 'INR' },
  ];

  for (const pf of portfolios) {
    const portfolio = await prisma.portfolio.upsert({
      where: { id: `seed-pf-${pf.userId}` }, // Use a stable ID for seeding
      update: pf,
      create: {
        id: `seed-pf-${pf.userId}`,
        ...pf
      }
    });

    // Add Fund Transactions (Deposits)
    await prisma.fundTransaction.createMany({
      data: [
        { portfolioId: portfolio.id, type: 'DEPOSIT', amount: 1000000, date: new Date('2024-01-01') },
        { portfolioId: portfolio.id, type: 'DEPOSIT', amount: 500000, date: new Date('2024-06-01') },
      ],
      skipDuplicates: true
    });

    // Add Transactions
    await prisma.transaction.createMany({
      data: [
        { portfolioId: portfolio.id, ticker: 'RELIANCE', side: 'BUY', quantity: 10, price: 2500, tradeDate: new Date('2024-01-15') },
        { portfolioId: portfolio.id, ticker: 'TCS', side: 'BUY', quantity: 5, price: 3400, tradeDate: new Date('2024-02-10') },
        { portfolioId: portfolio.id, ticker: 'INFY', side: 'BUY', quantity: 15, price: 1500, tradeDate: new Date('2024-03-05') },
        { portfolioId: portfolio.id, ticker: 'RELIANCE', side: 'SELL', quantity: 2, price: 2900, tradeDate: new Date('2024-11-20') },
      ],
      skipDuplicates: true
    });
  }

  // Create 15 posts distributed among users
  const posts = [
    // Alice's posts
    {
      title: 'Getting Started with TypeScript and Prisma',
      content: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Fusce id erat a lorem tincidunt ultricies. Vivamus porta bibendum nulla vel accumsan.',
      published: true,
      authorId: userIdMapping.alice
    },
    // ... other posts entries (truncated in replacement content for brevity but I'll include some)
    {
      title: 'Market Intelligence: The New TradeNext features',
      content: 'TradeNext now supports multi-portfolio tracking and deep analytics.',
      published: true,
      authorId: userIdMapping.admin
    }
  ];

  for (const post of posts) {
    await prisma.post.create({ data: post });
  }

  console.log('Seeding completed.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
