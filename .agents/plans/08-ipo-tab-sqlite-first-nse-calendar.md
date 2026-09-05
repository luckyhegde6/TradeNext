# Implementation Plan — IPO Tab: SQLite-first NSE IPO Calendar (3-endpoint fetch) (v3.30.0)

> Generated from spec: `.agents/specs/08-ipo-tab-sqlite-first-nse-calendar.md`
> Save to `.agents/plans/08-ipo-tab-sqlite-first-nse-calendar.md`

## Spec Reference

- **Spec**: `.agents/specs/08-ipo-tab-sqlite-first-nse-calendar.md`
- **Branch**: `fix/v3.28.1-sqlite-self-heal` (same working branch; commit separately)
- **Created**: 2026-09-05

---

## Implementation Steps

> Ordered steps. Each step is atomic — can be verified independently.
> SQLite-only schema change → **no Prisma migration**. No new packages.

### Phase 1: SQLite mirror table

1. **`lib/sqlite.ts` SCHEMA_SQL** — NEW `nse_ipo_listing` table:
   `PRIMARY KEY (symbol, category)` + index on `category` (and on `fetched_at` for mirror freshness).
   → verify: `npx tsc --noEmit` (0 new)
2. **`SqliteFallback`** — `setIpoListings(category, rows)` (replace-per-category: txn `DELETE … WHERE category = ?`
   then INSERT batch, matching `replaceChartinkResults` style) + `getIpoListings(category)` (ordered by symbol);
   implement both in `createFallback`.
   → verify: `npx jest lib/__tests__/sqlite.test.ts` (+ipo roundtrip + replace-per-category + mirror-freshness tests)
3. **`restoreSqliteBackup()`** — add `nse_ipo_listing` to required-tables validation.

### Phase 2: Calendar service (NEW, server-only)

4. **NEW `lib/services/nseIpoCalendarService.ts`** — types (`IpoCalendarCategory`, `IpoCalendarSource`,
   `NseIpoListing`); three pure exported normalizers (never throw, coerce stringly numbers):
   - `parseSpecialPreOpenListing(raw)` → category `current`, status `"Active"`, `listingDate` = today IST ISO,
     `finalPrice` from `preopenBook.finalPrice` (fallback `fPrice`/`iep`), OHLC from `preopenBook`, raw preserved.
   - `parseForthListing(raw)` → category `upcoming`, status `"Forthcoming"`, `effectiveDate`, `shdAttachment`
     (prefix `https://www.nseindia.com/` when relative), `specialPreOpen`.
   - `parseRecentListing(raw)` → category `recent`, status `"Closed"`, `listingDate`, `instrument`, series.
   → verify: `npx jest lib/__tests__/nseIpoCalendarService.test.ts` (normalizers first)
5. **Read chain** `getNseIpoCalendar(forceRefresh = false)` — memory front (`ipo:calendar`,
   `IPO_CALENDAR_MEM_TTL_SECONDS = 15 * 60`) → SQLite mirror (all three categories present AND fresh within
   `IPO_MIRROR_FRESH_MS = 6 * 60 * 60` → merge, `source:"sqlite_mirror"`; stale-but-present returns sqlite for
   durability) → NSE live via `Promise.allSettled` over the 3 `nseFetch` calls, parse, `setIpoListings` per
   category, memory set, `source:"nse_live"` (partial success keeps successful categories; total failure →
   `{ list: [], changed: false }` + `logger.error`). **Zero Prisma imports in this module.**
   → verify: chain-order + never-Prisma + partial-success tests; `npx tsc --noEmit` (0 new)
6. **Compat + promote** — `mapCalendarToIpoIssues(list)` (status derived; `issueStartDate` = effectiveDate ??
   listingDate; `issueEndDate` = listingDate or effectiveDate for upcoming; issuePrice/issueSize/lotSize/priceBand
   null unless detail-filled — `/detail` chain unchanged); `promoteIpoCalendarToPrisma(db)` aggregates the mirror
   into ONE `market_cache` row (`cacheKey:"nse_ipo_calendar"`, `dataType:"ipo_calendar"`, `{current,upcoming,recent}`
   shape) with change detection via `stableStringify` — **export `stableStringify` from `syncedDataService.ts`**
   (no behavior change) — and `upsert` only on change (≤1 op).
   → verify: promote change-skip test (identical payload → 0 upserts; changed → 1)

### Phase 3: Promote wiring + service compat

7. **`lib/sqlite.ts` `promoteNseToPrisma()`** — summary gains `nse_ipo_listing: 0`; call `promoteIpoCalendarToPrisma`
   in the promote loop (leader + breaker + in-flight gated, same as other tables).
   → verify: `npx jest lib/__tests__/sqlite.test.ts` (promote summary + helper wiring)
8. **`lib/services/nseIpoService.ts`** — `getUpcomingIpoIssues(forceRefresh)` re-pointed at
   `getNseIpoCalendar` → `mapCalendarToIpoIssues`, preserving the `SyncedFetchResult<IpoIssue[]>`-compatible shape
   (source mapped to legacy `"api"|"cache"|"db"` values; `syncedAt`, `changed` preserved); legacy calendar
   `market_cache` read/write paths removed. `getIpoIssueDetail` + `parseIpoDetail` unchanged.
   → verify: `npx jest lib/__tests__/nseIpoService.test.ts` (existing suite adapted, +listed enrichment preserved)

### Phase 4: Routes

