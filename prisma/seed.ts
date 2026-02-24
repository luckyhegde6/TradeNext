import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/tradenext';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const DEMO_EMAIL = "demo@tradenext.in";
const DEMO_PASSWORD = "demo123";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@tradenext6.app";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

async function main() {
  console.log("Starting database seeding...");
  console.log("Admin email:", ADMIN_EMAIL);

  const adminPasswordHash = await hash(ADMIN_PASSWORD, 12);
  const demoPasswordHash = await hash(DEMO_PASSWORD, 12);

  // Create admin user
  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {},
    create: {
      email: ADMIN_EMAIL,
      name: 'Admin User',
      password: adminPasswordHash,
      role: 'admin',
      isVerified: true,
      isBlocked: false,
      mobile: '+919999999998',
    },
  });
  console.log("Admin user:", admin.email);

  // Create demo user with portfolio
  const demoUser = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: {
      email: DEMO_EMAIL,
      name: 'Demo User',
      password: demoPasswordHash,
      role: 'user',
      isVerified: true,
      isBlocked: false,
      mobile: '+919999999999',
    },
  });
  console.log("Demo user:", demoUser.email);

  // Create demo portfolio with transactions
  const portfolio = await prisma.portfolio.upsert({
    where: { id: `demo-portfolio-${demoUser.id}` },
    update: {},
    create: {
      id: `demo-portfolio-${demoUser.id}`,
      userId: demoUser.id,
      name: 'Demo Portfolio',
      currency: 'INR',
    },
  });

  // Add fund transactions
  await prisma.fundTransaction.upsert({
    where: { id: `demo-fund-${portfolio.id}` },
    update: {},
    create: {
      id: `demo-fund-${portfolio.id}`,
      portfolioId: portfolio.id,
      type: 'DEPOSIT',
      amount: 500000,
      date: new Date('2024-01-01'),
      notes: 'Initial investment',
    },
  });

  // Add stock transactions
  const transactions = [
    { ticker: 'RELIANCE', side: 'BUY', quantity: 100, price: 2400, tradeDate: new Date('2024-01-15') },
    { ticker: 'TCS', side: 'BUY', quantity: 50, price: 3800, tradeDate: new Date('2024-02-10') },
    { ticker: 'INFY', side: 'BUY', quantity: 75, price: 1450, tradeDate: new Date('2024-03-05') },
    { ticker: 'HDFCBANK', side: 'BUY', quantity: 80, price: 1520, tradeDate: new Date('2024-04-20') },
    { ticker: 'ICICIBANK', side: 'BUY', quantity: 150, price: 980, tradeDate: new Date('2024-05-15') },
  ];

  for (let i = 0; i < transactions.length; i++) {
    const t = transactions[i];
    await prisma.transaction.upsert({
      where: { id: `demo-txn-${portfolio.id}-${i}` },
      update: {},
      create: {
        id: `demo-txn-${portfolio.id}-${i}`,
        portfolioId: portfolio.id,
        ticker: t.ticker,
        side: t.side,
        quantity: t.quantity,
        price: t.price,
        tradeDate: t.tradeDate,
        fees: 50,
      },
    });
  }

  console.log("Demo portfolio created with", transactions.length, "transactions");

  // Create additional demo users
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
  console.log("Additional users seeded");

  console.log("\n=== Login Credentials ===");
  console.log("Demo:  ", DEMO_EMAIL, "/", DEMO_PASSWORD);
  console.log("Admin: ", ADMIN_EMAIL, "/", ADMIN_PASSWORD);
  console.log("========================\n");

  console.log("Seeding completed!");
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
