// scripts/ingest_nse_zip.ts
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import unzipper from "unzipper";
import { parse } from "csv-parse/sync";
import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL! || "postgresql://postgres:postgres@localhost:5432/tradenext";
if (!DATABASE_URL) {
    console.error("Please set DATABASE_URL in env");
    process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

function tryParseNumber(s: string | undefined) {
    if (!s) return null;
    // Remove commas, percent signs
    const clean = s.replace(/,/g, "").replace(/%/g, "").trim();
    if (clean === "" || clean === "-" || clean === "NA") return null;
    const v = Number(clean);
    return Number.isFinite(v) ? v : null;
}

function parseDateFromString(s: string | undefined) {
    if (!s) return null;
    // try common formats: DDMMYY, DDMMYYYY, YYYY-MM-DD or DD-MM-YYYY
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString();
    // some NSE files might be ddmmyy like 051225 -> 05-12-2025? Use heuristics if needed
    return null;
}

async function upsertDailyPrice(row: any) {
    // expects keys: SYMBOL, DATE, OPEN, HIGH, LOW, CLOSE, VOLUME, VWAP
    const ticker = (row.SYMBOL || row.Symbol || row.symbol || "").trim();
    const dateStr = row.DATE || row.Date || row.date || row["Index Date"] || row["TRADE DATE"];
    const tradeDate = parseDateFromString(dateStr) || (new Date()).toISOString();
    const open = tryParseNumber(row.OPEN || row.Open || row["Open Index Value"]);
    const high = tryParseNumber(row.HIGH || row.High || row["High Index Value"]);
    const low = tryParseNumber(row.LOW || row.Low || row["Low Index Value"]);
    const close = tryParseNumber(row.CLOSE || row.Close || row["Close Index Value"] || row["Close"]);
    const vwap = tryParseNumber(row.VWAP || row.VWAP || row.vwap);
    const volume = tryParseNumber(row.VOLUME || row.Volume) || null;

    if (!ticker) return false;

    const q = `
    INSERT INTO daily_prices (ticker, trade_date, open, high, low, close, volume, vwap)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (ticker, trade_date) DO UPDATE SET
      open = EXCLUDED.open,
      high = EXCLUDED.high,
      low = EXCLUDED.low,
      close = EXCLUDED.close,
      volume = EXCLUDED.volume,
      vwap = EXCLUDED.vwap;
  `;
    await pool.query(q, [ticker, tradeDate, open, high, low, close, volume, vwap]);
    return true;
}

async function upsertIndexClose(indexName: string, row: any) {
    const dateStr = row["Index Date"] || row["DATE"] || row.date || row.Date;
    const asOf = parseDateFromString(dateStr) || (new Date()).toISOString();
    const open = tryParseNumber(row["Open Index Value"] || row.OPEN || row.Open);
    const high = tryParseNumber(row["High Index Value"] || row.HIGH || row.High);
    const low = tryParseNumber(row["Low Index Value"] || row.LOW || row.Low);
    const close = tryParseNumber(row["Close Index Value"] || row.CLOSE || row.Close);
    const vwap = null;
    const volume = tryParseNumber(row["TOTTRDQTY"] || row["Volume"]) || null;

    const q = `
    INSERT INTO index_closes (id, index_name, as_of, open, high, low, close, vwap, volume)
    VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (index_name, as_of) DO UPDATE SET
      open = EXCLUDED.open,
      high = EXCLUDED.high,
      low = EXCLUDED.low,
      close = EXCLUDED.close,
      volume = EXCLUDED.volume;
  `;
    await pool.query(q, [indexName, asOf, open, high, low, close, vwap, volume]);
}

async function upsertIndexWeights(indexName: string, asOf: string | null, rows: any[]) {
    // rows with columns SYMBOL, SECURITY, WEIGHTAGE(%)
    for (const r of rows) {
        const ticker = (r.SYMBOL || r.Symbol || "").trim();
        const security = (r.SECURITY || r.Security || r.security || "").trim();
        const weight = tryParseNumber(r["WEIGHTAGE(%)"] || r["Weightage(%)"] || r.Weight) || null;
        const q = `
      INSERT INTO index_weights (id, index_name, ticker, security, weight, as_of)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
      ON CONFLICT (index_name, ticker, as_of) DO UPDATE SET
        security = EXCLUDED.security,
        weight = EXCLUDED.weight;
    `;
        await pool.query(q, [indexName, ticker, security, weight, asOf]);
    }
}

async function handleCsvFile(fileName: string, content: string) {
    // naive parse of CSV; csv-parse can be used for robust parsing
    const records = parse(content, { columns: true, skip_empty_lines: true }) as any[];
    console.log(`Parsed ${records.length} rows from ${fileName}`);

    if (/top10.*nifty/i.test(fileName)) {
        // top10 weights for nifty
        const asOfMatch = fileName.match(/\d{6}/);
        const asOf = asOfMatch ? `20${asOfMatch[0].slice(-2)}-${asOfMatch[0].slice(2, 4)}-${asOfMatch[0].slice(0, 2)}T00:00:00Z` : null;
        await upsertIndexWeights("Nifty50", asOf, records);
        return;
    }

    if (/ind_close_all/i.test(fileName) || /index_close/i.test(fileName)) {
        // might contain many index rows
        for (const r of records) {
            const row = r as any;
            // guess index name field
            const idxName = row["Index Name"] || row["INDEX"] || "NSE Index";
            await upsertIndexClose(idxName, row);
        }
        return;
    }

    // Fallback: attempt daily price upserts if SYMBOL column exists
    if (records.length && ("SYMBOL" in records[0] || "symbol" in records[0])) {
        for (const row of records) {
            await upsertDailyPrice(row);
        }
        return;
    }

    console.warn(`Unknown CSV format for file ${fileName} — skipping`);
}

async function ingestZip(zipPath: string = "../dailyUploads/zip") {
    console.log("Ingesting", zipPath);
    const z = fs.createReadStream(zipPath).pipe(unzipper.Parse({ forceStream: true }));
    for await (const entry of z) {
        const fileName = entry.path;
        if (entry.type === "File") {
            const content = await entry.buffer();
            const text = content.toString("utf8");
            try {
                await handleCsvFile(fileName, text);
            } catch (err) {
                console.error("Error handling file", fileName, err);
            }
        } else {
            entry.autodrain();
        }
    }
    console.log("Done ingesting. Closing pool.");
    await pool.end();
}

if (require.main === module) {
    const zipPath = process.argv[2] || "../dailyUploads/zip";
    if (!zipPath) {
        console.error("Usage: node ./scripts/ingest_nse_zip.ts path/to/file.zip");
        process.exit(2);
    }
    ingestZip(zipPath).catch((e) => {
        console.error("Ingest failed", e);
        process.exit(1);
    });
}
