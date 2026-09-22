# Spec Document — 16. Decision Engine (Laya + Jev, ph22)

> **Feature**: Decision engine — provider-agnostic "System One" judgment layer (Choice/Score/Noul) with confidence-gated routing.
> **Design doc**: `docs/designDoc/ph22-laya-decision-engine-design.md` · **Durable memory**: `memory.md` §2–§4 · **Jev reference**: `docs/jev.md` · **Integration guide**: `docs/jev-tradenext-integration.md`
> **Status**: DRAFT — **requires human review + approval before implementation** (spec-driven-development gate).
> **⚠️ Sensitive ops inside spec (explicit permission required)**: `npm install @typesafe-ai/sdk`, setting `TYPESAFE_API_KEY`, live `POST /v1/systemone` smoke test.

---

## 1. Overview

**What**: A new server-side `lib/services/decision/` package that turns a **state** + **atomic questions** into **typed answers** (`choice` / `score` / `noul`) with calibrated probabilities + confidence — then routes on confidence (ACT / REVIEW / ESCALATE). Two providers behind one interface: **Laya** (`convaiinnovations/laya`, Apache-2.0, local — free/offline) and **Jev** (TypeSafe AI hosted API `POST https://api.typesafe.ai/v1/systemone`, via `@typesafe-ai/sdk` v0.6.0). Shipped default `DECISION_PROVIDER=none` keeps the engine **inert** until enabled.

**Why**: TradeNext's classification today is either hardcoded rules (cheap, brittle) or full OpenRouter text-generative agent calls (expensive, slow, text-y). A System One judgment layer fills the middle band: ~ms, calibrated-probability decisions for screener rank fusion, Swing AI validity gatechecks, alert guardrails, and recommendation checks — audited, feature-flag-controlled, zero schema pressure (P6003 plan-limit discipline).

**Scope**:
- **IN**: engine core (`types/provider/layaProvider/typesafeProvider/client/gate`), confidence-gated routing, env flags (inert default), audit tags, admin debug routes + panel, POC wiring A (screener composite scoring) + B (Swing AI gatecheck), full unit-test coverage, OpenAPI entries.
- **OUT (explicitly deferred)**: Laya local-inference runtime (**blocking spike first** — see §6/§11), new public UI surfaces (review queue), optional `DecisionLog`/`DecisionQuestion` Prisma models, Jev free-vs-paid key provisioning docs.

**Depends on**: `Plan 15` (`lib/services/swingAutoSeedService.ts` — auto-generate-once exists) for POC B; existing screener engine + `lib/audit.ts`. Nothing else new.

---

## 2. Routes

### New Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/decision/evaluate` | admin (fallback demo) | Run `{ state, questions[] }` through configured provider; returns typed answers + confidence + gate |
| POST | `/api/admin/decision/ping` | admin | Provider health + round-trip diagnostic (Laya load, TypeSafe key check) |

### Modified Routes

None. (Screener `optimize`/scan paths and Swing AI routes consume `lib/services/decision/*` internally — no public surface change.)

---

## 3. Database Schema

### A. New Models

**NONE in POC.** Stateless judgments — audit-log metadata JSON only.

> Justification (template N/A rule): P6003 plan-limit discipline; `DecisionLog`/`DecisionQuestion` add-only models are deferred until a REVIEW queue requires persistence. Any future model: add-only, TTL-pruned, `@@index([createdAt])`, never in the write-hot path.

### B. Modifications to Existing Models

None.

### C. Migration Notes

None required. `lib/audit.ts` gains new **action types** (not DB models):
- `DECISION_EVALUATED` — state-hash, answers, confidence, provider, latencyMs
- `DECISION_PROVIDER_FALLBACK` — failover event
- `DECISION_GATE` — per-question gate outcome (act/review/escalate)

---

## 4. Functions to Implement

### A. `lib/services/decision/types.ts`

```ts
export type DecisionPrimitive = "choice" | "score" | "noul";

export interface ChoiceQ { type: "choice"; name: string; options: string[]; instruction?: string; statePath?: string; }
export interface ScoreQ  { type: "score"; name: string; criteria: string[]; instruction?: string; statePath?: string; } // criteria = ORDERED tuple (SDK v0.6.0)
export interface NoulQ   { type: "noul"; name: string; instruction?: string; statePath?: string; }
export type DecisionQuestion = ChoiceQ | ScoreQ | NoulQ;

export interface ChoiceAnswer { choice: string; probabilities: number[]; confidence: number; }
export interface ScoreAnswer  { score: number; probabilities: number[]; confidence: number; }
export interface NoulAnswer   { noul: number; }
export type DecisionAnswer = ChoiceAnswer | ScoreAnswer | NoulAnswer;

export interface EvaluateRequest { state: unknown; questions: DecisionQuestion[]; model?: string; }
export interface EvaluateResponse { answers: Record<string, DecisionAnswer>; provider: string; model: string; latencyMs: number; }
```

