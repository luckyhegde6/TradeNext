# Spec Document — IPO Tab: SQLite-first NSE IPO Calendar (3-endpoint fetch) (v3.30.0)

> Generated from the user directive (2026-09-05): "based on this fix the ipo tab for the cleaner fetch and
> populate from NSE api data to cache, sqlite and then sync to db during normal 6hr sync and always if sqlite is
> empty and its nse dependant data fetch from nse instead of the db to reduce db prisma calls".
> Save to `.agents/specs/08-ipo-tab-sqlite-first-nse-calendar.md`; plan in `.agents/plans/08-ipo-tab-sqlite-first-nse-calendar.md`.

## 1. Overview

**What**: Rework the IPO tab's data source from the single legacy `all-upcoming-issues` endpoint (currently
served through `getOrFetchSyncedData`: memory → NSE → Prisma `market_cache` with change-detected upserts — 2+ Prisma
reads per TTL-exhausted fetch, plus DB fallback reads) to a **SQLite-first NSE IPO calendar** fed by the three
lifecycle-accurate NSE endpoints the user provided:

1. `https://www.nseindia.com/api/special-preopen-listing` — **IPOs listing today** (special pre-open book: IEP,
   final price/quantity, open/high/low/close, buy/sell order book; e.g. ESDS, PRIORITY).
2. `https://www.nseindia.com/api/new-listing-today?index=ForthListing` — **upcoming listings** (companyName,
   `effectiveDate` "07-SEP-26", isin, series, `shdAttachment` RHP PDF, `specialPreOpen:"Y"`; e.g. ASHUTOSH,
   PERNIASPOP, SHANTIINOR).
3. `https://www.nseindia.com/api/new-listing-today?index=RecentListing` — **recent listings (~3 weeks)**
   (instrument Equity/SME, isin, `listing_date` "04-Sep-2026", name, series EQ/BE/N0/ST; e.g. LUMINO, SUMAX,
   AUGMONT, SHIPROCKET).

New data flow per the directive: **NSE fetch → memory cache → SQLite mirror (authoritative local store) → Promote
to Prisma during the normal sync cycle** (the existing v3.28.0 SQLite→Prisma promote machinery: leader + breaker
gated ~60s promote timer + end-of-task flush, which the 6h control reconcile complements). **Read chain: memory →
SQLite mirror → NSE live — NEVER Prisma** for NSE-dependent IPO calendar data (Prisma `market_cache` is only a
disaster-recovery copy written on content-change during promotion, ≤1 op per change).

**Why**: (1) The legacy chain reads/writes Prisma on the IPO hot path (up to 2 `marketCache.findUnique` reads +
a change-detected upsert on every 24h-TTL-exhausted fetch, replicated across instances) — violates the
"reduce db prisma calls" plan-limit discipline. (2) `all-upcoming-issues` gives no listing-day prices, no RHP
links, and an opaque recent/closed window; the three endpoints give accurate lifecycle data (IEP/pre-open book,
effective date, ~3-week recent window). (3) Matches the v3.28.0 "SQLite-first NSE store" pattern already used for
symbols, daily prices, corporate actions, and Chartink results.

**Scope**:
- **IN**: SQLite mirror table `nse_ipo_listing` (+ SqliteFallback `setIpoListings`/`getIpoListings`, schema +
  indexes, restore-list inclusion); NEW `lib/services/nseIpoCalendarService.ts` (3 pure normalizers + the
  memory→SQLite→NSE read chain + calendar→`IpoIssue[]` compat mapper + `promoteIpoCalendarToPrisma`); `promoteNseToPrisma`
  extension (`nse_ipo_listing` summary key → `market_cache` content-change upsert, dataType `ipo_calendar`);
  `nseIpoService.getUpcomingIpoIssues` re-pointed at the calendar (compat wrapper); routes `app/api/recommendations/ipos`
  + `ipos/closed` switched to the calendar (zero Prisma on the hot/tab path); IposTab ("Listing Today" section
  name + listing-day price columns, RHP link on Forthcoming, closed section from recent category, source labels);
  unit + sqlite tests; docs.
