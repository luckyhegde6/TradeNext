/**
 * scripts/fetch-nse-scrips.ts — generate the NSE "Securities available for trading
 * (Equity segment)" constant module (`lib/services/nseScripList.ts`) from the
 * official NSE CSV.
 *
 * Source:
 *   Human page : https://www.nseindia.com/static/market-data/securities-available-for-trading
 *   Machine CSV: https://archives.nseindia.com/content/equities/EQUITY_L.csv   (EQUITY_L.csv)
 *
 * The CSV shape is stable and simple (8 comma-separated fields, no quoted/embedded
 * commas):
 *   SYMBOL, NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT,
 *   ISIN NUMBER, FACE VALUE
 *
 * Usage (defaults to dry-run stats; pass --write to generate the module):
 *   npx tsx scripts/fetch-nse-scrips.ts
 *   npx tsx scripts/fetch-nse-scrips.ts --write
 *   npm run fetch:scrips -- --write
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { get as httpsGet } from "node:https";

const CSV_URL =
  "https://archives.nseindia.com/content/equities/EQUITY_L.csv";
const OUT_PATH = join(process.cwd(), "lib", "services", "nseScripList.ts");
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36";
const TIMEOUT_MS = 90_000;

interface NseScripRow {
  symbol: string;
  companyName: string;
  series: string;
  dateOfListing: string;
  paidUpValue: number;
  marketLot: number;
  isin: string;
  faceValue: number;
}

function fetchCsv(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpsGet(
      url,
      { headers: { "User-Agent": USER_AGENT, Accept: "*/*" }, timeout: TIMEOUT_MS },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (d: Buffer) => chunks.push(d));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error(`timeout after ${TIMEOUT_MS}ms`));
    });
    req.on("error", reject);
  });
}

function parseCsv(text: string): { rows: NseScripRow[]; skipped: string[] } {
  const rows: NseScripRow[] = [];
  const skipped: string[] = [];
  const lines = text.split(/\r?\n/);
  const seen = new Set<string>();
  let started = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!started) {
      // First non-empty line is the header
      started = true;
      if (!/^SYMBOL/i.test(line)) {
        skipped.push(`unexpected first line: ${line.slice(0, 80)}`);
      }
      continue;
    }
    const fields = line.split(",").map((f) => f.trim());
    if (fields.length !== 8) {
      skipped.push(`malformed (${fields.length} fields): ${line.slice(0, 80)}`);
      continue;
    }
    const [symbol, companyName, series, dateOfListing, paidUpValue, marketLot, isin, faceValue] = fields;
    if (!symbol || !companyName || !isin) {
      skipped.push(`missing required field: ${line.slice(0, 80)}`);
      continue;
    }
    if (seen.has(symbol)) {
      skipped.push(`duplicate symbol: ${symbol}`);
      continue;
    }
    seen.add(symbol);
    const toNum = (s: string, label: string, row: string): number => {
      const n = Number(s);
      if (Number.isFinite(n)) return n;
      skipped.push(`non-numeric ${label} "${s}" on ${row}`);
      return 0;
    };
    rows.push({
      symbol,
      companyName,
      series,
      dateOfListing,
      paidUpValue: toNum(paidUpValue, "paidUpValue", symbol),
      marketLot: toNum(marketLot, "marketLot", symbol),
      isin,
      faceValue: toNum(faceValue, "faceValue", symbol),
    });
  }
  rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return { rows, skipped };
}

