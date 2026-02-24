import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/tradenext';
const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Starting demo user seeding...");

  const demoEmail = "demo@tradenext.in";
  
  const existingUser = await prisma.user.findUnique({
    where: { email: demoEmail },
    include: { portfolios: true },
  });

  if (existingUser) {
    console.log("Demo user already exists. Updating...");
    
    await prisma.portfolio.deleteMany({
      where: { userId: existingUser.id },
    });

    await prisma.user.delete({
      where: { id: existingUser.id },
    });
  }

  const hashedPassword = await hash("demo123", 12);

  const user = await prisma.user.create({
    data: {
      email: demoEmail,
      name: "Demo User",
      mobile: "+919999999999",
      password: hashedPassword,
      role: "user",
      isVerified: true,
      portfolios: {
        create: [
          {
            name: "Demo Portfolio",
            currency: "INR",
            transactions: {
              create: [
                {
                  tradeDate: new Date("2024-01-15"),
                  ticker: "RELIANCE",
                  side: "BUY",
                  quantity: 100,
                  price: 2400,
                  fees: 50,
                },
                {
                  tradeDate: new Date("2024-02-10"),
                  ticker: "TCS",
                  side: "BUY",
                  quantity: 50,
                  price: 3800,
                  fees: 50,
                },
                {
                  tradeDate: new Date("2024-03-05"),
                  ticker: "INFY",
                  side: "BUY",
                  quantity: 75,
                  price: 1450,
                  fees: 50,
                },
                {
                  tradeDate: new Date("2024-04-20"),
                  ticker: "HDFCBANK",
                  side: "BUY",
                  quantity: 80,
                  price: 1520,
                  fees: 50,
                },
                {
                  tradeDate: new Date("2024-05-15"),
                  ticker: "ICICIBANK",
                  side: "BUY",
                  quantity: 150,
                  price: 980,
                  fees: 50,
                },
              ],
            },
            fundTransactions: {
              create: [
                {
                  type: "DEPOSIT",
                  amount: 500000,
                  date: new Date("2024-01-01"),
                  notes: "Initial investment",
                },
              ],
            },
          },
        ],
      },
    },
  });

  const adminEmail = "admin@tradenext.in";
  
  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (!existingAdmin) {
    const adminPassword = await hash("admin123", 12);
    await prisma.user.create({
      data: {
        email: adminEmail,
        name: "Admin User",
        mobile: "+919999999998",
        password: adminPassword,
        role: "admin",
        isVerified: true,
      },
    });
    console.log("Admin user created:", adminEmail);
  } else {
    console.log("Admin user already exists");
  }

  console.log("Demo user created:", user.email);
  console.log("Demo portfolio ID:", user.portfolios[0]?.id);
  console.log("\nLogin credentials:");
  console.log("  Email: demo@tradenext.in");
  console.log("  Password: demo123");
  console.log("\nAdmin credentials:");
  console.log("  Email: admin@tradenext.in");
  console.log("  Password: admin123");
  console.log("\nSeeding completed!");
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
