# Chartink API Reference — Screener & Backtest (Wire Formats)

> Captured from live browser traffic on chartink.com (2026-08-11) using the
> **profit-jump-by-200** screener. These are the exact request/response shapes
> the Chartink web UI exchanges with its own backend. All formats below are
> verified against the captured payloads and unit-tested with real fixtures in
> `lib/__tests__/chartinkTemplateServices.test.ts`.

---

## 1. Endpoints

| Endpoint | Purpose | Body keys |
|----------|---------|-----------|
| `POST https://chartink.com/screener/process` | Run a scanner, get current matching stocks (DataTables) | `scan_clause`, `debug_clause`, `column_clause` |
| `POST https://chartink.com/backtest/process` | Run the same DSL as a backtest over `tradeTimes` buckets | `scan_clause`, `max_rows` |

Both require browser-like headers — Chartink rejects bare curl/undici defaults:

```http
Content-Type: application/json
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36
Referer: https://chartink.com/screener
Accept: application/json, text/plain, */*
```

> ⚠️ Chartink blocks scripted/datacenter traffic (verified 2026-08-11: direct
> fetch from this sandbox blackholes). This is exactly why the codebase keeps a
> TradingView fallback for the legacy screeners — the JSON-template services are
> unit-tested with captured fixtures, and live calls are expected to run from
> the Netlify/serverless environment (where the existing `chartinkService.ts`
> already succeeds).

---

## 2. Screener request — `/screener/process`

```json
{
  "scan_clause": "( {cash} ( yearly net profit/reported profit after tax > 1 year ago net profit/reported profit after tax * 2 and yearly count( 2, 1 where yearly net profit/reported profit after tax > 0 ) = 0 ) )",
  "debug_clause": "groupcount( 1 where yearly net profit/reported profit after tax > 1 year ago net profit/reported profit after tax * 2),groupcount( 1 where yearly count( 2, 1 where yearly net profit/reported profit after tax > 0 ) = 0)",
  "column_clause": "Daily Close as 'scan-column-default-close', Daily \"close - 1 candle ago close / 1 candle ago close * 100\" as 'scan-column-default-percent-change', filternumber( daily close > 1 day ago close,1) as 'default-percent-change-conditional-filters-color', Daily Volume as 'scan-column-default-volume'"
}
```

### Body keys

| Key | Meaning |
|-----|---------|
| `scan_clause` | The DSL filter expression — see §4 for DSL notes |
| `debug_clause` | `groupcount(...)` per-condition counts (optional, multiple comma-separated) |
| `column_clause` | Output columns, each `Expression as 'alias'` (optional — defaults exist) |

### The three magic column aliases

| Alias | Content |
|-------|---------|
| `scan-column-default-close` | Latest close (₹) |
| `scan-column-default-percent-change` | % change vs previous close |
| `default-percent-change-conditional-filters-color` | `1` = up, `2` = down (from `filternumber( daily close > 1 day ago close, 1)`) |

---

## 3. Screener response — `/screener/process`

DataTables-style envelope:

```json
{
  "draw": 1,
  "recordsTotal": 154,
  "recordsFiltered": 154,
  "data": [
    {
      "sr": 1,
      "nsecode": "TIJARIA",
      "name": "Tijaria Polypipes Ltd.",
      "bsecode": "538629",
      "scan-column-default-close": 14.506,
      "scan-column-default-percent-change": 15.913,
      "default-percent-change-conditional-filters-color": 1,
      "scan-column-default-volume": 904350
    }
  ],
  "link": "scanlink:2b8d4c5b0b06fa288b9bf08a3487f52b"
}
```

| Key | Meaning |
|-----|---------|
| `recordsTotal` / `recordsFiltered` | Total / after-filter row counts (here 154) |
| `data[]` | Row objects keyed by the `column_clause` aliases |
| `link` | `scanlink:<id>` fingerprint for the scan |

### Row fields

| Field | Meaning |
|-------|---------|
| `sr` | 1-based row number |
| `nsecode` | NSE symbol (use as the primary key; upper-case) |
| `name` | Company name |
| `bsecode` | BSE code |
| `scan-column-default-close` | Latest close ₹ |
| `scan-column-default-percent-change` | % change vs prev close (signed) |
| `default-percent-change-conditional-filters-color` | `1` up / `2` down |
| `scan-column-default-volume` | Volume (numeric in the JSON — the UI renders it as `904.35K`) |

