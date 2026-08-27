// scripts/backfill-corporate-actions-prod.ts
//
// One-time backfill: reads corporate_actions from local Docker DB,
// writes them to prod Prisma Postgres.
//
// Usage:
//   npx tsx scripts/backfill-corporate-actions-prod.ts                        # dry-run
//   npx tsx scripts/backfill-corporate-actions-prod.ts --apply                # write to prod
//   npx tsx scripts/backfill-corporate-actions-prod.ts --apply --direct-url "postgres://..."  # use direct URL
//
// Requires:
//   - Local Docker DB running (npm run db:up)
//   - PROD_DATABASE_URL or PROD_DIRECT_URL set to prod DB connection string

import { Pool } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const LOCAL_DB_URL = "postgresql://postgres:postgres@localhost:5432/tradenext";

function getProdUrl(): string {
  // Priority: --direct-url flag > PROD_DIRECT_URL > PROD_DATABASE_URL
  const flagIdx = process.argv.indexOf("--direct-url");
  if (flagIdx >= 0 && process.argv[flagIdx + 1]) {
    return process.argv[flagIdx + 1];
  }
  const url = process.env.PROD_DIRECT_URL || process.env.PROD_DATABASE_URL;
  if (!url) {
    console.error("ERROR: Set PROD_DIRECT_URL or PROD_DATABASE_URL env var");
    process.exit(1);
  }
  return url;
}

function isAccelerateUrl(url: string): boolean {
  return url.startsWith("prisma+postgres://") || url.startsWith("prisma://");
}

// --- Read from local DB ---
async function readLocal(): Promise<Record<string, unknown>[]> {
  const pool = new Pool({ connectionString: LOCAL_DB_URL, max: 5 });
  try {
    const result = await pool.query(`
      SELECT 
        "symbol", "companyName", series, subject, "actionType",
        "exDate", "recordDate", "effectiveDate", "faceValue", "oldFV", "newFV",
        ratio, "dividendPerShare", "dividendYield", isin,
        "bookClosureStartDate", "bookClosureEndDate", "announcementDate",
        source
      FROM corporate_actions
      ORDER BY "exDate" DESC NULLS LAST
    `);
    console.log(`  Read ${result.rows.length} records from local DB`);
    return result.rows;
  } finally {
    await pool.end();
  }
}

