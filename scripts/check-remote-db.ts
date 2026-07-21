import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

const DATABASE_URL = process.env.DATABASE_REMOTE || process.env.ACCELERATE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_REMOTE or ACCELERATE_URL must be set");
  process.exit(1);
}

console.log("Connecting to remote DB:", DATABASE_URL.substring(0, 50) + "...");

process.env.DATABASE_URL = DATABASE_URL;
const prisma = new PrismaClient({
  accelerateUrl: DATABASE_URL,
} as any);

async function main() {
  // Count users
  const userCount = await prisma.user.count();
  console.log(`\nTotal users in DB: ${userCount}`);

  // List all users
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isVerified: true,
      isBlocked: true,
      password: true,
    }
  });

  for (const u of users) {
    const hasPassword = !!u.password;
    console.log(`  User: ${u.email} | role=${u.role} | verified=${u.isVerified} | blocked=${u.isBlocked} | hasPassword=${hasPassword}`);
  }

  // Check specific demo user
  const demoUser = await prisma.user.findUnique({ where: { email: 'demo@tradenext6.app' } });
  if (!demoUser) {
    console.log("\n❌ demo@tradenext6.app NOT FOUND in DB");
  } else {
    console.log(`\n✅ demo@tradenext6.app found (id=${demoUser.id}, role=${demoUser.role})`);
    // Verify password
    const { compare } = await import('bcryptjs');
    if (demoUser.password) {
      const valid = await compare('demo123', demoUser.password);
      console.log(`   Password 'demo123' valid: ${valid}`);
    } else {
      console.log(`   No password hash stored`);
    }
  }

  const adminUser = await prisma.user.findUnique({ where: { email: 'admin@tradenext6.app' } });
  if (!adminUser) {
    console.log("❌ admin@tradenext6.app NOT FOUND in DB");
  } else {
    console.log(`✅ admin@tradenext6.app found (id=${adminUser.id}, role=${adminUser.role})`);
    if (adminUser.password) {
      const { compare } = await import('bcryptjs');
      const valid = await compare('admin123', adminUser.password);
      console.log(`   Password 'admin123' valid: ${valid}`);
    }
  }

  // Check v3.3.0 tables exist
  console.log("\n--- Checking v3.3.0 tables ---");
  try {
    const count = await prisma.dailyRecommendationRun.count();
    console.log(`✅ daily_recommendation_runs exists (count=${count})`);
  } catch (e: any) {
    console.log(`❌ daily_recommendation_runs MISSING: ${e.message?.substring(0, 100)}`);
  }

  try {
    const count = await prisma.recommendationTracker.count();
    console.log(`✅ recommendation_trackers exists (count=${count})`);
  } catch (e: any) {
    console.log(`❌ recommendation_trackers MISSING: ${e.message?.substring(0, 100)}`);
  }

  try {
    const count = await prisma.unifiedEvent.count();
    console.log(`✅ unified_events exists (count=${count})`);
  } catch (e: any) {
    console.log(`❌ unified_events MISSING: ${e.message?.substring(0, 100)}`);
  }

  // Check if AIInsight table exists (was dropped by migration)
  try {
    const count = await (prisma as any).aIInsight?.count() ?? 0;
    console.log(`✅ AIInsight exists (count=${count})`);
  } catch (e: any) {
    console.log(`❌ AIInsight table issue: ${e.message?.substring(0, 100)}`);
  }

  // Check analytics
  console.log("\n--- Checking analytics data ---");
  try {
    const stockCount = await prisma.stockSnapshot.count();
    console.log(`  StockSnapshot count: ${stockCount}`);
  } catch (e: any) {
    console.log(`  ❌ StockSnapshot table: ${e.message?.substring(0, 100)}`);
  }

  try {
    const txCount = await prisma.transaction.count();
    console.log(`  Transaction count: ${txCount}`);
  } catch (e: any) {
    console.log(`  ❌ Transaction table: ${e.message?.substring(0, 100)}`);
  }

  try {
    const corpCount = await prisma.corporateAction.count();
    console.log(`  Corporate Action count: ${corpCount}`);
  } catch (e: any) {
    console.log(`  ❌ CorporateAction table: ${e.message?.substring(0, 100)}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("FATAL:", e);
  await prisma.$disconnect();
  process.exit(1);
});