- **OUT (deferred)**: per-symbol `ipo-detail` (`[symbol]/detail` route + `getIpoIssueDetail`) stays on its existing
  24h chain (separate NSE endpoint; only fetched for rendered rows) — can be SQLite-cached in a later increment;
  listing-day gain vs issue price for the Recent section when issue price isn't derivable (keeps current null
  behavior); AI IPO analysis (unusable this period — OpenRouter quota, Issue-3); any Prisma schema change.

**Depends on**: v3.28.0 SQLite-first NSE store (schema + `promoteNseToPrisma` + `flushNseToPrisma` + 6h sync
cadence, v3.26.0) and v3.24.0 leader election + breaker gating. No migration, no new Prisma model.

---

## 2. Routes

> No new routes. Two modified routes.

### Modified Routes

| Method | Path | Change |
|--------|------|--------|
| GET | `/api/recommendations/ipos` | Source switches from `getUpcomingIpoIssues()` (NSE + `market_cache`) to `getNseIpoCalendar()` (memory → SQLite → NSE, zero Prisma). `issues` = flattened calendar mapped back to `IpoIssue[]` (statuses derived per category); response gains `sections: { current, upcoming, recent }` counts and `source` values `"memory_cache" \| "sqlite_mirror" \| "nse_live"` (legacy `"cache" \| "api" \| "db"` retired on this route). `refresh=1` → force NSE. |
| GET | `/api/recommendations/ipos/closed` | Closed set source switches from `getUpcomingIpoIssues()` (status `"Closed"` + `issueEndDate` window) to calendar category `recent` (listing_date ≤ 30d). Same live-quote enrichment + 1h memory cache. `source` field same new values. |

---

## 3. Database Schema

**No Prisma schema change → no migration.** The SQLite mirror gains one table (injected into `SCHEMA_SQL` in
`lib/sqlite.ts` — sql.js DBs are rebuilt at boot, so `CREATE TABLE IF NOT EXISTS` in the schema string is the
whole story; `ensureNseColumns`-style ALTER is NOT needed for a new table). `restoreSqliteBackup()`'s
required-tables check must include it (implementation detail, plan step).

```sql
-- ── v3.30.0 IPO calendar mirror (user directive: 3 NSE endpoints →
--    cache → SQLite → 6h-sync Prisma promote). SQLite is the PRIMARY
--    read store for the IPO tab; Prisma market_cache (dataType
--    "ipo_calendar") is only a disaster-recovery copy written on
--    content-change during promotion. Never read Prisma for this data. ──
CREATE TABLE IF NOT EXISTS nse_ipo_listing (
  symbol          TEXT NOT NULL,
  category        TEXT NOT NULL,   -- 'current' | 'upcoming' | 'recent'
  company_name    TEXT,
  series          TEXT,            -- EQ | BE | SME | ST | N0
  isin            TEXT,
  instrument      TEXT,            -- Equity | SME (recent)
  status          TEXT,            -- derived: Active | Forthcoming | Closed (tab compat)
  effective_date  TEXT,            -- "07-SEP-26" (upcoming)
  listing_date    TEXT,            -- "04-Sep-2026" (recent) / today ISO (current)
  iep             REAL,            -- indicative opening price (current)
  final_price     REAL,            -- pre-open final price (current)
  final_quantity  REAL,
  open_price      REAL,
  high_price      REAL,
  low_price       REAL,
  close_price     REAL,
  shd_attachment  TEXT,            -- SHP_*.pdf (upcoming RHP link)
  special_preopen TEXT,            -- "Y"
  raw             TEXT,            -- JSON of the NSE payload row (debug/re-provision)
  fetched_at      TEXT,            -- ISO (mirror freshness)
  PRIMARY KEY (symbol, category)
);
CREATE INDEX IF NOT EXISTS idx_ipo_listing_category ON nse_ipo_listing (category);
CREATE INDEX IF NOT EXISTS idx_ipo_listing_fetched ON nse_ipo_listing (fetched_at);
```

---

## 4. Functions to Implement

### A. `lib/sqlite.ts` (modified)