### B. `lib/services/decision/provider.ts`

#### `interface DecisionProvider`
- `readonly provider: string` — `"typesafe"` | `"laya"`
- `evaluate(req: EvaluateRequest): Promise<EvaluateResponse>` — never throws typed-shaped partials; throws on transport/provider failure (client owns retry/failover)
- `health(): Promise<{ ok: boolean; detail?: string }>` — provider liveness probe

### C. `lib/services/decision/typesafeProvider.ts`

#### `class TypeSafeProvider implements DecisionProvider`
- Wraps `@typesafe-ai/sdk` (v0.6.0): `new TypeSafeClient()` (reads `TYPESAFE_*` env), `client.systemOne({ state, questions })`.
- Maps SDK questions: `choice({name, options})`, `score({name, criteria})`, `noul({name})` — **criteria passed as ordered tuple**.
- Model default: `process.env.TYPESAFE_DEFAULT_MODEL || "jev-latest"`.
- Returns `EvaluateResponse` with `provider: "typesafe"`, `latencyMs` (performance.now timing), SDK `answers` mapped verbatim onto `DecisionAnswer` (shapes already match).
- Errors: log via `@/lib/logger` w/ context, rethrow — **never swallow**.
- `health()`: `client.models.list()`.

### D. `lib/services/decision/layaProvider.ts`

#### `class LayaProvider implements DecisionProvider`
- **BLOCKED on spike** (see §6): real inference path (transformers.js / ONNX runtime / Python sidecar) must be prototyped in `scripts/spike-laya/` first — decide before full build.
- Before spike: class skeleton + **mock** mode for tests (`provider: "laya-mock"`), same interface contract.
- After spike: wraps chosen runtime; same `evaluate`/`health` contract; local, free, offline.

### E. `lib/services/decision/client.ts`

#### `createDecisionClient(): DecisionClient`
- `provider(): string` — `"none"` | `"laya"` | `"typesafe"` | `"laya|typesafe"` (joined)
- `evaluate(req: EvaluateRequest): Promise<EvaluateResponse | null>` — `null` when disabled (`DECISION_PROVIDER=none`)
- Selection from env `DECISION_PROVIDER`:
  - `none` → no providers; `evaluate()` returns `null` (engine inert — **default**)
  - `typesafe` → `[TypeSafeProvider]`
  - `laya` → `[LayaProvider]`
  - `auto` → `[LayaProvider, TypeSafeProvider]` — try primary, **failover** to next on error
- Per-provider retry: ≤3 attempts, exponential backoff (250/500/1000 ms).
- Failover audit: `DECISION_PROVIDER_FALLBACK` tag (from-provider, to-provider, error).
- Latency captured per call; total included in final `EvaluateResponse.latencyMs`.

#### `decide(confidence: number, risk: Risk): Gate` (in `gate.ts`)
- `Risk = "read-only" | "moderate" | "destructive"`
- Thresholds table: `read-only {act:0.55, review:0.35}` · `moderate {act:0.75, review:0.50}` · `destructive {act:0.90, review:0.70}`
- Returns `"act" | "review" | "escalate"`:
  - `confidence >= act` → `act`
  - `confidence >= review` → `review`
  - else → `escalate`

### F. POC A — screener composite scoring (pure helpers in `lib/services/decision/fusion.ts`)

#### `scoreCandidate(state, rubric): number`
- Weighted sum of N `score` answers: `composite = Σ wᵢ·scoreᵢ` (weights per rubric, configurable const).
- Per-factor gate via `decide(conf, "read-only")`.

### G. POC B — Swing AI gatecheck (`lib/services/swingAutoSeedService.ts` — MODIFIED)

#### `gateAutoGenerate(): Promise<{ allowed: boolean; gate: Gate }>`
- One request: `noul` "Is it valid to auto-generate AI targets now?" + `choice` regime `["trending","choppy","uncertain"]`.
- `moderate` risk: `noul >= 0.75` AND choice bias toward `trending` → `allowed: true`; else REVIEW; else skip (audited NO-OP).
- **Gated behind `DECISION_POC_ENABLED=true`** — default off; Plan 15 seed-once behavior unchanged when engine off.

