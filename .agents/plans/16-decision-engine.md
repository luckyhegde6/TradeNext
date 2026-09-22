# Implementation Plan — 16. Decision Engine (Laya + Jev, ph22)

> Generated from spec: `.agents/specs/16-decision-engine.md`
> **Branch**: `feature/ph22-decision-engine`

## Spec Reference

- **Spec**: `.agents/specs/16-decision-engine.md`
- **Branch**: `feature/ph22-decision-engine`
- **Created**: 2026-09-22
- **Requires**: human approval (spec gate + plan gate) + explicit permission for sensitive ops (§0)

---

## §0. Pre-flight: permission gates (BLOCKING — must pass before any code)

1. **Human approves spec** `16-decision-engine.md` → verify: user confirms in chat
2. **Human approves plan** (this file) → verify: user confirms in chat
3. **`npm install @typesafe-ai/sdk`** — user permission → verify: package in `package.json` + `node_modules`
4. **Live `POST /v1/systemone` smoke test** (real key, dev only) → verify: 200 + answer shapes match §4 of spec; latency + cost captured
5. **Laya spike** (`scripts/spike-laya/`, separate step — see Phase 0) → verdict decides real `layaProvider` path

> Until #1–#2 pass: STOP. No implementation.

---

## Implementation Steps

> Ordered, atomic, independently verifiable. `[N] Step → verify: [check]`

### Phase 0: Spikes & provisioning

