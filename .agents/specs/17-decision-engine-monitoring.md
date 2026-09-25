# Spec Document — Decision Engine Performance Tracing (AI Monitoring section)

> Epic: ph22 Decision Engine (spec 16). Follow-up feature adding observability for the engine.
> Save to `.agents/specs/17-decision-engine-monitoring.md`

## 1. Overview

**What**: Add a "Decision Engine" section to the AI Monitoring admin page (`/admin/utils/ai-monitoring`) that traces the performance of the decision engine from `lib/services/decision/` — evaluation latency, retry attempts, provider, question types, inert/error states, and gate outcomes (POC A screener scoring + POC B swing autoseed gate).

**Why**: v3.41.0 shipped the engine core (Laya-only mock) + POC A/B with **zero observability**. Admins cannot see whether evaluations happen, how long they take, whether retries/errors occur, or what gates were emitted. The AI Monitoring page already has the exact pattern needed (ring buffer + stats + admin API + tabbed UI); the decision engine is currently a black box next to it.

**Scope**:
- IN: new `lib/services/decision/monitoring.ts` (in-memory ring buffer + stats, mirroring `ai-monitoring.ts`); instrumentation in `decision/client.ts` (evaluate + ping) and the POC A (screener scoring) / POC B (swing autoseed gate) call sites; new admin API `GET/DELETE /api/admin/decision/monitoring`; "Decision Engine" tab in `app/admin/utils/ai-monitoring/page.tsx`; OpenAPI doc; unit tests.
- OUT of scope (deferred): DB/SQLite persistence of decision traces (the engine is a mock; persistence lands with the real Laya provider / P1–P6). Prisma schema changes. Any change to decision semantics or existing runtime behavior. Instrumenting the spike (`scripts/spike-laya/`).

**Depends on**: v3.41.0 `lib/services/decision/` (types, provider, gate, fusion, client) + existing `/admin/utils/ai-monitoring` page + `/api/admin/ai/monitoring` route pattern.

---

## 2. Routes

### New Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/decision/monitoring` | admin | `type=stats` → decision engine stats; `type=traces` → recent decision traces. Query: `limit` (default 50, max 500), `timeframe` (minutes, default 60, max 1440) |
| DELETE | `/api/admin/decision/monitoring` | admin | Clear the in-memory decision trace buffer |

### Modified Routes

| Method | Path | Change |
|--------|------|--------|
| GET | `/api/openapi` | New paths documented under tag `Decision Engine` |

---

## 3. Database Schema

**No schema changes** — traces are in-memory only (mock engine; persistence deferred). No migration, no `prisma generate`.

---

## 4. Functions to Implement

### A. `lib/services/decision/monitoring.ts` (NEW)

#### `interface DecisionTraceEntry`

```typescript
interface DecisionTraceEntry {
  timestamp: string;          // ISO
  kind: "evaluate" | "ping" | "poc-a-screener" | "poc-b-autoseed-gate";
  mode: "none" | "laya";      // resolved provider mode
  provider?: string;          // e.g. "laya-mock"
  status: "success" | "error" | "inert";
  latencyMs: number;
  attempts?: number;          // evaluate retry attempts used (1..4)
  error?: string;             // on error
  questionCount?: number;     // for evaluate
  questionTypes?: string[];   // unique question types evaluated e.g. ["choice","noul"]
  gate?: "act" | "review" | "escalate";       // POC A / POC B outcome
  reason?: string;            // gate reason / detail
  scoredCount?: number;       // POC A results scored
  gateDistribution?: { act: number; review: number; escalate: number }; // POC A pass
  noulAmount?: number;        // POC B threshold read
  allowed?: boolean;          // POC B gate decision
}
```

#### `trackDecisionTrace(entry: DecisionTraceEntry): void`

- Push to global in-memory ring buffer (`global._decisionTraces`, max 500 entries, trim from head).
- Never throws; bare `try/catch` around push is unnecessary (pure memory op) but entry is used as-is.
- Mirror `ai-monitoring.ts` structure (declare global, `getBuffer()`, `MAX_CALLS`).

#### `getDecisionTraces(limit = 50): DecisionTraceEntry[]`

- Return `buffer.slice(-limit).reverse()` (newest first).

#### `getDecisionStats(timeframeMinutes = 60): DecisionStats`

