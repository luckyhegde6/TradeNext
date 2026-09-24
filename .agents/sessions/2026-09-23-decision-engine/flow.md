# Execution Flow — spec 16 Decision Engine (branch feature/ph22-decision-engine)

> Summary: user approved "Build engine core + POC A/B" (no SDK, no live smoke — P6003 hold). All code phases done + verified. Docs pass v3.41.0 done. Commit as v3.41.0 pending user approval. Companion: `decisions.md`.

## Phases (actual work sequence)

- Phase 1 — RESEARCH/SPEC: created `.agents/specs/16-decision-engine.md` + `.agents/plans/16-decision-engine.md`; user approved D1 "Build engine core + POC A/B".
- Phase 2 — ENGINE CORE: `lib/services/decision/` types/config/provider/gate/fusion built.
- Phase 3 — ROUTES: `/api/decision/evaluate` + `/api/admin/decision/ping` + tests (evaluate 9 : ping 4).
- Phase 4 — POC A + POC B: `chartinkUnifiedScreenerService.ts` scoring gate + `swingAutoSeedService.ts` `gateAutoGenerate()` + audit tags.
- Phase 5 — LAYA: `layaProvider.ts` mock model + tests; `client.ts` retry ≤ 3 + inert null + seams.
- Phase 6 — LAYA-ONLY PIVOT: `typesafeProvider.ts` (was created with a guarded lazy require) **deleted**; `DECISION_PROVIDER` modes = `none|laya` only; Jev stays docs-only.
- Phase 7 — ADMIN UI + OPENAPI: `/admin/decision` panel + nav entry + swagger (tag 'Decision Engine', header "v3.41.0, spec 16").
- Phase 8 — ENV: `.env.example` `DECISION_PROVIDER=none` ("laya" (mock)) + `DECISION_POC_ENABLED=false`.
- Phase 9 — HARNESS FIX (Lesson 135): `check-tsc-baseline.test.ts` ENOENT in temp-dir harness → `makeHarness()` writes stub `tsconfig.json` → 9/9.
- Phase 10 — VERIFICATION + DOCS: tsc 46 exact · lint 0 · 107/107 (1401 pass / 4 skip / 0 fail) · quickbuild 188/188; v3.41.0 docs pass.

## Code touched (DONE)

- [x] `lib/services/decision/types.ts` — SHAPE_CONFIDENCE; Linearity/StructuralBalance/ScoreCriterion unions; DecisionProviderName = `none|laya`; EngineProvider; LayaEvaluateRequest; DecisionResponse<T>.
- [x] `lib/services/decision/config.ts` — modes: none → inert, laya → LayaLlmProvider; DECISION_PROVIDER unknown → warn + coerce none (D8).
- [x] `lib/services/decision/provider.ts` — provider factory (none|laya; unknown → coerce none).
- [x] `lib/services/decision/gate.ts` — DecisionGateSeverity + static GATE_THRESHOLDS (informational 0.55/0.35, moderate 0.75/0.5, destructive 0.9/0.7); classifyAction → ACT|REVIEW; decisionGateText.
- [x] `lib/services/decision/fusion.ts` — weightedMean + DecisionFusion per-option weighted-mean isPure.
- [x] `lib/services/decision/layaProvider.ts` — mock contract (option-0 argmax; peaked probs; shapeConfidence = 1 − H(p)/log₂(k); score EV; noul p[1]=0.85; never targetPrice/stopLoss).
- [x] `lib/services/decision/client.ts` — retries ≤3 (250/500/1000ms); inert evaluate() → null; seams _createDecisionClientWithProviders/_resetDecisionClient/_setDecisionClient.
- [x] `app/api/decision/evaluate/route.ts` — POST /api/decision/evaluate (nodejs, admin auth, zod discriminatedUnion choice|score|noul, questions 1-10, state ≤16384B; 400 bad JSON, 503 provider throw, "inert" null).
- [x] `app/api/admin/decision/ping/route.ts` — GET /api/admin/decision/ping (admin-only; { success, ping: { mode, providers, detail }, flags }).
- [x] `app/api/openapi/route.ts` — Decision Engine tag after /api/fo/expiries; header "v3.41.0, spec 16".
- [x] `app/admin/decision/page.tsx` — admin panel (mode, flags, live evaluate try-out).
- [x] `app/admin/layout.tsx` — nav entry "Decision".
- [x] `lib/audit.ts` — DECISION_EVALUATED/DECISION_GATE audit tags (createAuditLog metadata, optional userId; no DECISION_PROVIDER_FALLBACK).
- [x] `lib/services/chartinkUnifiedScreenerService.ts` — POC A gate (DECISION_POC_ENABLED === "true"), try/catch non-fatal, off = byte-identical; decisionScore/decisionGate with SCREENER_POC_RUBRIC (momentum 0.6 / signalSupport 0.4).
- [x] `lib/services/swingAutoSeedService.ts` — gateAutoGenerate: off → allow "engine-off"; on → noul ≥ AUTO_SEED_NOUL_MIN (0.75) AND choice AUTOSEED_REGIME ("trending") → allow, else "review"; provider throw/inert → graceful allow + audit. Constants AUTOSEED_NOUL, AUTOSEED_REGIME.
- [x] `lib/__tests__/decisionEvaluateRoute.test.ts` — NEW (9 cases).
- [x] `lib/__tests__/decisionPingRoute.test.ts` — NEW (4 cases).
- [x] `lib/__tests__/decisionGate.test.ts` — NEW (thresholds, worst-severity).
- [x] `lib/__tests__/decisionFusion.test.ts` — NEW (weightedMean + isPure).
- [x] `lib/__tests__/decisionClient.test.ts` — NEW (retry 0/1/2/3 + backoff + inert null).
- [x] `lib/__tests__/layaProvider.test.ts` — NEW (mock contract).
- [x] `lib/__tests__/swingAutoSeedService.test.ts` — NEW (gate + audit).
- [x] `lib/__tests__/check-tsc-baseline.test.ts` — harness fix (stub tsconfig in makeHarness) → 9/9.
- [x] `lib/services/decision/typesafeProvider.ts` — created with guarded lazy require, then **DELETED** in the Laya-only pivot (D7).
- [x] `.env.example` — DECISION_PROVIDER=none (comment "laya" (mock)) + DECISION_POC_ENABLED=false; NO TYPESAFE_* placeholders (D8, grep-confirmed).

## Verification (Phase 10 — all green)

- `npx tsc --noEmit`: 46 = exact baseline (0 decision-file errors).
- `npm run lint`: 0 errors.
- `npm run test`: 107/107 suites, 1401 pass / 4 skip / 0 fail.
- `npm run quickbuild`: 188/188 pages (incl. /admin/decision + both routes; single pre-existing themeColor warning).
- Full output: `C:\Users\lucky\.local\share\opencode\tool-output\tool_0cfcfd4290018tTxVGj1rsI5jj`
- Docs pass v3.41.0 done: versions-v3.41.md (NEW), AGENTS.md row + pointer, CHANGELOG, versions-index, TODO.md, session-todos, Primer, agent-memory, Lessons 135 + Update Log, handoff latest.md, this file.

## End state

- Whole stack green; v3.41.0 commit message prepared; commit as **v3.41.0** pending user approval (no push/PR; never `scripts/spike-laya/weights/`).