9. **`app/api/recommendations/ipos/route.ts`** — GET → `getNseIpoCalendar(refresh==="1")`; response
   `{ success, issues, sections: {current, upcoming, recent}, source, syncedAt, changed, timestamp, traceId }`;
   catch → `{ success:true, issues:[], warning:"Data temporarily unavailable", source:"fallback" }` (existing shape).
   → verify: `curl localhost:3000/api/recommendations/ipos` → 200 + new `sections`/`source`
10. **`app/api/recommendations/ipos/closed/route.ts`** — closed set = calendar `recent` filtered to
    `listingDate` within `days` (existing parse + `MAX_DAYS`/`MAX_QUOTES` + 1h cache + `getStockQuote` enrichment
    mechanics unchanged, new source).
    → verify: `curl "localhost:3000/api/recommendations/ipos/closed?days=30"` → 200

### Phase 5: UI

11. **`app/components/recommendations/IposTab.tsx`** — `sourceLabel()`: `"Live from NSE"` (nse_live) /
    `"SQLite mirror"` (sqlite_mirror) / `"Cached"` (memory_cache), legacy "db" branch dropped; Current →
    **"Listing Today"** section name (emerald "Open Now" pill mapping kept) + a **Listing Price** column for rows
    with `finalPrice`/`iep` (existing `formatPrice`); Forthcoming gains a "📄 Prospectus" link when
    `shdAttachment` present (target blank, NSE-hosted RHP); Recently Closed unchanged render, fed from `recent`.
    → verify: Playwright 375px + 1440px, 0 console errors, source labels render

### Phase 6: Tests + verification + docs

12. **NEW `lib/__tests__/nseIpoCalendarService.test.ts`** — normalizers (IEP finalPrice fallback, RHP prefix,
    stringly numbers, anomaly tolerance), chain order memory → sqlite → NSE, sqlite freshness window,
    partial-success NSE, total-failure empty, never-Prisma (no `@/lib/prisma` import), promote change-skip,
    `mapCalendarToIpoIssues` compat mapping.
13. **`lib/__tests__/sqlite.test.ts`** +3-4: ipo roundtrip, replace-per-category, mirror freshness,
    promote summary/promote-helper wiring.
14. Docs: AGENTS.md v3.30.0 row, `.agents/changelog/versions-v3.30.md` (new), `.agents/CHANGELOG.md` index,
    TODO.md row, Primer.md, agent-memory.md, Lessons, session memory.

---

## Test Strategy

### Unit Tests (Required)

| Test | File | What It Verifies |
|------|------|------------------|
| 3 normalizers | `nseIpoCalendarService.test.ts` | Endpoint shapes → `NseIpoListing`, tolerant parsing |
| Chain order + freshness | `nseIpoCalendarService.test.ts` | memory → sqlite → NSE; stale sqlite served |
| Partial/total NSE failure | `nseIpoCalendarService.test.ts` | Keeps success categories; empty fallback |
| Never-Prisma | `nseIpoCalendarService.test.ts` | No `@/lib/prisma` import on read path |
| Promote change-skip | `nseIpoCalendarService.test.ts` | `stableStringify` compare → 0 vs 1 upsert |
| SQLite roundtrip + fresh + promote | `sqlite.test.ts` | Mirror contract + summary wiring |

### E2E (Playwright, manual run)

| Scenario | What It Verifies |
|----------|------------------|
| IPO tab renders sections | Listing Today / Forthcoming / Recently Closed from calendar source |
| Source label | "Live from NSE" / "SQLite mirror" / "Cached" |
| Closed section | Recent category within `days`, price enrichment intact |

---

## Verification Checklist

```bash
# Type checking
npx tsc --noEmit                    # 46 = exact baseline (0 new)

# Tests
npx jest lib/__tests__/nseIpoCalendarService.test.ts lib/__tests__/sqlite.test.ts lib/__tests__/nseIpoService.test.ts
npm run test                        # full suite

# Prisma
npx prisma validate                 # Schema valid (unchanged — SQLite-only)
```

---

## Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| NSE 3-endpoint rate limits / anti-bot | Memory 15-min + SQLite 6h mirror; `Promise.allSettled` partial success; existing nseFetch cookie flow | No |
| Calendar rows lack issuePrice/size/lot | Rendered via existing per-symbol `/detail` chain for Active/Forthcoming | Per-symbol `/detail` SQLite tiering |
| Legacy callers/tests of `getUpcomingIpoIssues` | Compat wrapper maps source back to `api/cache/db` | No |
| `stableStringify` location | Export from `syncedDataService` (no new module) or move to shared pure module per spec | No |
| AI IPO analysis | Unusable this period (OpenRouter quota) — untouched | Yes |

---

## Documentation Checklist

- [ ] **AGENTS.md** — v3.30.0 version row
- [ ] **CHANGELOG** — `.agents/changelog/versions-v3.30.md` + index update
- [ ] **TODO.md** — quick-reference row
- [ ] **Primer.md** — current project status
- [ ] **agent-memory.md** — activity log entry
- [ ] **Lessons.md** — new lesson (if pattern/bug discovered)
- [ ] **Session memory** — `decisions.md` + `flow.md`
- [ ] **session-todos.md** — current session updated
- [ ] **handoffs/active/latest.md** — resume context

---

## Pre-Commit Gate

1. `npx tsc --noEmit` — 0 new errors
2. `npm run test` — all pass
3. `git status` — no junk artifacts, no secrets in diff
4. Documentation updated per checklist above
5. Engineering checklist (`.agents/rules/checklist.md`) validated