---

## 4. Backtest request — `/backtest/process`

```json
{
  "scan_clause": "( {cash} ( yearly net profit/reported profit after tax > 1 year ago net profit/reported profit after tax * 2 and yearly count( 2, 1 where yearly net profit/reported profit after tax > 0 ) = 0 ) )",
  "max_rows": "160"
}
```

The same `scan_clause` as the screener, plus `max_rows` (the UI sends `"160"`
as a string). `debug_clause`/`column_clause` are NOT needed for backtest.

---

## 5. Backtest response — `/backtest/process`

```json
{
  "metaData": {
    "columnAliases": {
      "groupcount( 1 where yearly net profit/... * 2)": "some-alias"
    },
    "availableLimit": 26,
    "maxRows": 160,
    "isTrend": true,
    "limit": 100,
    "groups": ["AUTO", "BANK", "...", "REALTY"],
    "tradeTimes": [1752733800000, 1752820200000, "..."],
    "lastUpdateTime": 1754734026000
  },
  "aggregatedStockList": [
    [],
    [],
    [],
    [],
    [["TIJARIA", "S", "REALTY"], ["KALYANI", "L", "AUTO"]],
    "..."
  ],
  "groupData": [
    {
      "name": "AUTO",
      "results": [{ "groupcount( ... )": [0, 0, 0, 0, 1, 1, 1] }]
    }
  ],
  "time": 49,
  "baseTime": 33,
  "link": "scanlink:2b8d4c5b0b06fa288b9bf08a3487f52b"
}
```

| Key | Meaning |
|-----|---------|
| `metaData.groups` | Sector names; ordered, index-aligned with `groupData` |
| `metaData.tradeTimes` | Epoch-ms per backtest step; the **x-axis** (here 37 buckets over ~1yr) |
| `metaData.isTrend` | true when the scan evaluates a point-in-time expression over time |
| `aggregatedStockList` | **Index-aligned with `tradeTimes`**: per-bucket array of `[symbol, capClass, sector]` triplets. Empty bucket = no match at that step |
| `groupData[].results[].<expr>` | Per-sector count series, index-aligned with `tradeTimes` (e.g. REALTY: 0,0,0,0,1,1,1) |
| `link` | `scanlink:<id>` — same id as the screener's |

### Reading the buckets

- `aggregatedStockList[i]` = stocks that matched at `tradeTimes[i]`.
- `aggregatedStockList[last]` = the **current** set (latest backtest step).
- Sector/capClass tags come from Chartink's own classification
  (`capClass`: e.g. `S` small, `L` large, `M` mid).

---

## 6. DSL notes (`scan_clause` grammar, observed)

- `{cash}` — filter to the cash segment (`{cash} ...` wraps the body).
- `{fo}`, `{mcx}`, `{nifty500}` etc. — other segment modifiers.
- Expression blocks group with `( ... )` and combine with `and`/`or`.
- Period-relative syntax:
  - `yearly <metric>` — latest fiscal year value
  - `1 year ago <metric>` — prior fiscal year
  - `n where <cond>` inside `count( ... )` — conditional count over periods
- Comparison example:
  `yearly net profit/reported profit after tax > 1 year ago net profit/reported profit after tax * 2`
- `Daily "<expr>"` inside `column_clause` — intraday/current-candle math
  (e.g. `"close - 1 candle ago close / 1 candle ago close * 100"`).

---

## 7. Repo wiring (what consumes these formats)