1. **Laya runtime spike** — `scripts/spike-laya/`: prototype transformers.js vs onnxruntime-node vs Python sidecar on a sample model forward pass; capture load time, per-decision latency, memory (RSS), model-size fit → verify: `scripts/spike-laya/VERDICT.md` exists with a winning runtime + rationale. *Laya real provider implementation is BLOCKED until this verdict; mock used meanwhile.*
2. **Jev smoke test** (permission #4) — run a one-shot `node --eval` via `npx tsx` using `@typesafe-ai/sdk` against live `POST /v1/systemone` with a sample state + choice/score/noul → verify: answers + probabilities + confidence returned; latency logged. (Do NOT store the key in repo.)

### Phase 1: Engine core — types + interface

3. **Create `lib/services/decision/types.ts`** with the exact types from spec §4.A → verify: `npx tsc --noEmit` (0 new errors)
4. **Create `lib/services/decision/provider.ts`** with `DecisionProvider` interface (spec §4.B) → verify: `npx tsc --noEmit`

### Phase 2: Gate

5. **Create `lib/services/decision/gate.ts`** — `decide(confidence, risk)` + threshold table (spec §4.E) → verify: `npx tsc --noEmit`
6. **Write `lib/__tests__/decisionGate.test.ts`** — uniform→0, one-hot→1, risk scaling, boundaries → verify: `npm run test -- decisionGate`

### Phase 3: TypeSafe (Jev) provider

7. **Create `lib/services/decision/typesafeProvider.ts`** — `TypeSafeProvider` (spec §4.C); map SDK question builders (ordered `criteria` tuple), verbatim answer mapping, `health()` via `models.list()` → verify: `npx tsc --noEmit`
8. **Write `lib/__tests__/typesafeProvider.test.ts`** — mocked `TypeSafeClient`: request shapes, ordered criteria, env-model default, error rethrow → verify: `npm run test -- typesafeProvider`

### Phase 4: Laya provider (mock-gated)

9. **Create `lib/services/decision/layaProvider.ts`** — `LayaProvider` with `provider: "laya-mock"` deterministic answers (real inference only after Phase 0 #1 verdict) → verify: `npx tsc --noEmit`
10. **Write `lib/__tests__/layaProvider.test.ts`** — mock deterministic answers, interface parity → verify: `npm run test -- layaProvider`

### Phase 5: Client (factory + failover)

11. **Create `lib/services/decision/client.ts`** — `createDecisionClient()`; env-driven provider set; `none` → inert (`null`); `auto` → Laya→TypeSafe failover; retry ≤3 exp backoff; latency capture; `provider()` string → verify: `npx tsc --noEmit`
12. **Write `lib/__tests__/decisionClient.test.ts`** — inert-null, env selection, failover audit, retry counts, latency → verify: `npm run test -- decisionClient`

### Phase 6: Audit tags

13. **Modify `lib/audit.ts`** — add `DECISION_EVALUATED`, `DECISION_PROVIDER_FALLBACK`, `DECISION_GATE` action types → verify: tags exported + existing audit tests still pass (`npm run test -- audit`)

### Phase 7: POC A — screener rank fusion

14. **Create `lib/services/decision/fusion.ts`** — `scoreCandidate(state, rubric)` weighted composite (spec §4.F) → verify: `npx tsc --noEmit`
15. **Write `lib/__tests__/decisionFusion.test.ts`** — weighted sums, gate-per-factor, empty rubric → verify: `npm run test -- decisionFusion`
16. **Wire POC A hook** into screener orchestrator behind `DECISION_POC_ENABLED` — optional composite-rank pass; **off = zero behavior change** → verify: `DECISION_POC_ENABLED=false` screener output identical to before (screener e2e/unit suite green)

### Phase 8: POC B — Swing AI gatecheck

17. **Modify `lib/services/swingAutoSeedService.ts`** — `gateAutoGenerate()` (spec §4.G) behind `DECISION_POC_ENABLED`; engine-off → `allowed: true`, **no provider call** → verify: `npx tsc --noEmit`
18. **Extend `lib/__tests__/swingAutoSeedService.test.ts`** — engine-off passthrough; noul≥0.75+trending→allowed; review/skip branches; audited NO-OP → verify: `npm run test -- swingAutoSeedService`

### Phase 9: Admin API routes

19. **Create `app/api/decision/evaluate/route.ts`** — `export const runtime = "nodejs"`, admin auth, zod body (question cap ≤10, state ≤16 KB), 401/400/503/200 (spec §7) → verify: `npx tsc --noEmit`
20. **Create `app/api/admin/decision/ping/route.ts`** — admin auth, provider health (spec §7) → verify: `npx tsc --noEmit`
21. **Update `app/api/openapi/route.ts`** — swagger entries for both routes → verify: `npm run lint` + swagger renders at `/api/openapi`
22. **Route tests** — 401 unauthenticated / 400 invalid / 503 disabled / 200 mock → verify: `npm run test` (api route suite)

### Phase 10: Admin UI panel

23. **Create `app/admin/decision/page.tsx`** — provider selector (none/laya/typesafe/auto), ping button, evaluations table; states: skeleton/empty/error+retry/data; responsive 375/768/1440; dark-mode tokens → verify: `npx tsc --noEmit`
24. **Playwright e2e** for admin panel states (`e2e/admin-decision.spec.ts`) → verify: `npm run test:e2e` (admin project) passes; 0 console errors

### Phase 11: `.env.example` + docs

25. **Update `.env.example`** — `TYPESAFE_API_KEY` (placeholder), `TYPESAFE_BASE_URL`, `TYPESAFE_DEFAULT_MODEL`, `DECISION_PROVIDER`, `DECISION_POC_ENABLED` → verify: no real secrets added
26. **Full validation sweep** → verify: `npx tsc --noEmit` (0 new, baseline 46), `npm run lint` (0), `npm run test` (all pass), `npm run quickbuild` (185/185)
27. **Docs pass** — AGENTS.md version row + `.agents/changelog/versions-v3.41.md` (new) + CHANGELOG index + TODO + Primer + agent-memory + Lessons (Jev/SDK gotchas if learned) + session memory (`decisions.md` + `flow.md`) + handoff/latest.md → verify: all present
28. **GitHub wiki** — add `Jev-Decision-Model.md` page (what/how/benefit, sequence + mermaid + SDK toolcalls) and link from Home → verify: wiki page renders mermaid without parse errors (see wiki-creator skill)

---

## Test Strategy

### Unit Tests (Required)

| Test | File | What It Verifies |
|------|------|------------------|
| Uniform→low conf, one-hot→high | `decisionGate.test.ts` | Confidence shaping |
| Risk-scaling (read-only vs destructive) | `decisionGate.test.ts` | Threshold semantics |
| Boundary exact (0.55/0.35, 0.75/0.50, 0.90/0.70) | `decisionGate.test.ts` | Gate mapping |
| `none` → evaluate returns null, no provider | `decisionClient.test.ts` | Inert default |
| Provider select per env / auto failover | `decisionClient.test.ts` | Factory behavior |
| Retry count = ≤3, backoff, latency captured | `decisionClient.test.ts` | Resiliency |
| Request shape: state + ordered criteria | `typesafeProvider.test.ts` | SDK contract |
| Answer mapping verbatim + env model default | `typesafeProvider.test.ts` | Provider parity |
| Error rethrow (never swallow) | `typesafeProvider.test.ts` | Error handling |
| Mock deterministic answers | `layaProvider.test.ts` | Contained stub |
| Weighted composite + gate-per-factor | `decisionFusion.test.ts` | POC A logic |
| Engine-off passthrough (allowed, no call) | `swingAutoSeedService.test.ts` | B flag-gating |

### Route Tests

| Test | What It Verifies |
|------|------------------|
| 401 unauthenticated | Admin auth |
| 400 invalid body | Zod validation |
| 503 disabled | Inert default |
| 200 with mock provider | Happy path + contract |

### E2E (Admin panel)

| Test | What It Verifies |
|------|------------------|
| States render (loading/empty/error/data) | Component completeness |
| Mobile 375px + dark mode | Responsive/theme |

---

## Verification Checklist

```bash
npx tsc --noEmit          # 0 new errors (baseline: 46)
npm run test              # all pass (incl. new decision suites)
npm run lint              # 0 errors
npm run quickbuild        # 185/185 pages
npm run test:e2e          # admin decision spec (if UI landed)
```

---

## Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| Jev hosted dependency (cost/latency/key) | `DECISION_PROVIDER=none` default; feature flag; failover to Laya; call caps | No |
| Laya runtime unverified | Blocking spike (`scripts/spike-laya/`) before real provider; mock shipped first | Spike only |
| SDK v0.6.0 breaking `Score.criteria` ordered tuple | Tests pin exact mapping; mocked SDK in tests | No |
| Plan-limit pressure (P6003) | No new Prisma models in POC; audit-tags only | `DecisionLog` models |
| Engine adoption (rule/agent paths untouched) | `DECISION_POC_ENABLED=false` off-by-default; rollback = remove env | No |
| Secrets leak risk | Key env-only, never logged, never in client, `.env.example` placeholders | No |

---

## Documentation Checklist

- [ ] **AGENTS.md** — version row in table
- [ ] **CHANGELOG** — `.agents/changelog/versions-v3.41.md` detail + index update
- [ ] **TODO.md** — quick-reference row
- [ ] **Primer.md** — current project status
- [ ] **agent-memory.md** — activity log entry
- [ ] **Lessons.md** — new lesson (if pattern/bug discovered)
- [ ] **Session memory** — `decisions.md` + `flow.md` + spec/plan refs
- [ ] **session-todos.md** — current session updated
- [ ] **handoffs/active/latest.md** — resume context
- [ ] **GitHub wiki** — Jev + decision-engine page

---

## Pre-Commit Gate

1. `npx tsc --noEmit` — 0 new errors
2. `npm run test` — all pass
3. `npm run lint` — no warnings
4. `git status` — no junk artifacts, no secrets in diff (esp. `TYPESAFE_API_KEY`/smoke-test scratch)
5. Documentation updated per checklist above
6. Engineering checklist (`.agents/rules/checklist.md`) validated
7. Permission gates (§0) — all explicitly approved by user