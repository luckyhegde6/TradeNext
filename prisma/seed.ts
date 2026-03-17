import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { withAccelerate } from '@prisma/extension-accelerate';
import * as fs from 'fs';
import * as path from 'path';

const useRemoteDb = process.env.USE_REMOTE_DB === 'true';

console.log("DEBUG: USE_REMOTE_DB:", process.env.USE_REMOTE_DB);
console.log("DEBUG: DATABASE_URL:", process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 50) + '...' : 'not set');
console.log("DEBUG: Using remote DB:", useRemoteDb);

let prisma: PrismaClient;

if (useRemoteDb) {
  const remoteUrl = process.env.DATABASE_REMOTE || process.env.ACCELERATE_URL;
  if (remoteUrl) {
    process.env.DATABASE_URL = remoteUrl;
  }
  prisma = new PrismaClient({
    accelerateUrl: process.env.DATABASE_URL,
  }).$extends(withAccelerate()) as unknown as PrismaClient;
} else {
  const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/tradenext';
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  prisma = new PrismaClient({ adapter });
}

const DEMO_EMAIL = "demo@tradenext6.app";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "demo123";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@tradenext6.app";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

if (!ADMIN_PASSWORD || !DEMO_PASSWORD) {
  console.error("ERROR: ADMIN_PASSWORD and DEMO_PASSWORD environment variables must be set");
  process.exit(1);
}

