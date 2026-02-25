import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/tradenext';
const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const nifty50Stocks = [
  'ADANIENT', 'ADANIPORTS', 'APOLLOHOSP', 'ASIANPAINT', 'AXISBANK',
  'BAJAJ-AUTO', 'BAJAJFINSV', 'BAJFINANCE', 'BEL', 'BHARTIARTL',
  'BPCL', 'BRITANNIA', 'CIPLA', 'COALINDIA', 'DRREDDY',
  'EICHERMOT', 'ETERNAL', 'GRASIM', 'HCLTECH', 'HDFCBANK',
  'HDFCLIFE', 'HINDALCO', 'HINDUNILVR', 'ICICIBANK', 'INDIGO',
  'INFY', 'ITC', 'JIOFIN', 'JSWSTEEL', 'KOTAKBANK',
  'LT', 'M&M', 'MARUTI', 'MAXHEALTH', 'NESTLEIND',
  'NTPC', 'ONGC', 'POWERGRID', 'RELIANCE', 'SBILIFE',
  'SBIN', 'SHRIRAMFIN', 'SUNPHARMA', 'TATACONSUM', 'TATASTEEL',
  'TCS', 'TECHM', 'TITAN', 'TMPV', 'TRENT',
  'ULTRACEMCO', 'WIPRO'
];

const basePrice: Record<string, number> = {
  'ADANIENT': 2200, 'ADANIPORTS': 1500, 'APOLLOHOSP': 7700, 'ASIANPAINT': 2400, 'AXISBANK': 1400,
  'BAJAJ-AUTO': 10000, 'BAJAJFINSV': 2000, 'BAJFINANCE': 1000, 'BEL': 430, 'BHARTIARTL': 1900,
  'BPCL': 380, 'BRITANNIA': 5200, 'CIPLA': 1340, 'COALINDIA': 430, 'DRREDDY': 1300,
  'EICHERMOT': 8000, 'ETERNAL': 250, 'GRASIM': 2850, 'HCLTECH': 1370, 'HDFCBANK': 900,
  'HDFCLIFE': 730, 'HINDALCO': 930, 'HINDUNILVR': 2370, 'ICICIBANK': 1390, 'INDIGO': 4900,
  'INFY': 1280, 'ITC': 315, 'JIOFIN': 255, 'JSWSTEEL': 1270, 'KOTAKBANK': 420,
  'LT': 4250, 'M&M': 3450, 'MARUTI': 15000, 'MAXHEALTH': 1080, 'NESTLEIND': 1320,
  'NTPC': 380, 'ONGC': 275, 'POWERGRID': 305, 'RELIANCE': 1400, 'SBILIFE': 2070,
  'SBIN': 1195, 'SHRIRAMFIN': 1080, 'SUNPHARMA': 1760, 'TATACONSUM': 1170, 'TATASTEEL': 212,
  'TCS': 2580, 'TECHM': 1350, 'TITAN': 4300, 'TMPV': 380, 'TRENT': 3900,
  'ULTRACEMCO': 13000, 'WIPRO': 200
};

function randomPrice(base: number): number {
  const variance = (Math.random() - 0.5) * 0.1;
  return Math.round(base * (1 + variance) * 100) / 100;
}

function generateDailyPrices(ticker: string, days: number = 90) {
  const prices = [];
  const base = basePrice[ticker] || 1000;
  let currentPrice = base;
  const today = new Date();

  for (let i = days; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    
    const change = (Math.random() - 0.48) * 0.03;
    currentPrice = currentPrice * (1 + change);
    
    const open = randomPrice(currentPrice * 0.99);
    const high = randomPrice(currentPrice * 1.02);
    const low = randomPrice(currentPrice * 0.98);
    const close = currentPrice;
    const volume = Math.floor(Math.random() * 5000000) + 500000;
    const vwap = randomPrice(currentPrice);

    prices.push({
      ticker,
      tradeDate: date,
      open,
      high,
      low,
      close,
      volume,
      vwap
    });
  }

  return prices;
}

async function main() {
  console.log('Adding sample stock data...');
  
  const existingTickers = await prisma.dailyPrice.findMany({
    distinct: ['ticker'],
    select: { ticker: true }
  });
  const existing = new Set(existingTickers.map(t => t.ticker));

  let added = 0;
  for (const ticker of nifty50Stocks) {
    if (existing.has(ticker)) {
      console.log(`  Skipping ${ticker} (already exists)`);
      continue;
    }

    const prices = generateDailyPrices(ticker);
    
    for (const price of prices) {
      await prisma.dailyPrice.upsert({
        where: {
          ticker_tradeDate: {
            ticker: price.ticker,
            tradeDate: new Date(price.tradeDate)
          }
        },
        update: price,
        create: price
      });
    }
    
    console.log(`  Added ${ticker} with ${prices.length} days of data`);
    added++;
  }

  const totalStocks = await prisma.dailyPrice.findMany({
    distinct: ['ticker'],
    select: { ticker: true }
  });

  console.log(`\nDone! Added ${added} new stocks. Total unique stocks: ${totalStocks.length}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
