# Session 2026-08-12-8f2a11d — Decision Log

> v3.6.4 IPO feature set. Format: **Decision** → *Context* → *Why this approach* → *Impact (files touched)*

---

## D1. Issue Size = lot size + shares per lot (via per-symbol IPO detail)

**Decision:** Base the user-facing "Issue Size" on the per-symbol NSE `/api/ipo-detail` payload (Bid Lot → shares per lot + ₹ per lot) rather than the raw list-payload share-count string.

- *Context:* The `all-upcoming-issues` list only carries `lotSize` for SME; mainboard rows show a raw share count like `"94436030"`. The detail endpoint returns "Bid Lot: 154 Equity Shares", "Price Range", verbose "Issue Size" text. Live-probed (SHIPROCKET).
- *Why this approach:* The requirement targets "lot size + shares per lot". The detail is authoritative and per-symbol; the shared synced-data chain memory→API→DB with 24h TTL makes repeated per-row fetches cheap.
- *Impact:* `lib/services/nseIpoService.ts` (`IpoIssueDetail`, `parseSharesPerLot` existed; added `parsePriceBandLow`, `perLotInvestment`, `formatIssueSize` + structural `IssueSizeInput`); new route `app/api/recommendations/ipos/[symbol]/detail/route.ts`; landing page fetches detail; `IposTab.tsx` batched per-symbol detail fetch (Promise.all, graceful fallback).

## D2. `/api/events` server proxy + EventsFeedWidget grid

**Decision:** Add a server-proxy `GET /api/events` (auth-free, like announcements) and a client widget using dynamic `repeat(auto-fill, minmax(180px,1fr))` sizing placed directly below the Corporate Announcements widget on the dashboard.

- *Context:* NSE `/api/eventnotification` returns `{success, data:[{ID, EVENT_DATE, TITLE, CATEGORY_NAME, SLUG_URL, EVENT_START_TIMESTAMP, EVENT_END_TIMESTAMP, EVENT_DATE_LABEL, THUMBNAIL_URL}]}` — all current rows are "Listing Ceremony" PAST. Thumbnail is `//nsearchives.nseindia.com/...` (needs https: prefix).
- *Why this approach:* Matches the existing announcements widget pattern (client useSWR → server proxy → service → synced chain). `auto-fill` grid gives dynamic card sizing; fixed-height column with internal scroll keeps the page balanced.
- *Impact:* NEW `lib/services/nseEventsService.ts` (`NseEvent`, `mapEvent`, 6h TTL, EVENTS_FETCH audit); NEW `app/api/events/route.ts`; NEW `app/components/EventsFeedWidget.tsx`; `app/page.tsx` (import + stack below announcements).

## D3. AI v2 — JSON report architecture (client template, not AI HTML)

**Decision:** Rework the IPO analysis flow so the model returns a **structured JSON report object**, and a single **client-side `IpoReportView`** template renders it as a premium brokerage report. Replace `extractVerdict`/`extractRecommendation`/markdown rendering for NEW analyses; keep legacy markdown fallback for pre-existing cached rows.

- *Context:* User-specified architecture: AI returns JSON `{company, scores, recommendation, financials, news, peers, risks}`; a client React template renders a consistent report usable for PDF/dashboard/mobile later. Tailwind + Inter, green/red/blue/amber accents.
- *Why this approach:* Template rendering = consistent styling, accessibility, and future portability; never trust AI-generated HTML/markdown for layout. JSON enforcing a schema via prompt + robust fence extraction (`parseIpoReportJson`) is far more reliable than regex on prose.
- *Impact:* `lib/services/ipoAnalysisService.ts` (new report type + `parseIpoReportJson` + JSON-only prompt; `tokensUsed` stays 0 — `directPrompt` has no token counts), new `app/components/recommendations/IpoReportView.tsx`, `IpoAnalysisModal.tsx` + `IpoAnalysisPanel.tsx` swap.

## D4. Cache/API neutrality for v2 JSON

**Decision:** Keep the `IpoAnalysis` market-cache `data` shape and API response shape additive — attach the parsed `report` alongside `content`/`verdict`/`recommendation` so legacy rows still render via the markdown fallback while new rows carry `report`.

- *Context:* MarketCache `data` is `Json` (confirmed compatible); `dataType:"ipo_analysis"` persists `IpoAnalysis`. Existing 23 tests assert the markdown contract.
- *Why this approach:* Avoids breaking the persisted-cache contract or the existing test suite; the client picks `report` when present else falls back to `content`.
- *Impact:* cache payload + route response add `report`; tests extended.

## D5. MCP + Telegram additions

**Decision:** Surface the new NSE-backed capabilities (IPO analysis / IPO issue detail / NSE events) through the existing MCP API discovery/schema + handler, and add crisp Telegram commands with audit tags.

- *Context:* MCP is the documented external-data surface (v1.14, 23 functions); Telegram bot already has `/daily-recommendations`. Files to locate at implementation time.
- *Why this approach:* Keeps new data discoverable by external agents (MCP) and reachable by Telegram users without a new surface.
- *Impact:* `app/api/mcp` (schema + handler), Telegram command file, `lib/audit.ts` (reuse `EVENTS_*` / add tags as needed).

## D6. Client-safe pure module for Issue Size helpers

**Decision:** Move `parseSharesPerLot`, `parsePriceBandLow`, `perLotInvestment`, `formatIssueSize`, `IssueSizeInput` into a NEW zero-import module `lib/services/ipoIssueSize.ts`; `nseIpoService.ts` re-exports them (`export {…} from`) for server callers + tests; client components import from the pure module only.

- *Context:* Playwright caught `Module not found: Can't resolve 'dns'/'fs'` (HTTP 500) — `IposTab.tsx` value-imported `formatIssueSize` from `nseIpoService`, dragging `syncedDataService → prisma → pg` into the browser bundle. Violates `no_prisma_in_client_components`.
- *Why this approach:* Keeps `nseIpoService`'s API surface (tests/Telegram/MCP unchanged), zero risk to the server chain, and makes the client bundle lean. `import type { IpoIssue }` is erased at compile so it never pulls the module graph.
- *Impact:* NEW `lib/services/ipoIssueSize.ts`; `lib/services/nseIpoService.ts` (re-export + local `parseSharesPerLot` import for `parseIpoDetail`); `app/components/recommendations/IposTab.tsx` (import path switch).