---

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/services/decision/types.ts` | **Created** | Shared primitives + request/response types |
| `lib/services/decision/provider.ts` | **Created** | `DecisionProvider` interface |
| `lib/services/decision/typesafeProvider.ts` | **Created** | Jev via `@typesafe-ai/sdk` |
| `lib/services/decision/layaProvider.ts` | **Created** | Laya wrapper (spike-gated; mock first) |
| `lib/services/decision/client.ts` | **Created** | Factory + failover + retry/backoff |
| `lib/services/decision/gate.ts` | **Created** | `decide()` thresholds |
| `lib/services/decision/fusion.ts` | **Created** | POC A weighted-rank helpers |
| `lib/services/swingAutoSeedService.ts` | Modified | POC B `gateAutoGenerate()` hook (flag-gated) |
| `lib/screener-engine.ts` (or screener orchestrator) | Modified | POC A optional rank-fusion hook (flag-gated) |
| `lib/audit.ts` | Modified | `DECISION_EVALUATED`, `DECISION_PROVIDER_FALLBACK`, `DECISION_GATE` |
| `app/api/decision/evaluate/route.ts` | **Created** | POC debug route (admin) |
| `app/api/admin/decision/ping/route.ts` | **Created** | Provider health route |
| `app/admin/decision/page.tsx` | **Created** | Admin decision panel |
| `app/api/openapi/route.ts` | Modified | Swagger entries for both routes |
| `.env.example` | Modified | `TYPESAFE_*`, `DECISION_PROVIDER`, `DECISION_POC_ENABLED` (placeholders only) |
| `lib/__tests__/decisionGate.test.ts` | **Created** | Tests |
| `lib/__tests__/decisionClient.test.ts` | **Created** | Tests |
| `lib/__tests__/typesafeProvider.test.ts` | **Created** | Tests |
| `lib/__tests__/layaProvider.test.ts` | **Created** | Tests |
| `lib/__tests__/decisionFusion.test.ts` | **Created** | Tests |
| `lib/__tests__/swingAutoSeedService.test.ts` | Modified | POC B gate checks |
| `scripts/spike-laya/` | **Created** | Laya runtime spike (BLOCKING for layaProvider) |

**NOT created in POC**: new Prisma models, public review-queue UI, `DecisionLog` persistence.

---

## 6. Dependencies

### New Packages

| Package | Version | Reason | Permission |
|---------|---------|--------|------------|
| `@typesafe-ai/sdk` | ~0.6.0 | TypeSafe Jev client (Node 20+, ESM/CJS/TS) | ⚠️ **user permission required before install** |
| Laya runtime (TBD) | TBD | From spike verdict (transformers.js / onnxruntime-node / sidecar) | BLOCKED on spike + permission |

### Internal Dependencies

| Module | Function Used | Purpose |
|--------|---------------|---------|
| `@/lib/logger` | `logger.info/warn/error` | Structured logging (pino) |
| `@/lib/audit` | `audit()` | Decision audit trail |
| `@/lib/sqlite` (write-behind) | `enqueueWriteBehind` | Audit promotion discipline (if relevant) |

### Environment

| Var | Default | Meaning |
|-----|---------|---------|
| `DECISION_PROVIDER` | `none` | `none\|laya\|typesafe\|auto` — `none` = inert |
| `DECISION_POC_ENABLED` | `false` | Enable POC A/B wiring |
| `TYPESAFE_API_KEY` | — | Server-only; console.typesafe.ai |
| `TYPESAFE_BASE_URL` | `https://api.typesafe.ai` | SDK default |
| `TYPESAFE_DEFAULT_MODEL` | `jev-latest` | SDK default |
| `TYPESAFE_LOG_LEVEL` | `warn` | SDK default |

---

## 7. API Contract

### POST /api/decision/evaluate

**Auth**: admin session (fallback demo per repo pattern) · **Runtime**: `nodejs` (SDK + env) · **Body**:
```typescript
{
  state: unknown,                          // string | JSON | array — shared decision context
  questions: DecisionQuestion[],           // 1..N atomic questions (fan-out)
  model?: string                           // optional override
}
```
**Response (200):**
```json
{
  "success": true,
  "data": {
    "answers": { "bias": { "choice": "bullish", "probabilities": [0.62, 0.24, 0.14], "confidence": 0.71 } },
    "provider": "typesafe",
    "model": "jev-latest",
    "latencyMs": 214
  }
}
```
**Response (400):** zod validation failure `{ "success": false, "error": "…" }`
**Response (503):** provider disabled (`DECISION_PROVIDER=none`) or all providers failing — `{ "success": false, "error": "Decision engine disabled" }`

