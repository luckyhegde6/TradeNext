# v3.41.0 — Decision Engine Core + POC A/B (Spec 16, Laya-only)

> **Branch**: `feature/ph22-decision-engine` (on `2909b22` = v3.40.8 spike VERDICT APPROVE; parent `5453d91` = v3.40.7)
> **Spec**: `.agents/specs/16-decision-engine.md` · **Plan**: `.agents/plans/16-decision-engine.md`
> **Session**: `.agents/sessions/2026-09-23-decision-engine/`
> **Status**: CODE + TESTS + VERIFICATION + DOCS DONE — tsc 46 exact baseline · lint 0 · 107/107 suites (1401 pass / 4 skip / 0 fail) · quickbuild 188/188 · **commit as v3.41.0 pending user approval (no push/PR)**

User-approved option (D1): **"Build engine core + POC A/B"** — no SDK install, no real provider, no live smoke (P6003 plan-limit hold).

## Why

v3.40.5 researched Laya (System One) + Jev as a decision-engine layer; v3.40.8 P0 spike (onnxruntime-node, ~503MB int8 weights, chained encoder→head smoke median 2316 ms, RSS 611 MB) returned **VERDICT APPROVE** — SPLIT graphs, engine P1–P6 next. v3.41.0 implements the engine core **Laya-only**: a confidence-gated evaluate/score/noul client + two POC integrations (screener scoring + swing auto-seed gate). `typesafeProvider.ts` **deleted** in the Laya-only pivot (no `@typesafe-ai/sdk`; Jev stays a docs-only reference — hosted API, not OSS).

## Engine core (`lib/services/decision/`)

- `types.ts` — `SHAPE_CONFIDENCE` constant; `Linearity`/`StructuralBalance`/`ScoreCriterion` unions; `DecisionProviderName = "none" | "laya"`; `EngineProvider` interface (`evaluate<T>` → `Decision<T> | null`); `LayaEvaluateRequest`; `DecisionResponse<T>` (`{ success, result, provider, elapsedMs }`).
- `config.ts` + `provider.ts` — provider resolution: `none` = inert, `laya` = LayaLlmProvider; `DECISION_PROVIDER` unknown value → warn + coerce `none` (D8). No `TYPESAFE_*` env; `next.config.ts` `serverExternalPackages` **NOT modified**.
- `gate.ts` — `DecisionGateSeverity` (`informational|moderate|destructive`), static `GATE_THRESHOLDS` (informational act 0.55 / review 0.35; moderate 0.75 / 0.5; destructive 0.9 / 0.7), `classifyAction()` → `ACT | REVIEW` only (never BLOCK/deny), `decisionGateText()`.
- `fusion.ts` — `weightedMean()` + `DecisionFusion` per-option weighted-mean `isPure` checks.
- `layaProvider.ts` — mock contract: choice → option-0 argmax + peaked probs + `shapeConfidence(p) = 1 − H(p)/log₂(k)`; score → expected-value weighted mean; noul → `p[1] = 0.85`, **no confidence**; never emits `targetPrice`/`stopLoss`.
- `client.ts` — evaluate retry ≤ 3 (250/500/1000 ms backoff), inert `evaluate()` → `null` on provider throw; seams `_createDecisionClientWithProviders` / `_resetDecisionClient` / `_setDecisionClient`.

## POC A + POC B

- **POC A** (`lib/services/chartinkUnifiedScreenerService.ts`): `runChartinkUnifiedScreeners()` gated on `DECISION_POC_ENABLED === "true"`, try/catch → non-fatal warn; engine off = byte-identical output; on: optional `decisionScore?` (fusion weighted-mean, `SCREENER_POC_RUBRIC` momentum 0.6 / signalSupport 0.4) + `decisionGate?` (worst-severity).
- **POC B** (`lib/services/swingAutoSeedService.ts`): `gateAutoGenerate()` — off → `"engine-off"` allow; on → allow only if noul ≥ `AUTO_SEED_NOUL_MIN` (0.75) **AND** choice `AUTOSEED_REGIME` (`"trending"`); else `"review"`; provider throw/inert → graceful allow + audit. Constants `AUTOSEED_NOUL`, `AUTOSEED_REGIME`.

## Routes + admin UI

- `POST /api/decision/evaluate` (nodejs, admin auth): zod `discriminatedUnion("type")` — `choice` (options 2–8), `score` (criteria 1–12), `noul` (instruction ≤ 500, statePath ≤ 128); questions 1–10; state JSON ≤ 16 384 B; 400 invalid JSON, 503 on provider throw, `"inert"` on null, 200 + `DECISION_EVALUATED` audit.
- `GET /api/admin/decision/ping` (admin-only): `{ success, ping: { mode, providers, detail }, flags: { DECISION_PROVIDER, DECISION_POC_ENABLED } }`.
- `app/admin/decision/page.tsx` + nav entry in `app/admin/layout.tsx` — mode + flags + live `evaluate` try-out (protected).
- OpenAPI: both routes after `/api/fo/expiries`, tag `['Decision Engine']`, header **"v3.41.0, spec 16"**.

## Audit tags (`lib/audit.ts`)

`DECISION_EVALUATED` + `DECISION_GATE` only (no `DECISION_PROVIDER_FALLBACK` — Laya-only has no failover). `createAuditLog` uses `metadata` (not `meta`), optional `userId`.

## Env (`.env.example`)

`DECISION_PROVIDER=none` (comment: `"laya" (mock)`) + `DECISION_POC_ENABLED=false`; **no `TYPESAFE_*` placeholders**.

## Harness fix — Lesson 135

`check-tsc-baseline.test.ts` failed at the harness boundary: `scripts/dev-checks/check-tsc-baseline.mjs` `buildGateTsconfig()` :47 does an unguarded `readFileSync(resolve(ROOT, "tsconfig.json"))` and `makeHarness()` copies the script into a temp dir WITHOUT the root `tsconfig.json` → ENOENT (the 46-baseline gate itself still passed). Fix: `makeHarness()` writes a stub `tsconfig.json` (`{ "include": ["**/*.ts"], "exclude": [] }`) → suite 9/9. → `Lessons.md` **135**.

## Tests & verification

- 13 route tests (evaluate 9 : ping 4) + `decisionGate`/`decisionFusion`/`decisionClient` suites + `layaProvider.test.ts` + NEW `swingAutoSeedService.test.ts`; `check-tsc-baseline.test.ts` updated (harness fix).
- **`tsc --noEmit` 46 = exact baseline** (0 decision-file errors) · lint **0** · **107/107 suites / 1401 pass / 4 skip / 0 fail** · quickbuild **188/188** (incl. `/admin/decision` + both routes; single pre-existing `themeColor` warning). Full output: `C:\Users\lucky\.local\share\opencode\tool-output\tool_0cfcfd4290018tTxVGj1rsI5jj`.

## Follow-ups

- P1–P3: real Laya inference behind a parity gate (laya-mock stays default) — user approval + key.
- Jev = docs-only reference (hosted API; NOT OSS) — no integration planned.
- Notes: no Prisma migration (P6003 hold), no new packages, no `next.config.ts` change.