# Session Flow — 2026-08-13 (v3.7.4-prod-backfill-recs-check + AI-agent prompt analysis)

## Part 1 — Prod backfill / recs check (ops)
1. **Context read**: HANDOFF.md, Primer.md, session-todos.md, Lessons.md tail, backfill script, prisma client, netlify.toml, env-key presence (masked).
2. **Baseline**: live `GET /api/recommendations` at ~09:50 IST → still `runDate 2026-07-19T10:16:21Z` (stale). Live `/recommendations` HTML → v3.6.3 SECTIONS sidebar present (new build deployed).
3. **User consent** (question tool): backfill AFTER 10 AM run; check recs after today's run.
4. **Waiting**: cron fires 10:00 IST (04:30 UTC) → poll public API until fresh runDate (polled 10:01–10:23, stale; user aborted).
5. **Admin UI findings (user paste)**: scheduled task 13/8 10:24 pending; worker idle; 3 stale "running" tasks since 11 Aug — scheduler appears stuck.
6. **Backfill (prod, NOT yet run)**: `npx tsx --env-file=.env.production scripts/backfill-recommendation-levels.ts` — deferred until run completes.

## Part 2 — AI agent prompt/context analysis (branch `analysis/ai-agent-prompts`)
7. **Branch created** from main `b55c7ad`.
8. **Read AI layer**: `recommendation-agent.ts`, `recommendation-context.ts`, `config.ts`, `llm-provider.ts`, `orchestrator.ts`, `screener-agent.ts`, `prompts.ts`, `prompt-manager.ts`, `connectionTestService.ts`, `ai-monitoring.ts` (via grep), `ipoAnalysisService.ts`, `ipoReport.ts`, `dailyRecommendationService.ts` (AI block), `alert-agent.ts` (grep), `app/api/ai/query/route.ts`, `app/api/ai/screener/route.ts`.
9. **Confirmed root causes**:
   - Q&A path has NO tools: `useTools` defaults false AND orchestrator `callModel` never attaches a `tools` array → "can't browse web".
   - Rec agent gets ~5 numeric fields only (price/change/volume/screeners/mcap); no technicals/valuation/index regime → targets/SL are guesses.
   - 2048 maxTokens default truncates 5-stock JSON batches → HOLD defaults.
   - No fallback model chain in pipeline (connection-test fallbacks unused).
   - Screener prompt advertises `search_stocks` tool that doesn't exist.
   - IPO prompt demands GMP/news/peers the model cannot fetch (no tools).
   - `prompt-manager.ts` never wired into any agent (dead code).
10. **Deliverable**: `docs/designDoc/ai-agent-prompts-analysis.md` — inventory + root causes + prioritized P0/P1/P2 plan.

## Code/files touched
- `.agents/sessions/2026-08-13-64835cd/decisions.md`, `flow.md` (this session).
- `docs/designDoc/ai-agent-prompts-analysis.md` (NEW, on branch).
- No production code changed (analysis-only).
