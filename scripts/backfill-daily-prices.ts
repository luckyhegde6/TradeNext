// scripts/backfill-daily-prices.ts
//
// Ops tool: backfills / refreshes N-day windows of daily EQ bars into the main
// `daily_prices` table (fixes the Swing indicators "—" data gap — prod had
// 0-1 rows per symbol because market-sync only syncs the stock LIST).
//
// Safe: dry-run by default — pass `--apply` to actually write to the DB.
//
// Usage:
//   npx tsx --env-file=.env scripts/backfill-daily-prices.ts                          # dry-run
//   npx tsx --env-file=.env scripts/backfill-daily-prices.ts --apply                  # write (default scope)
//   npx tsx --env-file=.env scripts/backfill-daily-prices.ts --apply --symbols RELIANCE,TCS --days 90
//   npx tsx --env-file=.env scripts/backfill-daily-prices.ts --from 01-04-2026 --to 14-08-2026 --max-symbols 50
//
// Flags:
//   --apply         actually write (default: dry-run, nothing persisted)
//   --symbols A,B   explicit comma-separated symbol scope (default: NIFTY 50 ∪
//                   recent trackers ∪ live screener captures, capped)
//   --days N        calendar days of history (default 180)
//   --from DD-MM-YYYY   explicit window start (wins over --days)
//   --to DD-MM-YYYY     explicit window end (default today)
//   --max-symbols N     scope cap (default 300)

import { syncHistoricalPrices } from "../lib/services/historicalPriceSyncService";

function parseFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : undefined;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const symbolsRaw = parseFlag("--symbols");
  const daysRaw = parseFlag("--days");
  const from = parseFlag("--from");
  const to = parseFlag("--to");
  const maxSymbolsRaw = parseFlag("--max-symbols");

  const symbols = symbolsRaw ? symbolsRaw.split(",").map((s) => s.trim()) : undefined;
  const days = daysRaw ? Number(daysRaw) : undefined;
  const maxSymbols = maxSymbolsRaw ? Number(maxSymbolsRaw) : undefined;

  console.log(`\n=== Historical price sync (${apply ? "APPLY — writes to daily_prices" : "DRY-RUN — nothing persisted"}) ===`);
  if (symbols) console.log(`  scope: ${symbols.length} explicit symbols`);
  if (days) console.log(`  days: ${days}`);
  if (from || to) console.log(`  window: ${from ?? "default"} → ${to ?? "today"}`);
  if (maxSymbols) console.log(`  max-symbols: ${maxSymbols}`);

  const result = await syncHistoricalPrices({
    symbols,
    days,
    from,
    to,
    maxSymbols,
    dryRun: !apply,
  });

  console.log(`\n=== Summary ===`);
  console.log(`  scope:           ${result.scope.length} symbols`);
  console.log(`  fetched symbols: ${result.fetchedSymbols}`);
  console.log(`  bars fetched:    ${result.barsFetched}`);
  console.log(`  bars written:    ${result.barsWritten}${result.dryRun ? " (dry-run)" : ""}`);
  console.log(`  errors:          ${result.errors.length}`);
  for (const e of result.errors.slice(0, 20)) {
    console.log(`    - ${e.symbol}: ${e.error}`);
  }
  if (result.errors.length > 20) console.log(`    … and ${result.errors.length - 20} more`);
  console.log(`  duration:        ${(result.durationMs / 1000).toFixed(1)}s`);

  if (!apply) {
    console.log(`\n(No writes performed — re-run with --apply to persist.)`);
  }
}

main().catch((e) => {
  console.error("Backfill failed:", e);
  process.exit(1);
});