- SCHEMA_SQL: add `nse_ipo_listing` + 2 indexes (above).
- `SqliteFallback` interface — add, mirroring `replaceChartinkResults`/`getChartinkResults`:
  - `setIpoListings(category: string, rows: Array<Record<string, unknown>>): void` — transactionally
    `DELETE FROM nse_ipo_listing WHERE category = ?` then `INSERT` the batch (replace-per-category).
  - `getIpoListings(category: string): Array<Record<string, unknown>>` — rows ordered by symbol.
- `createFallback` — implement both (single `db.run` in a transaction via sql.js `db.run("BEGIN")/COMMIT` or
  plain sequential runs — match existing style).
- `restoreSqliteBackup()` — include `nse_ipo_listing` in the required-tables validation.
- `promoteNseToPrisma()` — summary gains `nse_ipo_listing: 0`; call NEW `promoteIpoCalendarToPrisma()` (below) in
  the promote loop (leader + breaker + in-flight gated, same as the other tables).

### B. `lib/services/nseIpoCalendarService.ts` (NEW — server-only, zero Prisma imports on the read path)

Types:

```typescript
export type IpoCalendarCategory = "current" | "upcoming" | "recent";
export type IpoCalendarSource = "memory_cache" | "sqlite_mirror" | "nse_live";

export interface NseIpoListing {
  symbol: string;
  companyName: string;
  series: string | null;
  isin: string | null;
  instrument: string | null;
  category: IpoCalendarCategory;
  status: "Active" | "Forthcoming" | "Closed";   // derived tab-compat status
  effectiveDate: string | null;                  // upcoming
  listingDate: string | null;                    // recent / current
  iep: number | null;                            // current (special pre-open)
  finalPrice: number | null;
  finalQuantity: number | null;
  openPrice: number | null;
  highPrice: number | null;
  lowPrice: number | null;
  closePrice: number | null;
  shdAttachment: string | null;                  // upcoming (RHP PDF)
  specialPreOpen: string | null;
  raw: unknown;
  fetchedAt: string;                             // ISO
}
```

Pure normalizers (exported, unit-testable, never throw — coerce stringly numbers, tolerate anomalies):

- `parseSpecialPreOpenListing(raw: unknown): NseIpoListing[]` → category `current`, status `"Active"`,
  `listingDate` = today IST ISO, `finalPrice` from `preopenBook.finalPrice` (fallback `fPrice`/`iep`),
  open/high/low/close from `preopenBook`, flag + raw preserved.
- `parseForthListing(raw: unknown): NseIpoListing[]` → category `upcoming`, status `"Forthcoming"`,
  `effectiveDate` passthrough, `shdAttachment` (prefix `https://www.nseindia.com/` when relative),
  `specialPreOpen`.
- `parseRecentListing(raw: unknown): NseIpoListing[]` → category `recent`, status `"Closed"`,
  `listingDate` passthrough, `instrument`, series.

Read chain (the headline function):

- `getNseIpoCalendar(forceRefresh = false): Promise<{ list: NseIpoListing[]; source: IpoCalendarSource; syncedAt: string | null; changed: boolean }>`
  1. Memory front (`ipo:calendar`, TTL `IPO_CALENDAR_MEM_TTL_SECONDS = 15 * 60`) — 0 ops on hit.
  2. SQLite mirror: `getIpoListings("current"|"upcoming"|"recent")`; if all three present AND fresh
     (`fetched_at` within `IPO_MIRROR_FRESH_MS = 6 * 60 * 60`), merge → return `source:"sqlite_mirror"`.
     (SQLite mirrors the requested "if sqlite is empty … fetch from nse" rule — present-but-stale still
     returns sqlite for durability; forceRefresh skips 1-2.)
  3. NSE live: `Promise.allSettled` over the 3 `nseFetch` calls → parse → `setIpoListings` per category →
     memory set → return `source:"nse_live"`. Partial success keeps successful categories. Total failure →
     return `{ list: [], changed: false }` + `logger.error` (route degrades to "Data temporarily unavailable").
  - **Zero Prisma calls anywhere on this path** (no import of `@/lib/prisma` in the module).
