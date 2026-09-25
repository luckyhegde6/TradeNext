# Decisions — spec 16 Decision Engine (branch feature/ph22-decision-engine)

> Companion to `flow.md`. Decisions with reasoning (D1–D9). Prior session: v3.40.8 spike (commit `2909b22`, clean tree). Summary: user approved "Build engine core + POC A/B". All code done + verified; commit as v3.41.0 pending user approval.

## Decisions

- **D1 (approved choice)**: "Build engine core + POC A/B" — user approved. No SDK, no key, no live smoke (P6003 plan-limit hold). → engine is Laya-only mock; Jev stays docs-only.
- **D2 (REVISED)**: `typesafeProvider.ts` was created with a guarded lazy require (no runtime import on non-typesafe modes), then **DELETED** in the Laya-only pivot. `next.config.ts` `serverExternalPackages` is **NOT modified**. No `@typesafe-ai/sdk` installed; `.env.example` has **no `TYPESAFE_*` placeholders** (grep-confirmed). `DECISION_PROVIDER` modes = `none` | `laya` only (D8).
- **D3 (REVISED)**: audit tags = `DECISION_EVALUATED` + `DECISION_GATE` only. Removed `DECISION_PROVIDER_FALLBACK` (Laya-only has no failover). `createAuditLog` uses `metadata` (not `meta`), optional `userId`.
- **D4**: `shapeConfidence(p) = 1 − H(p)/log₂(k)`. Thresholds: informational 0.55/0.35, moderate 0.75/0.5, destructive 0.9/0.7. `classifyAction()` returns ACT|REVIEW only (never BLOCK/deny).
- **D5**: fuse per-option (not per-aggregate): mean over option-slices, weighted by weight items (`DecisionFusion`, `weightedMean` + `isPure`).
- **D6**: retries ≤ 3 (250/500/1000 ms backoff) instead of unlimited; inert `evaluate()` → `null` on provider throw; seams `_createDecisionClientWithProviders`/`_resetDecisionClient`/`_setDecisionClient` for tests.
- **D7 (REVISED)**: `typesafeProvider.test.ts` deleted together with the provider; `swingAutoSeedService.test.ts` created NEW (not modified); route tests = 13 (evaluate 9 + ping 4); `check-tsc-baseline.test.ts` updated for the harness fix (D9).
- **D8 (NEW)**: `DECISION_PROVIDER` modes = `none` | `laya`; unknown value → warn + coerce `none`. Confirmed via grep: `.env.example` has no `TYPESAFE_*` placeholders; flow.md's stale line listing them removed.
- **D9 (NEW)**: `check-tsc-baseline.mjs` `buildGateTsconfig()` :47 does an unguarded `readFileSync(resolve(ROOT, "tsconfig.json"))`; `makeHarness()` copies the script into a temp dir WITHOUT the root `tsconfig.json` → every harness case threw ENOENT at the harness boundary (the 46-baseline gate still passed). Fix = `makeHarness()` writes a stub `tsconfig.json` (`{ "include": ["**/*.ts"], "exclude": [] }`) → suite 9/9. → **Lessons.md lesson 135**.

## Follow-ups (open)

- P1–P3: real Laya inference behind a parity gate (laya-mock stays default) — user grants install + key first.
- Jev: kept as docs-only reference (hosted API, NOT OSS; no integration). Prior "flip DECISION_PROVIDER=typesafe|auto" follow-up dropped — no typesafe provider exists.
- Pandora/proteusStateId mapping: deferred.