| File | Role |
|------|------|
| `lib/services/chartinkScansTypes.ts` | Shared `ChartinkTemplate` / `ChartinkCategoryFile` types |
| `lib/services/chartink-scans/*.json` | **Config source of truth** — 9 category files × 13 scans = 117 entries. Add/edit clauses here (no code change for new entries; new category files need one import + one row in `chartinkTemplates.ts`) |
| `lib/services/chartinkTemplates.ts` | Loads the JSON files, assigns `categoryId`, exposes `getChartinkCategories()` (dropdowns/counts), `getChartinkTemplates(categoryId?)`, `getChartinkTemplate(id)`, `registerChartinkTemplate()` |
| `lib/services/chartinkScanService.ts` | `fetchChartinkScan(template)` / `runChartinkScanById(id)` — POSTs §2, parses §3 into `ChartinkScanStock[]`, caches 5 min |
| `lib/services/chartinkBacktestService.ts` | `fetchChartinkBacktest(template)` / `runChartinkBacktestById(id)` — POSTs §4, parses §5 into `ChartinkBacktestResult`, caches 10 min |
| `lib/services/chartinkScreenerService.ts` | **DB sync** (v3.5.5): definition upserts (`ChartinkScreener`), run lifecycle (`ChartinkScreenerRun`), captured tables (`ChartinkScreenerResult`, 72h TTL), full-run clean-and-re-insert, TTL prune, fresh/stale reads, `normalizeCapturedRows` |
| `lib/services/chartink-scans/*.json` ↔ `prisma` | DB definitions mirror the JSON configs — the JSON files remain the source of truth for clauses; `upsertChartinkScreener` mirrors each entry (url/categoryId/clauses/scanlinkId/backtestUrl) |
| `scripts/chartink-capture/capture.ts` | **Playwright capture tool** (v3.5.5): visits scanner pages, captures the exact `/screener/process` request body (clauses) + response (table rows + scanlink) via network interception, falls back to "Copy group to clipboard"/"Copy table" clicks; writes clauses back to the JSON configs and feeds captured tables to the DB via `runFullChartinkSync` |
| `scripts/chartink-capture/capture-core.ts` | Pure helpers (unit-tested): `parseClipboardTable` (Copy-table TSV → wire aliases), `mergeCapturedClause` (first-value-wins JSON write-back), `parseArgs`/`listValue` |
| `lib/__tests__/chartinkTemplateServices.test.ts` | 19 tests incl. real rounded fixtures for both endpoints + catalog-only guard |
| `lib/__tests__/chartinkScreenerService.test.ts` | 26 tests: normalize, upserts, run lifecycle, chunked insert + TTL expiry, clean/prune, full-run clean-and-re-insert, failure path, stale/fresh reads |
| `scripts/chartink-capture/__tests__/capture-core.test.ts` | 9 tests: clipboard TSV parse, clause merge, CLI args |

### Adding a scan clause later

The JSON entries without `scanClause` are **catalog-only** today (usable for
dropdowns/selection, `fetchableCount` = 0). When a clause is provided, just add
`scanClause` (+ optional `debugClause`/`columnClause`/`backtestMaxRows`) to the
entry — the registry and both fetch services pick it up automatically.
`fetchChartinkScan`/`fetchChartinkBacktest` throw early for catalog-only
templates rather than sending an empty body to Chartink.

**To fill the 116 catalog-only entries:** run the capture tool (needs a
network where a real browser works — chartink.com blocks this sandbox):
`npx tsx scripts/chartink-capture/capture.ts` (all 117; or
`--category <id>` / `--id <id>` to narrow). It writes captured clauses into
the JSON configs (`first-value-wins` — curated clauses are never stomped) and
feeds the captured tables to the DB. `--dry-run` validates without writing;
`--no-db` skips the DB; `--headful` shows the browser.

### Capture tool — DB sync semantics (v3.5.5)

- **Full run** = one `ChartinkScreenerRun` row; the run **deletes ALL
  `ChartinkScreenerResult` rows, then re-inserts the whole captured dataset**
  under the new run id (`runFullChartinkSync`). Old rows are gone (cascade),
  run history is kept.
- **TTL = 72 hours** (default; `--ttl` on the tool, `ttlHours` on the run):
  each row gets `expiresAt = capturedAt + ttlHours`. Reads surface only fresh
  rows (`expiresAt > now`) unless `includeStale`; `pruneExpiredChartinkResults`
  drops expired rows at any time. The next full run's clean step supersedes
  the TTL.
- `getChartinkScreeners()` reports `stale` per definition (never run, or
  `nextRunAt <= now`) — the UI can show "needs refresh" badges and trigger a
  capture.

### Cap / cache notes

- Scan cache TTL 300 s, backtest TTL 600 s (`staticCache`, in-memory).
- Backtest `max_rows` defaults to `"160"` (string) — the UI's value.
- Do not call these endpoints from the browser — server-side only (same rule
  as `chartinkService.ts` / `nse-integration` skill).