- `mapCalendarToIpoIssues(list: NseIpoListing[]): IpoIssue[]` — compat mapper for `IpoIssue`:
  `status` = derived; `issueStartDate` = effectiveDate ?? listingDate; `issueEndDate` = listingDate
  (or effectiveDate for upcoming); `issuePrice`/`issueSize`/`lotSize`/`priceBand` = `null` unless detail-filled
  (current/upcoming render these via the existing per-symbol `/detail` chain — unchanged).
- `promoteIpoCalendarToPrisma(db): Promise<number>` — aggregate the mirror into ONE `market_cache` row
  (`cacheKey:"nse_ipo_calendar"`, `dataType:"ipo_calendar"`, `data:{ current, upcoming, recent }[]` shape);
  COMPARE via `stableStringify` (reuse the exported helper — move `stableStringify` from `syncedDataService` to
  a shared pure module or export it) and `upsert` ONLY when changed (≤1 op per change, ~daily in practice).
  Wired into `promoteNseToPrisma` (`nse_ipo_listing` summary key).

### C. `lib/services/nseIpoService.ts` (modified — compat)

- `getUpcomingIpoIssues(forceRefresh)`: re-point to `getNseIpoCalendar` → `mapCalendarToIpoIssues`, returning the
  same `SyncedFetchResult<IpoIssue[]>`-compatible shape (source mapped to the legacy `"api"|"cache"|"db"` values
  for any remaining callers/tests; field `syncedAt`, `changed` preserved). All legacy `market_cache` read/write
  paths for the calendar are removed from this file.
- `getIpoIssueDetail` + `parseIpoDetail` + `IpoIssueDetail` — **unchanged** (separate endpoint, deferred tiering).

### D. Routes (modified)

- `app/api/recommendations/ipos/route.ts`: GET → `getNseIpoCalendar(force: searchParams refresh==="1")`; response
  `{ success, issues, sections: {current, upcoming, recent}, source, syncedAt, changed, timestamp, traceId }`; catch
  → existing `{ success:true, issues:[], warning:"Data temporarily unavailable", source:"fallback" }`.
- `app/api/recommendations/ipos/closed/route.ts`: closed set = calendar `recent` filtered to
  `listingDate` within `days` (same parse + MAX_DAYS/MAX_QUOTES + 1h cache + `getStockQuote` enrichment —
  unchanged mechanics, new source).

### E. UI (modified — `app/components/recommendations/IposTab.tsx`)

- Source label: `"Live from NSE"` (nse_live) / `"SQLite mirror"` (sqlite_mirror) / `"Cached"` (memory_cache) —
  update `sourceLabel()` (legacy "db" branch dropped).
- Current section (status `Active` / category `current`): rendered as **"Listing Today"** (keep emerald
  "Open Now" pill mapping: listing-day = Active); add a **Listing Price** column for rows carrying
  `finalPrice`/`iep` (formatted ₹, existing `formatPrice`).
- Forthcoming: when `shdAttachment` present, show a small "📄 Prospectus" link (target blank, NSE-hosted RHP).
- Recently Closed: unchanged table render; rows now flow from the calendar's `recent` category.
- No other layout/AI-modal changes (deferred).