### POST /api/admin/decision/ping

**Auth**: admin · **Response (200):**
```json
{ "success": true, "data": { "provider": "typesafe", "ok": true, "detail": "models.list() ok", "mode": "typesafe" } }
```

---

## 8. UI/UX Requirements

### Components (admin only, POC scope)

| Component | Location | Purpose |
|-----------|----------|---------|
| `DecisionPanel` (inline in page) | `app/admin/decision/page.tsx` | Provider selector (none/laya/typesafe/auto), health ping button, last-evaluations table |

### States

- **Loading**: skeleton rows for the evaluations table
- **Empty**: "No evaluations yet — configure a provider and run a test"
- **Error**: provider unreachable → red banner + retry (calls ping route)
- **Data**: table of last N evaluations — state-hash, answers summary, confidence, gate, provider, latencyMs

### Responsive

- Desktop (1440px): full table · Tablet (768px): stacked cards · Mobile (375px): horizontal scroll on table, selector stacked

### Dark mode

- Tailwind theme tokens only (no hardcoded colors)

---

## 9. Rules & Guardrails

- [x] No Prisma in client components (engine is server-only)
- [x] API routes touching SDK MUST `export const runtime = "nodejs"`
- [x] `TYPESAFE_API_KEY` never in client, never in logs, never in `NEXT_PUBLIC_*`, never committed
- [x] All external inputs validated via Zod (evaluate route body)
- [x] Errors return safe defaults / clean 503 — never expose internal provider errors
- [x] Logging via `@/lib/logger` only (no `console.log`)
- [x] Fire-and-forget background wiring (POC A/B) never blocks HTTP response
- [x] Audit trail for every evaluation (state-hash, answers, confidence, provider, latency)
- [x] Feature-flag discipline: engine **inert by default**; POC wiring behind `DECISION_POC_ENABLED`
- [x] Failover retry ≤3 exp backoff; audit `DECISION_PROVIDER_FALLBACK`
- [x] No destructive DB ops; no schema changes in POC
- [ ] ~~Migration~~ — N/A (no schema change)

---

## 10. Expected Behavior

1. `createDecisionClient()` with `DECISION_PROVIDER=none` returns a client whose `evaluate()` resolves `null` — engine inert, zero provider constructed.
2. `DECISION_PROVIDER=typesafe` + valid key → `evaluate({ state, questions })` returns typed answers for each question, `provider: "typesafe"`, `latencyMs >= 0`.
3. Score question returns non-integer `score` (e.g. `2.3`) when rubric allows it (SDK/ordered-tuple semantics preserved).
4. `decide(0.80, "moderate")` → `"act"`; `decide(0.60, "moderate")` → `"review"`; `decide(0.20, "moderate")` → `"escalate"` (per §4.E thresholds).
5. Primary provider throws → retry ≤3 → failover to secondary → `DECISION_PROVIDER_FALLBACK` audited → answer returned from secondary.
6. All providers fail → `evaluate()` throws; caller falls back to existing rule-based path (rolled out per §rollout).
7. Laya mock provider (`provider: "laya-mock"`) returns deterministic answers for tests without any runtime installed.
8. `gateAutoGenerate()` with engine off (`DECISION_POC_ENABLED=false`) returns `allowed: true` without calling any provider (Plan 15 behavior unchanged).
9. API `POST /api/decision/evaluate` without admin session → 401; invalid body → 400; disabled engine → 503.
10. Admin panel renders all four states; mobile 375px no horizontal page overflow.

---

## 11. Error Handling

| Scenario | Behavior | Log Level |
|----------|----------|-----------|
| `DECISION_PROVIDER=none` + evaluate called | Route returns 503 "Decision engine disabled"; service callers get `null` | `info` |
| Jev transport error / timeout | Retry ≤3 (250/500/1000 ms) → failover (auto) → rethrow last error | `error` |
| Invalid `TYPESAFE_API_KEY` (401) | `health()` reports `{ok:false, detail}`; ping route shows it; no retry storm (circuit-ish backoff) | `warn` |
| Invalid evaluate body | Zod 400 before provider call | `warn` |
| Laya runtime missing (spike not landed) | Provider not registered for `laya`/`auto`; config error logged once; falls back to `none` behavior | `warn` |
| Malformed provider answers | Type-guard per primitive; skip malformed question, audit `DECISION_EVALUATED` w/ partial flag | `error` |