function escapeValue(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildModuleText(rows: NseScripRow[], generatedAt: string): string {
  const lines: string[] = [];
  lines.push("// GENERATED FILE — do not edit by hand. Regenerate with: npm run fetch:scrips -- --write");
  lines.push("//");
  lines.push("// Source: NSE — Securities available for trading (Equity segment)");
  lines.push("//   Human page : https://www.nseindia.com/static/market-data/securities-available-for-trading");
  lines.push("//   Machine CSV: https://archives.nseindia.com/content/equities/EQUITY_L.csv");
  lines.push(`// Generated : ${generatedAt} · securities: ${rows.length}`);
  lines.push("//");
  lines.push("// Constant loaded at module import and used for Symbol references:");
  lines.push("//   - O(1) membership (isNseSymbol) — backtest/screener/analyze validation,");
  lines.push("//     unlisted-symbol fallback instead of hard 404");
  lines.push("//   - metadata lookup (getNseScrip) — ISIN, series, face value, market lot, listing date");
  lines.push("//   - live filtered search (searchNseSymbols) — autocomplete / symbol input");
  lines.push("");
  lines.push("export interface NseScrip {");
  lines.push("  symbol: string;");
  lines.push("  companyName: string;");
  lines.push("  series: string; // EQ | BE | BZ");
  lines.push("  dateOfListing: string; // DD-MMM-YYYY");
  lines.push("  paidUpValue: number;");
  lines.push("  marketLot: number;");
  lines.push("  isin: string;");
  lines.push("  faceValue: number;");
  lines.push("}");
  lines.push("");
  lines.push("export const NSE_SCRIPS: NseScrip[] = [");
  for (const r of rows) {
    lines.push(
      `  { symbol: "${escapeValue(r.symbol)}", companyName: "${escapeValue(r.companyName)}", series: "${escapeValue(r.series)}", ` +
        `dateOfListing: "${escapeValue(r.dateOfListing)}", paidUpValue: ${r.paidUpValue}, marketLot: ${r.marketLot}, ` +
        `isin: "${escapeValue(r.isin)}", faceValue: ${r.faceValue} },`,
    );
  }
  lines.push("];");
  lines.push("");
  lines.push("// Derived collections — built once at module load (cold requires are ms).");
  lines.push("export const NSE_SYMBOL_SET: ReadonlySet<string> = new Set(NSE_SCRIPS.map((s) => s.symbol));");
  lines.push(
    "export const NSE_SCRIP_BY_SYMBOL: Readonly<Record<string, NseScrip>> = Object.freeze(\n  Object.fromEntries(NSE_SCRIPS.map((s) => [s.symbol, s])),\n);",
  );
  lines.push("");
  lines.push("/** O(1) membership — is this an NSE-listed Equity-series symbol? */");
  lines.push("export function isNseSymbol(symbol: string): boolean {");
  lines.push("  return NSE_SYMBOL_SET.has(symbol.toUpperCase().trim());");
  lines.push("}");
  lines.push("");
  lines.push("/** Metadata lookup by exact symbol (case-insensitive). */");
  lines.push("export function getNseScrip(symbol: string): NseScrip | undefined {");
  lines.push("  return NSE_SCRIP_BY_SYMBOL[symbol.toUpperCase().trim()];");
  lines.push("}");
  lines.push("");
  lines.push("/** Case-insensitive search — SYMBOL prefix (priority), then symbol/company substring. */");
  lines.push("export function searchNseSymbols(query: string, limit = 10): NseScrip[] {");
  lines.push("  const q = query.toUpperCase().trim();");
  lines.push("  if (!q) return [];");
  lines.push("  const exact: NseScrip[] = [];");
  lines.push("  const rest: NseScrip[] = [];");
  lines.push("  for (const s of NSE_SCRIPS) {");
  lines.push("    const sym = s.symbol.toUpperCase();");
  lines.push("    if (sym.startsWith(q)) exact.push(s);");
  lines.push("    else if (sym.includes(q) || s.companyName.toUpperCase().includes(q)) rest.push(s);");
  lines.push("    if (exact.length + rest.length >= limit * 4) break;");
  lines.push("  }");
  lines.push("  return [...exact, ...rest].slice(0, limit);");
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const t0 = Date.now();
  console.log(`[fetch-nse-scrips] fetching ${CSV_URL}`);
  const text = (await fetchCsv(CSV_URL)).replace(/^\uFEFF/, ""); // strip BOM
  const { rows, skipped } = parseCsv(text);
  console.log(
    `[fetch-nse-scrips] parsed ${rows.length} securities in ${Date.now() - t0}ms` +
      (skipped.length ? ` (skipped ${skipped.length}: ${skipped.slice(0, 5).join("; ")})` : ""),
  );
  if (rows.length < 2000) {
    throw new Error(`sanity check failed: expected ≥2000 securities, got ${rows.length} — aborting`);
  }
  console.log(`[fetch-nse-scrips] series: ${JSON.stringify(rows.reduce<Record<string, number>>((acc, r) => ((acc[r.series] = (acc[r.series] || 0) + 1), acc), {}))}`);
  const generatedAt = new Date().toISOString().slice(0, 10);
  const moduleText = buildModuleText(rows, generatedAt);
  if (!write) {
    console.log(`[fetch-nse-scrips] dry-run — module would be ${moduleText.length} bytes at ${OUT_PATH}`);
    console.log("[fetch-nse-scrips] pass --write to generate the module");
    return;
  }
  writeFileSync(OUT_PATH, moduleText, "utf8");
  console.log(`[fetch-nse-scrips] wrote ${moduleText.length} bytes -> ${OUT_PATH}`);
}

main().catch((err: unknown) => {
  console.error("[fetch-nse-scrips] FAILED:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});