---

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/sqlite.ts` | Modified | SCHEMA_SQL `nse_ipo_listing` + indexes; `SqliteFallback.setIpoListings/getIpoListings`; `createFallback` impls; restore required-tables; `promoteNseToPrisma` summary key + `promoteIpoCalendarToPrisma` wiring |
| `lib/services/nseIpoCalendarService.ts` | **Created** | Types + 3 normalizers + `getNseIpoCalendar` + `mapCalendarToIpoIssues` + `promoteIpoCalendarToPrisma` |
| `lib/services/nseIpoService.ts` | Modified | `getUpcomingIpoIssues` → calendar compat wrapper (legacy market_cache read/write removed); `getIpoIssueDetail` unchanged |
| `lib/services/syncedDataService.ts` | Modified | Export `stableStringify` (shared by the promote compare) — no behavior change |
| `app/api/recommendations/ipos/route.ts` | Modified | Calendar source + `sections` counts + new `source` values |
| `app/api/recommendations/ipos/closed/route.ts` | Modified | Closed set from calendar `recent` category |
| `app/components/recommendations/IposTab.tsx` | Modified | Source labels, Listing Today section + price column, RHP link, closed-source plumbing |
| `lib/__tests__/nseIpoCalendarService.test.ts` | **Created** | Normalizers + chain-order + never-Prisma + promote change-skip tests |
| `lib/__tests__/sqlite.test.ts` | Modified | +3-4 tests: ipo roundtrip, replace-per-category, mirror freshness, promote summary/promote-helper wiring |
| `lib/__tests__/nseIpoService.test.ts` | Modified | Existing assertions re-pointed at the calendar-backed wrapper (if this file exists — verify at implementation) |

---

## 6. Dependencies

### New Packages

| Package | Version | Reason |
|---------|---------|--------|
| None | — | — |

### Internal Dependencies

| Module | Function Used | Purpose |
|--------|---------------|---------|
| `@/lib/nse-client` | `nseFetch` | Server-side proxy for the 3 NSE endpoints (cookie + rate-limit) |
| `@/lib/cache` | `cache.get/set` | Memory front layer (`ipo:calendar`, 15m) |
| `@/lib/sqlite` | `getSqliteFallback`, `setIpoListings`, `getIpoListings`, `promoteNseToPrisma` | Mirror tier + promotion |
| `@/lib/services/leader` | `isLeader("sqlite-sync")` | Promote gating (existing) |
| `@/lib/db-utils` | `isPlanLimitBreakerOpen()` | Promote gating (existing) |
| `@/lib/services/syncedDataService` | `stableStringify` (newly exported) | Promote change-skip compare |
| `@/lib/prisma` | `prisma.marketCache.*` | ONLY inside `promoteIpoCalendarToPrisma` (content-change upsert, ≤1 op/change) |
| `@/lib/stock-service` | `getStockQuote` (dynamic import) | Closed-section price enrichment (existing) |
| `@/lib/logger` | `logger.info/warn/error` | Structured logging |

---

## 7. API Contract

### GET /api/recommendations/ipos (200)

```json
{
  "success": true,
  "issues": [
    {
      "companyName": "ESDS Software Solution Ltd",
      "symbol": "ESDS",
      "series": "EQ",
      "status": "Active",
      "issueStartDate": "05-Sep-2026",
      "issueEndDate": "05-Sep-2026",
      "issuePrice": null,
      "issueSize": null
    }
  ],
  "sections": { "current": 2, "upcoming": 3, "recent": 47 },
  "source": "sqlite_mirror",
  "syncedAt": "2026-09-05T07:00:00.000Z",
  "changed": false,
  "timestamp": "2026-09-05T09:00:00.000Z",
  "traceId": "…"
}
```

### GET /api/recommendations/ipos (NSE down + empty mirror)

Same 200 with `issues: []`, `sections` zeros, `warning: "Data temporarily unavailable"`, `source: "fallback"`.

### GET /api/recommendations/ipos/closed?days=30 (200)

Unchanged `{ success, issues: ClosedIpoIssue[], source: "sqlite_mirror"|"nse_live", count, days, timestamp, traceId }`
(issue shape identical to today; currentPrice/gainPercent enrichment unchanged).

---

## 8. UI/UX Requirements

### Components (modified — `IposTab.tsx`)

| Target | Purpose |
|--------|---------|
| `sourceLabel()` | `nse_live → "Live from NSE"`; `sqlite_mirror → "SQLite mirror"`; `memory_cache → "Cached"` |
| Current section | "Listing Today" subtitle; optional Listing Price column (from `finalPrice`/`iep`) |
| Forthcoming rows | 📄 Prospectus link when `shdAttachment` present (NSE-hosted, target blank) |
| Recently Closed | Fed from calendar `recent` category (same table) |

### States

- **Loading**: existing skeleton (unchanged); **Empty**: "No IPO issues at the moment." (unchanged);
  **Error**: existing retry banner; **Data**: table + section dividers (unchanged); fallback warning unchanged.

### Responsive

- Desktop (1440px) / tablet (768px) / mobile (375px): current overflow-x table style preserved; new columns
  settle into the existing horizontal-scroll pattern; no new breakpoint work.

---

## 9. Rules & Guardrails

- [ ] No Prisma on the IPO calendar READ path — the read chain is memory → SQLite → NSE, never Prisma
- [ ] Prisma writes for this data occur ONLY via the promote machinery (`promoteNseToPrisma`, leader + breaker
      gated, content-change-skipped) — never inline in routes/services
- [ ] No Prisma in client components; no schema change → no migration
- [ ] Server-side proxy only for NSE — never call from the client; `nseFetch` for all 3 endpoints
- [ ] `Promise.allSettled` over the 3 NSE calls — one endpoint failing never blocks the others
- [ ] Errors return safe defaults (empty + warning), never throw internals
- [ ] Logging via `@/lib/logger` only
- [ ] Normalizers are pure + tolerant (stringly numbers coerced, anomalies skipped) — never throw
- [ ] Surgical changes only — per-symbol `ipo-detail` tiering + AI modal work are deferred
- [ ] `runtime = "nodejs"` kept on the routes

---

## 10. Expected Behavior

1. `getNseIpoCalendar()` with warm memory → `source:"memory_cache"`, zero SQLite/NSE/Prisma ops.
2. Cold memory, fresh SQLite mirror → `source:"sqlite_mirror"`, zero NSE/Prisma ops.
3. Cold memory + empty/stale SQLite → 3 parallel NSE fetches → mirror + memory populated →
   `source:"nse_live"`; failure of one endpoint keeps the others (partial categories).
4. All 3 NSE calls failing + empty mirror → `list: []`, `logger.error`, route returns the warning shape.
5. `parseSpecialPreOpenListing` maps ESDS/PRIORITY payloads with `finalPrice`/`iep` + pre-open OHLC;
   `parseForthListing` maps ASHUTOSH/PERNIASPOP/SHANTIINOR with `effectiveDate` + `shdAttachment`;
   `parseRecentListing` maps LUMINO/SUMAX/AUGMONT/SHIPROCKET with `listingDate`.
6. `mapCalendarToIpoIssues` yields tab-compatible `IpoIssue[]` (statuses Active/Forthcoming/Closed).
7. `promoteIpoCalendarToPrisma` writes `market_cache` key `nse_ipo_calendar` ONLY on content change
   (stableStringify compare); unchanged payload → 0 Prisma writes.
8. `/api/recommendations/ipos` returns `sections` counts + new source values; closed route lists recent-listed.
9. IposTab renders Listing Today price + RHP link; 375px no overflow; 0 console errors.

---

## 11. Error Handling

| Scenario | Behavior | Log Level |
|----------|----------|-----------|
| NSE fetch fails (all 3) with empty mirror | `getNseIpoCalendar` returns `[]`; route → 200 warning shape | `error` |
| NSE fetch partial failure | Successful categories persisted; failed category keeps prior mirror rows | `warn` |
| SQLite unavailable (`getSqliteFallback()` null) | Chain skips mirror tier → NSE live (or empty on NSE fail) | `warn` |
| Malformed NSE payload row | Normalizer skips the row (never throws) | `warn` (per-row) |
| Promote blocked (breaker open / not leader) | Skip, summary key stays 0 — existing `promoteNseToPrisma` behavior | `warn` (existing) |
| Route-level catch | Safe `{success:true, issues:[], warning}` shape | `error` |

---

## 12. Test Strategy

### Unit Tests — `lib/__tests__/nseIpoCalendarService.test.ts` (NEW)

- [ ] `parseSpecialPreOpenListing` on the real ESDS/PRIORITY payload shape → category/status/finalPrice/iep/OHLC mapped (fixtures inline);
- [ ] `parseForthListing` on ASHUTOSH/PERNIASPOP/SHANTIINOR shape → effectiveDate + relative→absolute `shdAttachment` + `specialPreOpen`;
- [ ] `parseRecentListing` on LUMINO/SUMAX/AUGMONT/SHIPROCKET shape → listing_date + instrument + series;
- [ ] stringly-number coercion + anomaly skip (bad row dropped);
- [ ] `getNseIpoCalendar` chain order: memory hit → sqlite hit → NSE hit (mock `cache`, `sqlite`, `nseFetch`); each tier asserted;
- [ ] sqlite-empty (or stale) + NSE success → mirror written + `source:"nse_live"`;
- [ ] NSE total failure + empty mirror → `[]` + no throw;
- [ ] **never-Prisma**: module has no `@/lib/prisma` import (mock-factory spy asserts zero Prisma references in calendar read path);
- [ ] `mapCalendarToIpoIssues` status/date mapping;
- [ ] `promoteIpoCalendarToPrisma`: changed payload → exactly 1 `marketCache.upsert`; unchanged → 0 calls.

### Unit Tests — `lib/__tests__/sqlite.test.ts` (modified, +3-4)

- [ ] `setIpoListings`/`getIpoListings` roundtrip + replace-per-category (same category re-set removes old rows);
- [ ] mirror freshness: `fetched_at` window respected by the calendar chain (or helper-level assertion);
- [ ] `promoteNseToPrisma` summary includes `nse_ipo_listing` key and calls the calendar promote (mock).

### Integration/E2E

- [ ] Routes verified live via Playwright/browser at :3000 (IPO tab renders, refresh works, closed section expands, 0 console errors, 375px clean) — no new committed e2e this increment (NSE-data-dependent assertions are banned by repo policy).

---

## 13. Performance Considerations

- Read path: 0 Prisma ops (memory → SQLite → NSE). SQLite mirror reads are in-process sql.js ~µs.
- NSE: 3 parallel fetches, amortized by 15-min memory TTL + 6h mirror freshness; one endpoint failure doesn't
  starve the others.
- Promote: 1 `marketCache` upsert only on content change (≈ daily), inside the existing leader+breaker-gated timer
  → negligible op-count impact vs today's per-fetch 2 reads + change-upsert × instances.
- Closed route quote enrichment unchanged (dynamic `getStockQuote`, MAX_QUOTES=50, 1h memory cache).

---

## 14. Security Considerations

- No auth changes; routes stay public-read with safe shapes.
- NSE proxied server-side via `nseFetch` (cookie + rate-limit) — clients never touch NSE directly.
- `shdAttachment` rendered only as an `href` to the NSE domain (protocol-relative prefix patched to https) —
  no client-side URL parsing/JS execution.
- No secrets, no new env vars, no injection surface (NSE payloads validated by pure normalizers).

---

## 15. Definition of Done

- [ ] `nse_ipo_listing` table + `SqliteFallback.setIpoListings/getIpoListings` implemented + restore-list updated
- [ ] `nseIpoCalendarService` normalizers + read chain + compat mapper implemented (`getNseIpoCalendar` never imports Prisma)
- [ ] `getUpcomingIpoIssues` re-pointed at the calendar (legacy calendar market_cache reads/writes removed)
- [ ] `promoteNseToPrisma` promotes the IPO calendar to `market_cache` (`nse_ipo_calendar`, content-change upsert) — leader + breaker gated, wired to the 6h sync cycle
- [ ] `/api/recommendations/ipos` + `ipos/closed` serve from the calendar (zero Prisma on the tab path); `sections` + new `source` values present
- [ ] IposTab renders source labels, Listing Today price, RHP link; closed from recent; 375px + 1440px clean
- [ ] Unit + sqlite tests written and passing (`npm run test`); `npx tsc --noEmit` = 46 exact baseline (0 new)
- [ ] `npm run lint` passes
- [ ] Live-verified on :3000 (IPO tab + refresh + closed expand + 0 console errors)
- [ ] No Prisma schema change → no migration
- [ ] Documentation updated (AGENTS.md version row, CHANGELOG detail, TODO row, Primer, agent-memory, Lessons if new pattern, session memory `decisions.md`+`flow.md`, session-todos, handoff latest)
- [ ] Deferred items listed (per-symbol detail tiering, closed gain-from-detail, AI modal) 
- [ ] No commit/push/merge without explicit user approval