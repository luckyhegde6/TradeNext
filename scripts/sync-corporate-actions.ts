/**
 * Script to sync historical corporate action data from NSE to database
 * 
 * Usage: npx tsx scripts/sync-corporate-actions.ts
 * 
 * This script fetches corporate actions from NSE API for all symbols in the database
 * and stores them in the corporate_actions table.
 */

import { PrismaClient } from "@prisma/client";
import { nseFetch } from "@/lib/nse-client";
import { syncActions } from "@/lib/services/sync-service";
import { CorpActionDTO } from "@/lib/nse/dto";

const prisma = new PrismaClient();

const BATCH_SIZE = 50;
const DELAY_MS = 2000; // Delay between batches to avoid rate limiting

interface NseResponse {
  data?: CorpActionDTO[];
 CorpActionDTO?: CorpActionDTO[];
}

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCorporateActions(symbol: string): Promise<CorpActionDTO[]> {
  try {
    const qs = `?functionName=getCorpAction&symbol=${encodeURIComponent(symbol)}&marketApiType=equities&noOfRecords=100`;
    const rawData = await nseFetch("/api/NextApi/apiClient/GetQuoteApi", qs) as NseResponse;
    
    const data = rawData?.data || rawData?.CorpActionDTO || [];
    return data as CorpActionDTO[];
  } catch (e) {
    console.error(`Failed to fetch corporate actions for ${symbol}:`, e);
    return [];
  }
}

async function main() {
  console.log("Starting corporate action sync...\n");

  // Get all symbols from database
  const symbols = await prisma.symbol.findMany({
    select: { symbol: true },
    orderBy: { symbol: "asc" },
  });

  console.log(`Found ${symbols.length} symbols to process`);

  let processed = 0;
  let totalActions = 0;
  let errors = 0;

  // Process in batches
  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(symbols.length / BATCH_SIZE);

    console.log(`\nProcessing batch ${batchNum}/${totalBatches} (${batch.length} symbols)...`);

    const results = await Promise.allSettled(
      batch.map(async (s) => {
        const actions = await fetchCorporateActions(s.symbol);
        if (actions.length > 0) {
          await syncActions(s.symbol, actions);
        }
        return { symbol: s.symbol, count: actions.length };
      })
    );

    // Count results
    for (const result of results) {
      if (result.status === "fulfilled") {
        processed++;
        totalActions += result.value.count;
        if (result.value.count > 0) {
          console.log(`  ${result.value.symbol}: ${result.value.count} actions`);
        }
      } else {
        errors++;
        console.error(`  Error:`, result.reason);
      }
    }

    // Delay between batches to avoid rate limiting
    if (i + BATCH_SIZE < symbols.length) {
      console.log(`  Waiting ${DELAY_MS}ms before next batch...`);
      await delay(DELAY_MS);
    }
  }

  console.log("\n" + "=".repeat(50));
  console.log("Sync completed!");
  console.log(`  Symbols processed: ${processed}/${symbols.length}`);
  console.log(`  Total actions synced: ${totalActions}`);
  console.log(`  Errors: ${errors}`);
  console.log("=".repeat(50));
}

main()
  .catch((e) => {
    console.error("Fatal error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