async function main() {
  console.log("Starting database seeding...");
  console.log("Admin email:", ADMIN_EMAIL);

  const adminPasswordHash = await hash(ADMIN_PASSWORD, 12);
  const demoPasswordHash = await hash(DEMO_PASSWORD, 12);

  // Create admin user
  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { updatedAt: new Date() },
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

  // Create admin portfolio with transactions
  const adminPortfolio = await prisma.portfolio.upsert({
    where: { id: `admin-portfolio-${admin.id}` },
    update: { updatedAt: new Date() },
    create: {
      id: `admin-portfolio-${admin.id}`,
      userId: admin.id,
      name: 'Admin Portfolio',
      currency: 'INR',
    },
  });
  console.log("Admin portfolio created with ID:", adminPortfolio.id, "for userId:", adminPortfolio.userId);

  // Add admin fund transactions
  await prisma.fundTransaction.upsert({
    where: { id: `admin-fund-${adminPortfolio.id}` },
    update: { amount: 1000000 },
    create: {
      id: `admin-fund-${adminPortfolio.id}`,
      portfolioId: adminPortfolio.id,
      type: 'DEPOSIT',
      amount: 1000000,
      date: new Date('2024-01-01'),
      notes: 'Initial admin investment',
    },
  });

  // Add admin stock transactions
  const adminTransactions = [
    { ticker: 'RELIANCE', side: 'BUY', quantity: 200, price: 2500, tradeDate: new Date('2024-01-10') },
    { ticker: 'TCS', side: 'BUY', quantity: 100, price: 4000, tradeDate: new Date('2024-02-15') },
  ];

  for (let i = 0; i < adminTransactions.length; i++) {
    const t = adminTransactions[i];
    await prisma.transaction.upsert({
      where: { id: `admin-txn-${adminPortfolio.id}-${i}` },
      update: {
        ticker: t.ticker,
        side: t.side,
        quantity: t.quantity,
        price: t.price,
        tradeDate: t.tradeDate,
      },
      create: {
        id: `admin-txn-${adminPortfolio.id}-${i}`,
        portfolioId: adminPortfolio.id,
        ticker: t.ticker,
        side: t.side,
        quantity: t.quantity,
        price: t.price,
        tradeDate: t.tradeDate,
        fees: 50,
      },
    });
  }
  console.log("Admin portfolio created with", adminTransactions.length, "transactions");
  // Create demo user with portfolio
  const demoUser = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { updatedAt: new Date() },
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
  console.log("Demo user:", demoUser.email, "with ID:", demoUser.id);

  // Create demo portfolio with transactions
  const portfolio = await prisma.portfolio.upsert({
    where: { id: `demo-portfolio-${demoUser.id}` },
    update: { updatedAt: new Date() },
    create: {
      id: `demo-portfolio-${demoUser.id}`,
      userId: demoUser.id,
      name: 'Demo Portfolio',
      currency: 'INR',
    },
  });
  console.log("Demo portfolio created with ID:", portfolio.id, "for userId:", portfolio.userId);
  // Add fund transactions
  await prisma.fundTransaction.upsert({
    where: { id: `demo-fund-${portfolio.id}` },
    update: { amount: 500000 },
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
      update: {
        ticker: t.ticker,
        side: t.side,
        quantity: t.quantity,
        price: t.price,
        tradeDate: t.tradeDate,
      },
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

  // Seed symbols from JSON
  console.log("Seeding symbols from JSON...");
  // Seed deals data from CSV files
  console.log("\n=== Seeding Deals Data ===");
  const sampleDataPath = path.join(process.cwd(), 'sample');

  // Helper function to parse CSV
  function parseCSV(content: string): string[][] {
    const lines = content.trim().split('\n');
    return lines.map(line => {
      // Handle CSV with quotes and commas in fields
      const result: string[] = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    });
  }

  // Helper to parse date from "07-MAR-2025" format
  function parseDate(dateStr: string): Date {
    const [day, monStr, year] = dateStr.split('-');
    const monthMap: Record<string, number> = {
      'JAN': 0, 'FEB': 1, 'MAR': 2, 'APR': 3, 'MAY': 4, 'JUN': 5,
      'JUL': 6, 'AUG': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DEC': 11
    };
    const month = monthMap[monStr.toUpperCase()] ?? 0;
    return new Date(parseInt(year), month, parseInt(day));
  }

  // Helper to parse quantity with commas
  function parseQuantity(qtyStr: string): number {
    return parseInt(qtyStr.replace(/,/g, ''), 10) || 0;
  }

  // Helper to parse trade price
  function parseTradePrice(priceStr: string): number {
    return parseFloat(priceStr) || 0;
  }

  // Seed Bulk Deals
  const bulkDealsPath = path.join(sampleDataPath, 'ingest_csv', 'Bulk-Deals-07-03-2025-to-07-03-2026.csv');
  if (fs.existsSync(bulkDealsPath)) {
    console.log("Seeding Bulk Deals...");
    const bulkContent = fs.readFileSync(bulkDealsPath, 'utf8');
    const bulkRows = parseCSV(bulkContent);
    const headers = bulkRows[0];

    // Find column indices (account for BOM in first header)
    const dateIdx = headers.findIndex(h => h.replace('\ufeff', '').toLowerCase().includes('date'));
    const symbolIdx = headers.findIndex(h => h.toLowerCase().includes('symbol'));
    const securityNameIdx = headers.findIndex(h => h.toLowerCase().includes('security name'));
    const clientNameIdx = headers.findIndex(h => h.toLowerCase().includes('client name'));
    const buySellIdx = headers.findIndex(h => h.toLowerCase().includes('buy / sell'));
    const quantityIdx = headers.findIndex(h => h.toLowerCase().includes('quantity traded'));
    const tradePriceIdx = headers.findIndex(h => h.toLowerCase().includes('trade price'));
    const remarksIdx = headers.findIndex(h => h.toLowerCase().includes('remarks'));

    const bulkDealsToInsert: any[] = [];
    const maxRecords = 50;

    for (let i = 1; i < Math.min(bulkRows.length, maxRecords + 1); i++) {
      const row = bulkRows[i];
      if (row.length < Math.max(quantityIdx, tradePriceIdx) + 1) continue;

      const date = parseDate(row[dateIdx]);
      const symbol = row[symbolIdx];
      const securityName = row[securityNameIdx];
      const clientName = row[clientNameIdx];
      const buySell = row[buySellIdx];
      const quantity = parseQuantity(row[quantityIdx]);
      const tradePrice = parseTradePrice(row[tradePriceIdx]);
      const remarks = remarksIdx >= 0 ? row[remarksIdx] : '-';

      bulkDealsToInsert.push({
        date,
        symbol,
        securityName,
        clientName,
        buySell,
        quantityTraded: quantity,
        tradePrice,
        remarks: remarks === '-' ? null : remarks,
      });
    }

    // Insert in batches
    const batchSize = 500;
    for (let i = 0; i < bulkDealsToInsert.length; i += batchSize) {
      const batch = bulkDealsToInsert.slice(i, i + batchSize);
      await prisma.bulkDeal.createMany({
        data: batch,
        skipDuplicates: true
      });
    }
    console.log(`Inserted ${bulkDealsToInsert.length} Bulk Deals`);
  } else {
    console.warn("Bulk Deals CSV not found at", bulkDealsPath);
  }

  // Seed Block Deals
  const blockDealsPath = path.join(sampleDataPath, 'ingest_csv', 'Block-Deals-07-03-2025-to-07-03-2026.csv');
  if (fs.existsSync(blockDealsPath)) {
    console.log("Seeding Block Deals...");
    const blockContent = fs.readFileSync(blockDealsPath, 'utf8');
    const blockRows = parseCSV(blockContent);
    const headers = blockRows[0];

    const dateIdx = headers.findIndex(h => h.replace('\ufeff', '').toLowerCase().includes('date'));
    const symbolIdx = headers.findIndex(h => h.toLowerCase().includes('symbol'));
    const securityNameIdx = headers.findIndex(h => h.toLowerCase().includes('security name'));
    const clientNameIdx = headers.findIndex(h => h.toLowerCase().includes('client name'));
    const buySellIdx = headers.findIndex(h => h.toLowerCase().includes('buy / sell'));
    const quantityIdx = headers.findIndex(h => h.toLowerCase().includes('quantity traded'));
    const tradePriceIdx = headers.findIndex(h => h.toLowerCase().includes('trade price'));
    const remarksIdx = headers.findIndex(h => h.toLowerCase().includes('remarks'));

    const blockDealsToInsert: any[] = [];
    const maxRecords = 50;

    for (let i = 1; i < Math.min(blockRows.length, maxRecords + 1); i++) {
      const row = blockRows[i];
      if (row.length < Math.max(quantityIdx, tradePriceIdx) + 1) continue;

      const date = parseDate(row[dateIdx]);
      const symbol = row[symbolIdx];
      const securityName = row[securityNameIdx];
      const clientName = row[clientNameIdx];
      const buySell = row[buySellIdx];
      const quantity = parseQuantity(row[quantityIdx]);
      const tradePrice = parseTradePrice(row[tradePriceIdx]);
      const remarks = remarksIdx >= 0 ? row[remarksIdx] : '-';

      blockDealsToInsert.push({
        date,
        symbol,
        securityName,
        clientName,
        buySell,
        quantityTraded: quantity,
        tradePrice,
        remarks: remarks === '-' ? null : remarks,
      });
    }

    const batchSize = 500;
    for (let i = 0; i < blockDealsToInsert.length; i += batchSize) {
      const batch = blockDealsToInsert.slice(i, i + batchSize);
      await prisma.blockDeal.createMany({
        data: batch,
        skipDuplicates: true
      });
    }
    console.log(`Inserted ${blockDealsToInsert.length} Block Deals`);
  } else {
    console.warn("Block Deals CSV not found at", blockDealsPath);
  }

  // Seed Short Selling
  const shortSellingPath = path.join(sampleDataPath, 'ingest_csv', 'Short-Selling-07-03-2025-to-07-03-2026.csv');
  if (fs.existsSync(shortSellingPath)) {
    console.log("Seeding Short Selling...");
    const shortContent = fs.readFileSync(shortSellingPath, 'utf8');
    const shortRows = parseCSV(shortContent);
    const headers = shortRows[0];

    const dateIdx = headers.findIndex(h => h.replace('\ufeff', '').toLowerCase().includes('date'));
    const symbolIdx = headers.findIndex(h => h.toLowerCase().includes('symbol'));
    const securityNameIdx = headers.findIndex(h => h.toLowerCase().includes('security name'));
    const quantityIdx = headers.findIndex(h => h.toLowerCase().includes('quantity'));

    const shortSellingToInsert: any[] = [];
    const maxRecords = 50;

    for (let i = 1; i < Math.min(shortRows.length, maxRecords + 1); i++) {
      const row = shortRows[i];
      if (row.length < Math.max(quantityIdx) + 1) continue;

      const date = parseDate(row[dateIdx]);
      const symbol = row[symbolIdx];
      const securityName = row[securityNameIdx];
      const quantity = parseQuantity(row[quantityIdx]);

      shortSellingToInsert.push({
        date,
        symbol,
        securityName,
        quantity,
      });
    }

    const batchSize = 500;
    for (let i = 0; i < shortSellingToInsert.length; i += batchSize) {
      const batch = shortSellingToInsert.slice(i, i + batchSize);
      await prisma.shortSelling.createMany({
        data: batch,
        skipDuplicates: true
      });
    }
    console.log(`Inserted ${shortSellingToInsert.length} Short Selling records`);
  } else {
    console.warn("Short Selling CSV not found at", shortSellingPath);
  }

  // Seed from bulkdeals.json (additional sample data)
  const bulkDealsJsonPath = path.join(sampleDataPath, 'bulkdeals.json');
  if (fs.existsSync(bulkDealsJsonPath)) {
    console.log("Seeding additional data from bulkdeals.json...");
    const jsonContent = fs.readFileSync(bulkDealsJsonPath, 'utf8');
    const bulkData = JSON.parse(jsonContent);

    if (bulkData.BULK_DEALS_DATA && Array.isArray(bulkData.BULK_DEALS_DATA)) {
      const jsonDealsToInsert: any[] = [];
      const maxRecords = 50;
      const count = Math.min(bulkData.BULK_DEALS_DATA.length, maxRecords);

      for (let i = 0; i < count; i++) {
        const item = bulkData.BULK_DEALS_DATA[i];
        const date = parseDate(item.date);
        const symbol = item.symbol;
        const securityName = item.name;
        const clientName = item.clientName;
        const buySell = item.buySell;
        const quantity = parseQuantity(item.qty);
        const tradePrice = parseTradePrice(item.watp);
        const remarks = item.reminders || item.remarks || '-';

        jsonDealsToInsert.push({
          date,
          symbol,
          securityName,
          clientName,
          buySell,
          quantityTraded: quantity,
          tradePrice,
          remarks: remarks === '-' ? null : remarks,
        });
      }

      const batchSize = 500;
      for (let i = 0; i < jsonDealsToInsert.length; i += batchSize) {
        const batch = jsonDealsToInsert.slice(i, i + batchSize);
        await prisma.bulkDeal.createMany({
          data: batch,
          skipDuplicates: true
        });
      }
      console.log(`Inserted ${jsonDealsToInsert.length} additional Bulk Deals from JSON`);
    }
  } else {
    console.warn("bulkdeals.json not found at", bulkDealsJsonPath);
  }

  console.log("=== Corporate Actions Seeding ===\n");
  const corporateActionsPath = path.join(sampleDataPath, 'ingest_csv', 'CF-CA-equities-10-03-2025-to-10-03-2026.csv');
  if (fs.existsSync(corporateActionsPath)) {
    console.log("Seeding Corporate Actions from CSV...");
    const caContent = fs.readFileSync(corporateActionsPath, 'utf8');
    const caRows = parseCSV(caContent);
    const headers = caRows[0];

    // Find column indices (handle BOM)
    const symbolIdx = headers.findIndex(h => h.replace('\ufeff', '').toLowerCase().includes('symbol'));
    const companyNameIdx = headers.findIndex(h => h.toLowerCase().includes('company name'));
    const seriesIdx = headers.findIndex(h => h.toLowerCase().includes('series'));
    const purposeIdx = headers.findIndex(h => h.toLowerCase().includes('purpose'));
    const faceValueIdx = headers.findIndex(h => h.toLowerCase().includes('face value'));
    const exDateIdx = headers.findIndex(h => h.toLowerCase().includes('ex-date'));
    const recordDateIdx = headers.findIndex(h => h.toLowerCase().includes('record date'));
    const bookClosureStartIdx = headers.findIndex(h => h.toLowerCase().includes('book closure start date'));
    const bookClosureEndIdx = headers.findIndex(h => h.toLowerCase().includes('book closure end date'));

    // Parser for corporate action dates (handles "-" as null)
    function parseDateCA(dateStr: string): Date | null {
      if (!dateStr || dateStr === '-') return null;
      try {
        const [day, monStr, year] = dateStr.split('-');
        const monthMap: Record<string, number> = {
          'JAN': 0, 'FEB': 1, 'MAR': 2, 'APR': 3, 'MAY': 4, 'JUN': 5,
          'JUL': 6, 'AUG': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DEC': 11
        };
        const month = monthMap[monStr.toUpperCase()];
        if (month === undefined) return null;
        return new Date(parseInt(year), month, parseInt(day));
      } catch {
        return null;
      }
    }

    const parsePurpose = (purpose: string): { actionType: string; dividendAmount?: number; ratio?: string } => {
      const p = purpose.toLowerCase();
      let actionType = 'OTHER';
      let dividendAmount: number | undefined = undefined;
      let ratio: string | undefined = undefined;

      if (p.includes('dividend') || p.includes('interest payment')) {
        actionType = p.includes('interest') ? 'INTEREST' : 'DIVIDEND';
        const match = purpose.match(/Rs\s*([\d,.]+)\s*Per Share/i);
        if (match) dividendAmount = parseFloat(match[1].replace(/,/g, ''));
      } else if (p.includes('bonus')) {
        actionType = 'BONUS';
        const match = purpose.match(/bonus\s+(\d+:\d+)/i);
        if (match) ratio = match[1];
      } else if (p.includes('rights')) {
        actionType = 'RIGHTS';
        const ratioMatch = purpose.match(/rights\s+(\d+:\d+)/i);
        if (ratioMatch) ratio = ratioMatch[1];
      } else if (p.includes('split') || p.includes('face value split')) {
        actionType = 'SPLIT';
      } else if (p.includes('buyback')) {
        actionType = 'BUYBACK';
      } else if (p.includes('demerger')) {
        actionType = 'DEMERGER';
      } else if (p.includes('redemption')) {
        actionType = 'REDEMPTION';
      } else if (p.includes('distribution')) {
        actionType = 'DISTRIBUTION';
      }

      return { actionType, dividendAmount, ratio };
    };

    const corporateActionsToInsert: any[] = [];

    for (let i = 1; i < caRows.length; i++) {
      const row = caRows[i];
      if (row.length < Math.max(faceValueIdx, exDateIdx) + 1) continue;

      const symbol = row[symbolIdx];
      const companyName = row[companyNameIdx];
      const series = seriesIdx >= 0 ? row[seriesIdx] : null;
      const purpose = row[purposeIdx] || '';
      const faceValue = row[faceValueIdx] || null;
      const exDate = parseDateCA(row[exDateIdx]);
      const recordDate = recordDateIdx >= 0 ? parseDateCA(row[recordDateIdx]) : null;
      const bookClosureStart = bookClosureStartIdx >= 0 ? parseDateCA(row[bookClosureStartIdx]) : null;
      const bookClosureEnd = bookClosureEndIdx >= 0 ? parseDateCA(row[bookClosureEndIdx]) : null;

      const { actionType, dividendAmount, ratio } = parsePurpose(purpose);

      corporateActionsToInsert.push({
        symbol,
        companyName,
        series: series || null,
        subject: purpose,
        actionType,
        exDate,
        recordDate,
        effectiveDate: exDate,
        faceValue,
        oldFV: null,
        newFV: null,
        ratio,
        dividendPerShare: dividendAmount || null,
        dividendYield: null,
        isin: null,
        bookClosureStartDate: bookClosureStart,
        bookClosureEndDate: bookClosureEnd,
        announcementDate: null,
        source: 'admin',
      });
    }

    const batchSize = 500;
    for (let i = 0; i < corporateActionsToInsert.length; i += batchSize) {
      const batch = corporateActionsToInsert.slice(i, i + batchSize);
      await prisma.corporateAction.createMany({
        data: batch,
        skipDuplicates: true
      });
    }
    console.log(`Inserted ${corporateActionsToInsert.length} Corporate Actions`);
  } else {
    console.warn("Corporate Actions CSV not found at", corporateActionsPath);
  }

  console.log("=== Corporate Actions Seeding Complete ===\n");

  console.log("\n=== Login Credentials ===");
  console.log("Demo:  ", DEMO_EMAIL, "/", "***");
  console.log("Admin: ", ADMIN_EMAIL, "/", "***");
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
