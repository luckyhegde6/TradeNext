# Session Todos

## Current (v3.21.0 — Professional Equity Research Decision Engine)

Branch: `feat/stock-analysis-skill`

- [x] Phase 1 — Types: `Verdict` (8-level) + conviction/confidence + evidence labels + RiskItem[] etc. (`intelligenceTypes.ts`) — DONE
- [x] Phase 2 — Doc normalizer (`lib/services/document/normalize.ts`, 50KB cap, no server-only) — DONE
- [x] Phase 3 — Prompt builder/parser (`buildStockAnalysisPrompt`/`parseStockAnalysisResponse`, legacy kept) — DONE
- [x] Phase 4 — Orchestrator documents path + audit metadata + whitespace-doc fix — DONE
- [x] Phase 5 — `fetchTechnicalsData` 90→280-day for sma200 — DONE
- [x] Phase 6 — POST route Zod documents schema (50KB cap, 400 invalid) — DONE
- [x] Phase 7 — UI: VerdictCard + 11 new sections + rewritten IntelligentPanel/CompanyIntelligence/RiskCatalystMatrix — DONE
- [x] Phase 8 — Tests: `stock-analysis-prompt.test.ts` (21) + `document-normalize.test.ts` (9) + `intelligence.test.ts` +3 — **suite 915 pass / 4 skip (was 883/4), tsc 46 = baseline** — DONE
- [x] Phase 9 — Docs: AGENTS.md/CHANGELOG/TODO/Primer(Session 20)/agent-memory/Lessons(#92,#93)/versions-v3.21.md/session-todos — DONE
- [ ] Present commit/PR decision to user (no auto-commit/push/merge) — PENDING

## Completed This Session
- [x] Verify branch `feat/stock-analysis-skill` (off main, clean)
- [x] Backward compatibility: legacy intelligence prompt/parser kept (18 legacy tests pass), new fields optional, no DB migration
- [x] Confirm baseline: suite 883 pass / 4 skip, tsc 46 (all pre-existing) before changes
- [x] Full suite re-run after implementation: 915 pass / 4 skip, tsc 46 = baseline (0 new production errors)
- [x] `decisions.md` + `flow.md` for session `2026-08-28-stock-analysis-skill`
- [x] `.agents/handoffs/active/latest.md` updated

## Deferred / Other Workstreams
- [ ] Separate: PR #107 (`feat/plan-limit-resilience`) — open, unmerged (playwright-debug, unrelated)
- [ ] Separate: v3.20.2 commit/push/PR on `feat/db-health-price-cache` (committed `5156eb3`, pending push/PR)
- [ ] Prod (post-hold, Sep 1): corporate-actions backfill; remove Prisma Postgres extension from Netlify Dashboard then deploy