---

## 12. Test Strategy

### Unit Tests (`lib/__tests__/`)

| File | Cases |
|------|-------|
| `decisionGate.test.ts` | confidence shaping (uniform→0, one-hot→1); risk scaling; exact ACT/REVIEW/ESCALATE boundaries |
| `decisionClient.test.ts` | `none` → inert (`null`); provider selection per env; failover on primary error; retry/backoff counts; latency capture; unknown provider → warns + inert |
| `typesafeProvider.test.ts` | mocked `TypeSafeClient`: request shape (state/questions mapping incl. ordered criteria), answer mapping verbatim, env-model default, error rethrow |
| `layaProvider.test.ts` | mock runtime: deterministic answers, interface parity, contract types |
| `decisionFusion.test.ts` | weighted composite computation; gate-per-factor output; empty rubric → 0 |
| `swingAutoSeedService.test.ts` (modified) | POC B: engine-off → allowed (no provider call); `noul≥0.75`+trending → allowed; else review/skip; audited NO-OP |

### Integration / Route Tests

- `POST /api/decision/evaluate`: 401 unauthenticated, 400 invalid body, 503 disabled, 200 happy path (mock provider injected via env)
- `POST /api/admin/decision/ping`: auth + provider ok/fail shapes

### E2E (`e2e/`, admin panel)

- Panel renders selector, empty state, error retry, data table · responsive 375px · dark mode

### Spike (separate gate)

- `scripts/spike-laya/` — verdict doc (runtime choice, latency, memory, model load) reviewed before `layaProvider` implementation allowed.

---

## 13. Performance Considerations

- **Latency**: hosted Jev round-trip dominates — questions fan out in ONE request (speculative fan-out), never N sequential calls.
- **Retry budget**: ≤3/backoff defeats transient spikes without hammering provider.
- **Caching**: engine stateless; repeated identical (stateHash, questions) may be memoized in `node-cache` 300s TTL when `DECISION_POC_ENABLED` (defer until measured).
- **DB plan pressure**: zero Prisma ops in POC (audit tags via existing audit path).
- **Startup**: Laya model load (if spike lands) deferred/lazy — never blocks server boot; feature-flag hot-swap.

---

## 14. Security Considerations

- **Auth**: both routes admin-only (existing admin middleware pattern; demo fallback consistent with repo).
- **Input**: Zod-validated body; question count cap (e.g. ≤10) + state size cap (e.g. ≤16 KB) to bound abuse.
- **Secrets**: `TYPESAFE_API_KEY` env-only; never logged (logger redaction rules); never in client bundle.
- **SSRF/abuse**: provider base URL env-fixed; no user-controlled URLs.
- **RBAC**: engine services internal — never exposed to non-admin surfaces in POC.

---

## 15. Definition of Done

- [ ] All functions implemented per §4
- [ ] All files created/modified per §5
- [ ] Routes working per §2 + contracts in §7 (401/400/503/200 verified)
- [ ] `DECISION_PROVIDER=none` default verified inert (no provider constructed)
- [ ] Mock Laya provider deterministic; real Laya provider gated on spike verdict
- [ ] Failover + retry/backoff verified + `DECISION_PROVIDER_FALLBACK` audited
- [ ] `lib/audit.ts` actions added
- [ ] `npx tsc --noEmit` passes (0 new errors beyond baseline 46)
- [ ] `npm run lint` passes
- [ ] Unit tests per §12 all passing (`npm run test`)
- [ ] POC A + B wired behind `DECISION_POC_ENABLED`; Plan 15 unchanged when off
- [ ] Admin panel states (loading/empty/error/data) + responsive 375/768/1440 + dark mode
- [ ] Swagger/OpenAPI updated
- [ ] `.env.example` documents all new vars (placeholders, no secrets)
- [ ] Documentation updated (AGENTS.md, CHANGELOG, TODO, Primer, agent-memory, Lessons, session memory)
- [ ] GitHub wiki updated (Jev + decision-engine page)
- [ ] User-approval gates honored: SDK install, API key, live smoke test, this spec + plan
- [ ] Live-verified on :3000 (admin panel) — 0 console errors