// --- Create prod Prisma client ---
function createProdClient(url: string): PrismaClient {
  if (isAccelerateUrl(url)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new PrismaClient({ accelerateUrl: url } as any);
  }
  // Direct PostgreSQL connection via adapter
  const pool = new Pool({
    connectionString: url,
    max: 3,
    connectionTimeoutMillis: 10_000,
  });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

// --- Write to prod DB in batches ---
async function writeToProd(records: Record<string, unknown>[], apply: boolean): Promise<void> {
  const prodUrl = getProdUrl();
  const isAccelerate = isAccelerateUrl(prodUrl);
  console.log(`  Prod URL type: ${isAccelerate ? "Accelerate" : "Direct PostgreSQL"}`);
  console.log(`  Prod URL prefix: ${prodUrl.substring(0, 50)}...`);

  const prisma = createProdClient(prodUrl);

  // First check existing count
  const existingCount = await prisma.corporateAction.count();
  console.log(`  Prod existing records: ${existingCount}`);

  if (!apply) {
    console.log(`  DRY-RUN: Would upsert ${records.length} records to prod`);
    await prisma.$disconnect();
    return;
  }

  // Batch upsert
  const BATCH = 100;
  let upserted = 0;
  let errors = 0;

  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    const batchNum = Math.floor(i / BATCH) + 1;
    const totalBatches = Math.ceil(records.length / BATCH);
    console.log(`  Batch ${batchNum}/${totalBatches} (${batch.length} records)...`);

    for (const rec of batch) {
      try {
        const symbol = rec.symbol as string;
        const actionType = rec.actionType as string;
        const exDate = rec.exDate ? new Date(rec.exDate as string) : null;

        if (!symbol || !exDate) { errors++; continue; }

        await prisma.corporateAction.upsert({
          where: {
            symbol_actionType_exDate: { symbol, actionType, exDate },
          },
          update: {
            companyName: (rec.companyName as string) || "",
            series: (rec.series as string) || null,
            subject: (rec.subject as string) || null,
            recordDate: rec.recordDate ? new Date(rec.recordDate as string) : null,
            effectiveDate: rec.effectiveDate ? new Date(rec.effectiveDate as string) : null,
            faceValue: (rec.faceValue as string) || null,
            oldFV: (rec.oldFV as string) || null,
            newFV: (rec.newFV as string) || null,
            ratio: (rec.ratio as string) || null,
            dividendPerShare: rec.dividendPerShare ? Number(rec.dividendPerShare) : null,
            dividendYield: rec.dividendYield ? Number(rec.dividendYield) : null,
            isin: (rec.isin as string) || null,
            bookClosureStartDate: rec.bookClosureStartDate ? new Date(rec.bookClosureStartDate as string) : null,
            bookClosureEndDate: rec.bookClosureEndDate ? new Date(rec.bookClosureEndDate as string) : null,
            announcementDate: rec.announcementDate ? new Date(rec.announcementDate as string) : null,
            source: (rec.source as string) || "nse",
          },
          create: {
            symbol,
            companyName: (rec.companyName as string) || "",
            series: (rec.series as string) || null,
            subject: (rec.subject as string) || null,
            actionType,
            exDate,
            recordDate: rec.recordDate ? new Date(rec.recordDate as string) : null,
            effectiveDate: rec.effectiveDate ? new Date(rec.effectiveDate as string) : null,
            faceValue: (rec.faceValue as string) || null,
            oldFV: (rec.oldFV as string) || null,
            newFV: (rec.newFV as string) || null,
            ratio: (rec.ratio as string) || null,
            dividendPerShare: rec.dividendPerShare ? Number(rec.dividendPerShare) : null,
            dividendYield: rec.dividendYield ? Number(rec.dividendYield) : null,
            isin: (rec.isin as string) || null,
            bookClosureStartDate: rec.bookClosureStartDate ? new Date(rec.bookClosureStartDate as string) : null,
            bookClosureEndDate: rec.bookClosureEndDate ? new Date(rec.bookClosureEndDate as string) : null,
            announcementDate: rec.announcementDate ? new Date(rec.announcementDate as string) : null,
            source: (rec.source as string) || "nse",
          },
        });
        upserted++;
      } catch (e) {
        errors++;
        if (errors <= 5) {
          console.error(`    Error upserting ${rec.symbol}: ${e instanceof Error ? e.message : String(e)}`);
        }
        if (errors > 5 && errors % 50 === 0) {
          console.error(`    ... ${errors} total errors so far`);
        }
      }
    }

    console.log(`    Progress: ${upserted + errors}/${records.length} processed (${upserted} upserted, ${errors} errors)`);
  }

  // Verify
  const finalCount = await prisma.corporateAction.count();
  console.log(`\n  Final prod count: ${finalCount} (was ${existingCount})`);
  console.log(`  Upserted: ${upserted}, Errors: ${errors}`);

  await prisma.$disconnect();
}

// --- Main ---
async function main() {
  const apply = process.argv.includes("--apply");

  console.log(`\n=== Corporate Actions Backfill to Prod (${apply ? "APPLY" : "DRY-RUN"}) ===\n`);

  console.log("Step 1: Reading from local Docker DB...");
  const records = await readLocal();

  if (records.length === 0) {
    console.log("No records found locally. Nothing to backfill.");
    return;
  }

  console.log(`\nStep 2: Writing to prod DB...`);
  await writeToProd(records, apply);

  console.log("\n=== Done ===\n");
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
