# Session Decisions — 2026-08-13 (8393ed9)

## v3.7.0 — F&O Analytics UI + NSE option-chain-v3 + MCP 28 fns
- Committed `8393ed9` on `fix/ai-config-cron-ledger`; pushed; PR #88 open against `main` (base main, linear history preserved, main untouched).
- No deploy (consistent with v3.5.4→v3.6.4 holds). Netlify deploy, prod demo re-seed, and the v3.6.3 backfill (`scripts/backfill-recommendation-levels.ts`) remain user-approved carry-overs.

## Wiki publish (user-requested, done)
- Pages: Home (updated), F&O-Analytics, Getting-Started, User-Guide (+ 9 screenshots in `images/`).
- Wiki repo: `C:\Users\lucky\AppData\Local\Temp\opencode\TradeNext-wiki`; commit `503a258` pushed to `master`.
- Images verified: raw + wiki-relative URLs return 200; rendered pages display them.

## NEW TASK — /markets/analytics side nav + breadcrumbs
- Decision: replicate the Recommendations SECTIONS sidebar pattern (`flex flex-col lg:flex-row gap-6` + `aside lg:w-56 shrink-0` + `nav lg:sticky lg:top-24`, horizontal scroll on mobile) inside `MarketAnalyticsTabs`.
- Decision: analytics page is light/dark ADAPTIVE (recommendations is dark-only) → sidebar styles use light + `dark:` variants, NOT the hardcoded dark classes from recommendations.
- Decision: breadcrumbs already render globally (`app/layout.tsx` → `app/components/ui/Breadcrumbs.tsx`) — Home / Markets / Analytics; no new code needed, verify live.
- Decision: tab click now syncs URL `?tab=` via `router.replace(..., { scroll: false })` → deep-linkable, smoother nav; existing param-sync effect guards loops.
- Decision: add emoji icons per section for visual parity with recommendations.
- Version: v3.7.1 (UX enhancement row).

## v3.7.1 — BUY/SELL-only Telegram broadcast + AI connection-test cron + CI e2e fix
- **Broadcast**: user wants NO HOLD suggestions in the daily Telegram message. Decision: NEW pure `lib/services/recommendationBroadcast.ts` (`buildRecommendationBroadcast`) filters to BUY/SELL only, cap 8 picks, all-HOLD day → short notice instead of empty message, footer `🟢 N BUY · 🔴 N SELL · ⚪ N HOLD not shown`, truncate at 4000 (slice = 4000 − marker length, off-by-5 fixed). HOLDs remain stored + tracked (History/Performance) — the change is presentation-only.
- **Connection test**: user wants a cron that probes the AI model BEFORE the daily run and falls back when the configured model is unreachable; **and the result captured in audit logs + the connection test status**. Decision: `testOpenRouterModel` uses RAW fetch (not `directPrompt` — it swallows errors into strings); fallback chain `openrouter/free` → `openrouter/auto` as module-local constants (no change to config.ts model catalog); `!hasValidConfig` → short-circuit failed + notify. Persistence: EVERY attempt → `trackAiCall` (action `connection_test`, ServerLog source "ai", AI Monitoring page) + the OVERALL outcome → `createAuditLog` with NEW tags `AI_CONNECTION_TEST`/`AI_CONNECTION_TEST_FAILED` and full status metadata. Failure → `notifyAdmins` with `/admin/utils/ai-monitoring` link.
- **Cron**: 4th system job "AI Connection Test (System)", expr `*/30 3-10 * * 1-5` (every 30 min IST 08:30–15:30 Mon–Fri) — `lib/cron-parser.ts` supports `*/N`; reuses the `ensureRecommendationCrons` upsert-by-name + self-heal pattern; `run-cron-background` action `ai-connection-test` (whitelist + recordRun vs the new name); new scheduled fn mirrors cron-market-sync (30s cap, fan-out).
- **Gotchas fixed**: `*/30` inside a JSDoc comment terminates the comment (`*/`) → reworded "step 30 every min"; `track` closure referenced `report` const declared later (TDZ) → per-attempt `new Date().toISOString()`.
- **CI e2e**: TemplatesPanel defaults to Chartink mode ("Short term breakouts" lowercase) — spec asserted TV-mode title-case. Decision: click the `TradingView · 98` toggle in template-search tests; Chartink remains jest-covered (no Chartink e2e assertions). Nested `<a>` on `/markets` (hydration warning) → `<span role="link">`.
- **Version**: v3.7.1. Docs updated; commit pending user approval; no deploy (consistent holds).

## v3.7.2 — Netlify secrets-scan build-failure fix + live-site health/staleness finding + backfill executed
- **Live-site clarification (user)**: verify the LIVE site (https://tradenext6.netlify.app), NOT localhost. Done via chrome-devtools: `/markets/analytics` + `/recommendations` healthy (live NSE breadth, Corp Events table, pagination, 0 console errors, mobile 375px no overflow) — **BUT the site runs an OLD build: no v3.6.3 SECTIONS sidebar, no v3.7.x features** → deploy on hold per user + blocked by this fix branch. Finding documented in AGENTS/TODO/Primer/versions-v3.
- **Secrets-scan fix (user-reported Netlify failure)**: Netlify scans EVERY repo file → `.githooks/` (extensionless, holds demo-cred literals from v3.5.7 masking) not omit-listed → `netlify.toml` `SECRETS_SCAN_OMIT_PATHS` += `.githooks` (config-only; hooks unchanged).
- **App hygiene decision**: replace placeholder-looking numeric secrets in scanned paths (`lib/alerts/delivery/telegram.ts` example token/chatId, `TelegramSubscription.tsx` placeholder chatId, verify-route JSDoc example code, `nse-api.test.ts` timestamps) with clearly-fake values (`87654321:AAfake0token1for2docs3only`, `-1008765432100`, `876543210`, `654321`) — a future env value containing the old numeric substring would fail the scan.
- **Backfill executed (user consent given)**: `npx tsx --env-file=.env scripts/backfill-recommendation-levels.ts` → **792 scanned / 513 updated / 2 corrected** (GMRAIRPORT SELL, LICI HOLD); ITC no longer shows inverted levels.
- **User action**: Netlify `DEFAULT_PASSWORD` rotated (new value no longer shares a substring with app placeholders; repo scans clean regardless). Optional further rotation to a value with no numeric substring.
- **Branch**: `fix/netlify-secrets-scan` recreated fresh from main (old local copy `58d18c9` was 0 ahead / 55 behind main, fully merged → deleted).
- **Version**: v3.7.2. Docs updated; commit pending user approval; **no deploy (deploy on hold per user)**.