Aggregate over buffer filtered by `timestamp > now - timeframe`:
- `totalTraces`, `successCount`, `errorCount`, `inertCount`, `successRate`
- `avgLatencyMs`
- `avgAttempts` (over evaluate traces)
- `totalQuestionsEvaluated`, `totalGatesEmitted`
- `tracesByKind: Record<kind, number>`
- `tracesByProvider: Record<string, number>`
- `tracesByGate: Record<gate, number>`
- `recentErrors: DecisionTraceEntry[]` (last 5)
- `timeframeMinutes`

#### `clearDecisionTraces(): void`

- `global._decisionTraces = []`

### B. `lib/services/decision/client.ts` (MODIFIED)

#### `evaluateWithRetry(...)` — return attempts

- Change return to `{ response, latencyMs, attempts }` (attempts = loop index+1 on success).

#### `evaluate(req)` — record trace

- Wrap the provider-chain loop in `try/catch/finally`:
  - **inert** (`providers.length === 0`): `trackDecisionTrace({ kind: "evaluate", mode, provider: undefined, status: "inert", latencyMs: 0, questionCount: req.questions.length, questionTypes: uniqueTypes })` — admins can see the engine is off.
  - **success**: `trackDecisionTrace({ kind: "evaluate", mode, provider, status: "success", latencyMs, attempts, questionCount, questionTypes })` using the winning attempt's latency + attempts.
  - **failure** (all providers exhausted): `trackDecisionTrace({ kind: "evaluate", mode, provider: providers.map(p=>p.provider).join(","), status: "error", latencyMs: elapsed, attempts: totalAttempts, error })` then rethrow original behavior unchanged.
- Import `trackDecisionTrace` from `./monitoring` (no circular import — monitoring.ts imports nothing from client).

#### `ping()` — record trace

- After resolving health: `trackDecisionTrace({ kind: "ping", mode, provider: providers.join(",") || undefined, status: "success", latencyMs })`.
- On any throw from `p.health()`: still resolve (existing behavior) — record status `success` with detail, or a single `error` trace if the whole ping throws. Keep existing return contract identical.

### C. POC A — `app/services/chartinkUnifiedScreenerService.ts` (MODIFIED)

In the existing POC A block (lines ~445–469, inside the `DECISION_POC_ENABLED === "true"` scoring loop), **after** the loop completes:
- Compute `gateDistribution` from the results scored (`r.decisionGate` values).
- `trackDecisionTrace({ kind: "poc-a-screener", mode, provider: "local", status: "success", latencyMs: elapsed, scoredCount, gateDistribution })`.
- Wrap the trace call in the **existing** try/catch so a trace bug can never break scoring (the whole scoring block is already non-fatal).

### D. POC B — `app/services/swingAutoSeedService.ts` (MODIFIED)

In the `gateAutoGenerate()` POC B section (where `AUTOSEED_NOUL` / `AUTOSEED_REGIME` gate is decided):
- Record one trace per gate decision: `{ kind: "poc-b-autoseed-gate", mode, provider: "laya-mock", status: "success", latencyMs, gate: outcome.gate, reason: outcome.reason, noulAmount: noul, allowed: outcome.allowed }`.
- Non-fatal `try/catch` — existing graceful allow/rollback behavior unchanged.

