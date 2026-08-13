# Session Decisions — 2026-08-14 (v3.9.1)

Branch: `main` (v3.9.0 merged via PR #90 `264dd6c`, deployed) | Commit: 9247a9f (fix) + docs commit [skip ci]

## Decisions & Reasoning

1. **Fix the `analysisStatus` lie at the SERVICE, not the UI** — `swingRecommendationService.ts` set `analysisStatus = "done"` UNCONDITIONALLY after `analyzeSwingStocks` returned; the swing agent NEVER throws on per-stock failures (it attaches `analysisError` to each stock and swallows), so the `catch` → `"failed"` path was unreachable by design and a fully-failed batch still reported "done". The header badge (`ANALYSIS_STATUS_META` in `SwingTab.tsx`) already rendered the meta correctly — the bug was purely service-side, so the fix belongs in the service. New pure `analysisStatusAfterBatch(stocks)`: `"done"` only when ≥1 stock carries `analysis`, else `"failed"`; the `analyze=false` path keeps its initial `"skipped"` (unchanged).
2. **Status derived from data, never set as a constant** — Lesson #68. The only honest signal after a swallow-fail best-effort call is the result data itself (`stocks.some(s => s.analysis)`). A try/catch "failed" path is meaningless for functions whose failure mode is per-item degradation instead of throwing.
3. **+3 regression tests with the real prod failure string** — partial-batch → "done", all-failed → "failed" (regression for the live lie, using the actual `"Unusable AI response (p)"` error text), empty batch → "failed". Tests use the existing `makeSwingStock` helper — no new fixtures.
4. **Prod data gaps FLAGGED, NOT fixed (user decision required — DB changes need separate permission)**:
   - All swing indicators render "—" on prod because `daily_prices` has 0–1 rows per swing pick. The v3.6.0 market-sync cron syncs the stock LIST + corp actions + screeners, NOT daily prices; `computeIndicatorsFromSeries` needs ≥2 bars (momentum 10/20). Local DB mirrors this (213 rows = 19 NIFTY50 tickers × 1 bar). The `ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY "tradeDate" DESC) … rn <= 25` SQL is VALID (validated locally via temp `swing-diag.ts`). **Needs a historical-price sync job into prod `daily_prices`.**
   - MCP `getHistoricalData` 500s — `public.backtest_history` table does NOT exist in the prod DB. Separate pre-existing gap, not introduced by v3.9.0.
5. **AI batch prod failure = graceful degradation, not a bug** — both prod runs failed with "Unusable AI response (p)" ×2 attempts on two distinct cold instances (19:32:59Z / 19:42:45Z; "identical" timestamps earlier were an IST/UTC arithmetic error, no cache anomaly). The cards degraded exactly as designed; the only real defect was the lying status, now fixed.
6. **Commit scope** — Commit 1 (fix, 9247a9f): service + tests. Commit 2 (docs [skip ci]): AGENTS.md v3.9.1 row, CHANGELOG index + versions-v3, TODO.md, Primer.md (v3.9.0 marked MERGED/DEPLOYED), agent-memory.md, Lessons.md #68, session-todos.md, session archive `2026-08-14-9247a9f/`. No deploy — user manages merges/deploys.

## Verified

- Full suite: **638 pass / 11 skipped / 0 failures** (was 634). Swing targeted: 27/27 (24 prior + 3 new).
- `npx tsc --noEmit`: 0 errors on touched files; total 71 = exact pre-existing baseline.
- Live verification of DEPLOYED v3.9.0 on tradenext6.netlify.app (all PASSED): Swing tab "20 picks · 200 flagged · 34 screeners", family chips, "TV fallback" source badges, "+30 more" screener expand, refresh; chart buttons Today's Picks AXISBANK → `?symbol=AXISBANK-EQ` + `/markets` NIFTY BANK → `?symbol=NIFTY%20BANK` (90 buttons, outer card Link never fired); **0 console errors/warnings desktop + mobile 375px**.
- Pre-commit hooks passed (tsc production files clean; no credential literals; warn-only main).