---

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/services/decision/monitoring.ts` | **Created** | Ring buffer + stats + clear |
| `lib/services/decision/client.ts` | Modified | evaluate/ping trace instrumentation + attempts in retry result |
| `lib/services/chartinkUnifiedScreenerService.ts` | Modified | POC A pass aggregate trace |
| `lib/services/swingAutoSeedService.ts` | Modified | POC B gate trace |
| `app/api/admin/decision/monitoring/route.ts` | **Created** | GET stats/traces + DELETE clear (admin, nodejs runtime) |
| `app/api/openapi/route.ts` | Modified | Document new route under `Decision Engine` tag |
| `app/admin/utils/ai-monitoring/page.tsx` | Modified | Add "Decision Engine" tab (stat cards + breakdowns + trace rows) reusing `StatCard`/`BreakdownBar` |
| `lib/__tests__/decisionMonitoring.test.ts` | **Created** | Unit tests |

---

## 6. Dependencies

### New Packages

| Package | Version | Reason |
|---------|---------|--------|
| None | — | — |

### Internal Dependencies

| Module | Function Used | Purpose |
|--------|---------------|---------|
| `@/lib/services/decision/monitoring` | `trackDecisionTrace`, `getDecisionTraces`, `getDecisionStats`, `clearDecisionTraces` | Observability |
| `@/lib/auth` | `auth()` | Admin guard |
| `@/lib/logger` | `logger.error/debug` | Logging (no console.log) |

---

## 7. API Contract

### GET /api/admin/decision/monitoring

**Query Params:**
```typescript
{ type: "stats" | "traces"; limit?: number; timeframe?: number }
```
- `limit` clamped 1–500 (default 50); `timeframe` clamped 1–1440 (default 60).

**Response (200, `type=stats`):**
```json
{
  "stats": {
    "totalTraces": 12,
    "successCount": 11,
    "errorCount": 1,
    "inertCount": 0,
    "successRate": 92,
    "avgLatencyMs": 24,
    "avgAttempts": 1.1,
    "totalQuestionsEvaluated": 18,
    "totalGatesEmitted": 5,
    "tracesByKind": { "evaluate": 6, "ping": 2, "poc-a-screener": 2, "poc-b-autoseed-gate": 2 },
    "tracesByProvider": { "laya-mock": 10, "local": 2 },
    "tracesByGate": { "act": 2, "review": 1, "escalate": 2 },
    "recentErrors": [],
    "timeframeMinutes": 60
  }
}
```

**Response (200, `type=traces`):**
```json
{
  "traces": [
    {
      "timestamp": "2026-09-24T09:30:00.000Z",
      "kind": "evaluate",
      "mode": "laya",
      "provider": "laya-mock",
      "status": "success",
      "latencyMs": 25,
      "attempts": 1,
      "questionCount": 2,
      "questionTypes": ["choice", "noul"]
    }
  ],
  "total": 1
}
```

**Response (401):** `{ "error": "Unauthorized" }` (non-admin)
**Response (500):** `{ "error": "Failed to fetch decision monitoring data" }`

### DELETE /api/admin/decision/monitoring

**Response (200):** `{ "success": true, "message": "Decision trace buffer cleared" }`

---

## 8. UI/UX Requirements

### Components

Reuse existing `StatCard` and `BreakdownBar` in `app/admin/utils/ai-monitoring/page.tsx`; add one new local component `DecisionTraceRow` (mirror `CallRow` — status pill, expandable error/detail).

### Placement

Add a third tab "Decision Engine" in the existing tab bar (`Breakdown` / `Recent Calls` / **Decision Engine**). Tab content:
- **Stat cards grid** (6): Total Traces · Success Rate · Avg Latency · Avg Attempts · Questions Evaluated · Gates Emitted
- **Breakdowns row** (3 cols): Traces by Kind · Traces by Provider · Traces by Gate
- **Recent decision traces list** (expandable rows): kind, provider, status pill, latency, attempts, question count/types, timestamp; expanded shows error or gate/reason detail

### States

- **Loading**: reuse existing skeleton grid
- **Empty**: "No decision traces recorded yet. Run an evaluation via /api/decision/evaluate or a POC to generate traces."
- **Error**: existing error banner via `setError`
- **Data**: cards + breakdowns + rows

### Responsive

- Desktop (1440px): full grid
- Tablet (768px): 3-col → stacked
- Mobile (375px): single column; trace rows stack; breakdown bars truncate

### Data flow

`fetchData()` adds a parallel fetch to `/api/admin/decision/monitoring?type=stats&timeframe=${timeframe}` and `/api/admin/decision/monitoring?type=traces&limit=100`; store in new state (`decisionStats`, `decisionTraces`); auto-refresh every 30s already covered by existing interval; add "Clear decision traces" button beside "Clear Buffer" (DELETE call, then refetch).

---

## 9. Rules & Guardrails

- [ ] No Prisma in client components (traces are read server-side via API only)
- [ ] Admin routes protected via `auth()` role check (mirror `/api/admin/ai/monitoring`)
- [ ] `export const runtime = "nodejs"` on the new route
- [ ] In-memory only — **zero Prisma ops** (plan-limit discipline; no write-behind)
- [ ] Instrumentation never alters runtime behavior — traces are fire-and-forget, all call sites wrapped in existing/try-catch
- [ ] Logging via `@/lib/logger` only (no `console.log`)
- [ ] Errors return safe defaults; trace recording never throws into callers
- [ ] No schema change → no migration
- [ ] Zod-style input validation via explicit clamping in the route (mirrors existing route pattern)

---

## 10. Expected Behavior

1. `trackDecisionTrace({...})` appends to the ring buffer; buffer trimmed to 500.
2. `getDecisionTraces(50)` returns newest-first, ≤ limit entries.
3. `getDecisionStats(60)` aggregates only traces within the last 60 minutes.
4. `clearDecisionTraces()` empties the buffer.
5. `client.evaluate()` (laya mode, success) records a `success` trace with the winning attempt's `latencyMs` + `attempts` (1 on first try).
6. `client.evaluate()` (mode none) records an `inert` trace with `provider: undefined`.
7. `client.evaluate()` (all providers throw) records an `error` trace then rethrows (existing behavior preserved).
8. POC A screener pass records one `poc-a-screener` trace with `scoredCount` + `gateDistribution`.
9. POC B `gateAutoGenerate()` records one `poc-b-autoseed-gate` trace per decision with `gate`/`reason`/`allowed`.
10. `GET /api/admin/decision/monitoring?type=stats` returns the stats contract; `?type=traces` returns traces.
11. `DELETE` clears the buffer; UI "Clear decision traces" refetches.
12. UI: third tab renders cards + breakdowns + rows; empty state when no traces; responsive at 375/768/1440; dark mode matches existing styling.
13. Full regression: `tsc` 46-error baseline unchanged, `npm run lint` 0, existing tests still pass.

---

## 11. Error Handling

| Scenario | Behavior | Log Level |
|----------|----------|-----------|
| Trace records while client throwing | Trace recorded FIRST, then original error rethrown | `debug` (monitoring) |
| Buffer full | Trim from head (oldest dropped) | none |
| Route non-admin | 401 `Unauthorized` | none |
| Route parse failure in stats | Safe empty aggregates (`totalTraces: 0` etc.) | `debug` |
| POC A trace fails | Swallowed by existing try/catch — scoring unaffected | `debug` |
| POC B trace fails | Non-fatal; gate decision unaffected | `debug` |

---

## 12. Test Strategy

### Unit Tests (`lib/__tests__/decisionMonitoring.test.ts`)

- [ ] `trackDecisionTrace` appends + trimming at 500
- [ ] `getDecisionTraces` newest-first + limit
- [ ] `getDecisionStats` aggregation over timeframe (success/error/inert counts, avgLatency, avgAttempts, byKind/byProvider/byGate, recentErrors)
- [ ] `clearDecisionTraces` empties buffer
- [ ] client evaluate (laya, success via `_createDecisionClientWithProviders`) records trace with `attempts` + `latencyMs`
- [ ] client evaluate (none mode via `_resetDecisionClient` + env) records `inert` trace
- [ ] client evaluate (failing provider) records `error` trace + still throws
- [ ] client ping records a trace
- [ ] global buffer isolation between tests (`beforeEach` clear)

---

## 13. Performance Considerations

- **Ring buffer**: max 500 entries, O(1) push/slice — per decision call overhead is nanoseconds.
- **Route**: read-only aggregation over ≤500 entries; no DB, no pagination needed beyond `limit` clamp.
- **No batching needed**: traces are in-memory; zero Prisma ops (plan-limit discipline).

---

## 14. Security Considerations

- **Auth**: route requires admin role via `auth()` (NextAuth), mirrored from `/api/admin/ai/monitoring`.
- **Input**: `limit`/`timeframe` clamped server-side (1–500 / 1–1440) — no Zod dependency needed (matches existing route pattern).
- **Secrets**: none — traces never include prompts/API keys; only question types + counts + gate outcomes.
- **RBAC**: admin-only read/clear.

---

## 15. Definition of Done

- [x] All functions implemented per section 4
- [ ] All files created/modified per section 5
- [ ] All routes working per section 2 + contract in section 7 (curl-verified)
- [ ] No Prisma schema change (in-memory only)
- [ ] Unit tests written and passing (`npm run test`)
- [ ] `npx tsc --noEmit` passes (46-error... 0 new errors beyond baseline)
- [ ] `npm run lint` passes
- [ ] UI states (loading/empty/error/data) all implemented
- [ ] Responsive at 375px, 768px, 1440px
- [ ] Dark/light mode renders correctly
- [ ] Error handling per section 11 (safe defaults, no thrown internals)
- [ ] Documentation updated (AGENTS.md v3.41.1, CHANGELOG, version detail, Primer, agent-memory, session files, handoff)
- [ ] Live-verified on :3000 (UI change — Playwright check of admin page)
- [ ] 0 console errors in browser