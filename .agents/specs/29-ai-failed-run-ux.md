# Spec Document — 29: AI-Failed-Run UX — Never Render a Failed Run as "Today's Picks"

> Spec 29 of branch `fix/daily-rec-swing-cron-worker` (targets v3.49.0). This is fix candidate **#2 (Result)** from the 2026-10-11 recommendations live analysis.

## 1. Overview

**What**: Guarantee that a `failed` / `aiProcessed === 0` run can NEVER be shown to users as "Today's Picks" (the current prod state: a single failed run from 2026-09-04 with 100 raw HOLD rows renders as the "latest", with 0 Buy / 100 Sell / **100 HOLD "showing 0 after filters"**). Instead, the UI must ALWAYS fall back to the last run with real AI verdicts (`aiProcessed > 0`) and surface an explicit "AI unavailable — showing <last good run date>" notice plus a `lastSuccessfulRunDate` in the API.

**Why**: Live-verified on 2026-10-11: `GET /api/recommendations` returns `run: {id:"347d6887-…", runDate:"2026-09-04T09:20:52Z", status:"failed", uniqueStocks:100, aiProcessed:0}` — the failed run IS the run with stocks. `getLatestRecommendations()` (`dailyRecommendationService.ts:1302-1318`) selects `status in [completed, failed] AND uniqueStocks > 0` — a failed run carrying raw screener rows therefore satisfies BOTH predicates and wins the "latest with stocks" query. The v3.11.1 guard (`successfulResults.length === 0 → discard picks`) prevents NEW total-failure runs from being persisted with picks, but (a) runs failed mid-AI before that guard (like 347d6887) and (b) failure paths earlier in the pipeline (`:565-599`, `:851`) keep `uniqueStocks > 0` rows, so the read path alone decides what users see.

**Scope**:
- **IN**: (1) read-path hardening in `getLatestRecommendations()` — the "latest run with stocks" predicate becomes `status = "completed"` (or `status in [completed, failed] AND aiProcessed > 0` — completed is the honest contract; picks with a failed status and no AI verdicts are junk); (2) `lastSuccessfulRunDate` added to the API + UI; (3) an explicit "AI unavailable / showing last good run" notice when the newest overall run is failed (already partially wired — `DailyPicksTab` `aiUnavailable`/`aiUnavailableDate` props exist but the page's parent may pass them inconsistently); (4) a data-only migration/sweep script to **re-mark legacy failed runs with `uniqueStocks > 0 AND aiProcessed = 0`** so they stop shadowing good runs (recommended: set `uniqueStocks = 0` on those rows — the stocks journal is kept, only the pick pivot is zeroed).
- **OUT**: Fixing the AI stage itself (Accelerate connectivity = Spec 28; engine fixes separate); cron scheduling (Spec 30); Google Sheets env (Spec 31); UI restyle of the HOLDs section.

**Depends on**: `getLatestRecommendations` read path (`dailyRecommendationService.ts:1257-1367`), the run persistence guards (`:553-638`), API serialization (`app/api/recommendations/route.ts:102-148`), `DailyPicksTab` notice props, `History/Performance` pivots.

---

## 2. Routes

### New Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/admin/recommendations/repair-failed-runs` | admin | One-shot sweep: zero `uniqueStocks` on legacy `failed AND aiProcessed = 0 AND uniqueStocks > 0` runs, then invalidate caches. Idempotent (no-op on second call). Audit `RECS_REPAIR_FAILED_RUNS`. |

### Modified Routes

| Method | Path | Change |
|--------|------|--------|
| GET | `/api/recommendations` | Response gains `lastSuccessfulRunDate: string \| null` (ISO of newest `completed` run); `run` selects ONLY completed/runs-with-AI runs |
| GET | `/api/recommendations/history` | `runs[]` items gain `aiProcessed` scalar already present? — add if missing (`aiProcessed` exists on the model; ensure serialization includes it + `uniqueStocks`) |

---

## 3. Database Schema

### A. New Model: `None`

No schema change.

### B. Modifications to Existing Models

None. `DailyRecommendationRun` already has `status`, `aiProcessed`, `uniqueStocks`, `errorMessage`, `metadata` (the `aiUnavailable` flag is written as `metadata.aiUnavailable`).

### C. Migration Notes

N/A — no migration. Data-only corrective sweep via the new admin route (`updateMany` on the exact predicate).

---

## 4. Functions to Implement

### A. `lib/services/dailyRecommendationService.ts` (MODIFIED)

#### `getLatestRecommendations` — honest run predicate

- Change the "latest run with stocks" query (`:1302-1318`):
  - `where: { status: { in: ["completed", "failed"] }, uniqueStocks: { gt: 0 } }` → **`where: { status: "completed", uniqueStocks: { gt: 0 }, aiProcessed: { gt: 0 } }`**
  - Rationale: a run is only "Today's Picks" when the AI stage actually produced verdicts. `aiProcessed > 0` is the belt-and-suspenders guard (a completed run with zero AI verdicts is equally junk).
- Keep the `newestRun` query (`:1323-1328`) as-is (any status) — it feeds the `latestRun` notice.
- **Comment** the change with the 2026-10-11 prod finding (failed run 347d6887 shadowing).

#### `getLatestRunFingerprint` — predicate parity

- `:1236-1249` fingerprint query MUST use the same completed-predicate for `runId` (cache-validity depends on the same selection logic).

#### NEW `getLastSuccessfulRunDate(): Promise<string | null>`

- `prisma.dailyRecommendationRun.findFirst({ where: { status: "completed", aiProcessed: { gt: 0 } }, orderBy: { runDate: "desc" }, select: { runDate: true } })` → ISO string or null. Wrapped in the same `isDbUnavailableError` → null guard.
- Note: `latestRun`/`run` already carry `runDate`, and under the new predicate `run` IS the last successful run — the separate helper is needed ONLY when `run` is null but NEWER failed runs exist (e.g. the run subtree changed). The route can derive it from `run?.runDate` and only call the helper as fallback; simpler: route uses `serializedRun.runDate` and the helper is used by `getLatestRecommendations` to set a dedicated `lastSuccessfulRunDate` field. Keep ONE source of truth — see Expected Behavior.

#### NEW `repairFailedRunsWithPicks(): Promise<{ repaired: number }>`

- One-shot corrective sweep for legacy rows (347d6887-class):
  - `prisma.dailyRecommendationRun.updateMany({ where: { status: "failed", aiProcessed: 0, uniqueStocks: { gt: 0 } }, data: { uniqueStocks: 0 } })`
  - **Keep the stocks rows** (journal intact — only the pivot `uniqueStocks` is zeroed so the run stops passing `uniqueStocks > 0` selection).
  - `invalidateRecommendationsCache()` after.
  - Returns `{ repaired }` counts. Never throws (wrap + return `{ repaired: 0 }` + log `error` on failure).
  - **Sparkles**: `metadata.aiUnavailable` unchanged; do NOT touch completed runs.

### B. `app/api/recommendations/route.ts` (MODIFIED)

- Serialization: `serializedRun` unchanged shape, but add `lastSuccessfulRunDate` to the response body:
  - `const lastSuccessfulRunDate = serializedRun?.runDate ?? null;` (under the new predicate `run` IS the last successful run; see C for the service-level field fallback).
- **No other API-shape change** — `stocks`, `latestRun`, `timestamp`, `success` unchanged. This keeps DailyPicksTab contract stable.

### C. `lib/services/dailyRecommendationService.ts` — `LatestRecommendations` interface

- Add `lastSuccessfulRunDate?: string | null` to `LatestRecommendations` (`:75-90` area). `getLatestRecommendations` sets it to `result.run?.runDate?.toISOString() ?? null` when `result.run` non-null; when the DB is unavailable and the stale cache is served, keep the cached value. Route prefers `run.runDate` and falls back to the service field.

### D. `app/components/recommendations/DailyPicksTab.tsx` (MODIFIED)

- **Notice text** (when `aiUnavailable` OR when `latestRun.status === "failed" && show-run-is-older`): render the existing `aiUnavailable` banner only when the props are passed — THIS spec ensures the PARENT passes them reliably:
  - `app/recommendations/page.tsx` (or wherever the tab is mounted) must compute:
    - `aiUnavailable = latestRun && latestRun.status === "failed" && !(run && run.id === latestRun.id)` — the newest run exists but is a zero-pick failure.
    - `aiUnavailableDate = latestRun?.runDate`.
    - Also expose `nextRunAt`/`lastSuccessfulRunDate` from the API for Spec 30 wiring (spec 29 only guarantees the notice + `lastSuccessfulRunDate` display "Last updated <last successful date>").
- **"Last updated" header**: when HOLDs are shown from an older run, show `<lastSuccessfulRunDate>` (the notice already explains "showing picks from <date>").

### E. `app/api/admin/recommendations/repair-failed-runs/route.ts` (NEW)

- Admin-only (`auth()` role check). `POST` → `repairFailedRunsWithPicks()` → 200 `{ success, repaired }`; audit `RECS_REPAIR_FAILED_RUNS` with `repaired` count. Idempotent.

---

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/services/dailyRecommendationService.ts` | Modified | Honest run predicate (`:1302`), fingerprint parity (`:1236`), `repairFailedRunsWithPicks`, `lastSuccessfulRunDate` field |
| `app/api/recommendations/route.ts` | Modified | Response gains `lastSuccessfulRunDate` |
| `app/components/recommendations/DailyPicksTab.tsx` | Modified | Reliable `aiUnavailable` banner + last-successful-date in header |
| `app/recommendations/page.tsx` | Modified | Compute + pass `aiUnavailable`/`aiUnavailableDate` from `latestRun`/`run` |
| `app/api/admin/recommendations/repair-failed-runs/route.ts` | **Created** | One-shot sweep route |
| `lib/audit.ts` | Modified | `RECS_REPAIR_FAILED_RUNS` tag |
| `lib/__tests__/dailyRecommendationService.test.ts` | Modified | Predicate + repair + helper tests |
| `lib/__tests__/recommendationsRoute.test.ts` (if exists; else route test in service suite) | Modified | Contract test for `lastSuccessfulRunDate` |

---

## 6. Dependencies

### New Packages
| Package | Version | Reason |
|---------|---------|--------|
| None | — | — |

### Internal Dependencies
| Module | Function Used | Purpose |
|--------|---------------|---------|
| `@/lib/prisma` | `dailyRecommendationRun.updateMany/findFirst` | Sweep + read |
| `@/lib/cache` | `invalidateRecommendationsCache` | Post-sweep invalidation |
| `@/lib/audit` | `audit()` | Repair audit |
| `@/lib/db-utils` | `isDbUnavailableError` | Safe-default guards |
| `@/lib/logger` | `logger.*` | Logging |

---

## 7. API Contract

### GET /api/recommendations (MODIFIED — additive only)

**Response (200):**
```json
{
  "success": true,
  "run": { "id": "…", "runDate": "2026-10-10T09:20:00Z", "status": "completed", "totalScreeners": 7, "uniqueStocks": 40, "aiProcessed": 40, "executionTimeMs": 184233 },
  "latestRun": { "id": "…", "runDate": "2026-10-11T09:20:00Z", "status": "failed" },
  "lastSuccessfulRunDate": "2026-10-10T09:20:00Z",
  "stocks": [ … ],
  "timestamp": "…"
}
```

### POST /api/admin/recommendations/repair-failed-runs

**Response (200):** `{ "success": true, "repaired": 3 }`
**Response (200, idempotent):** `{ "success": true, "repaired": 0 }`
**Response (401):** `{ "error": "Unauthorized" }`

---

## 8. UI/UX Requirements

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `DailyPicksTab` (modified) | `app/components/recommendations/` | Notice + date |

### States
- **AI unavailable (newest run failed, older run shown)**: amber banner "⚠️ AI unavailable on <latestRunDate> — showing picks from <lastSuccessfulRunDate>" (reuses `aiUnavailable`/`aiUnavailableDate` props)
- **No run at all**: existing empty state unchanged
- **Healthy**: no banner

### Responsive / Dark mode: banner is text-based — inherits existing styles; no new layout.

---

## 9. Rules & Guardrails

- [ ] NEVER render junk verdicts — a run is only "Today's Picks" if `status = completed AND aiProcessed > 0`
- [ ] Read-path predicate change is mirrored in the fingerprint query (cache validity)
- [ ] Repair sweep is idempotent + admin-gated + audited; stocks journal preserved (only pivot zeroed)
- [ ] Safe defaults on DB-unavailable (null date, cache served)
- [ ] Logging via `@/lib/logger`; no secrets
- [ ] Existing `latestRun`/`run` contract preserved — additive fields only

---

## 10. Expected Behavior

1. A `failed, aiProcessed:0, uniqueStocks>0` legacy run (347d6887-class) is NEVER selected by the "latest with stocks" query — a later `completed` run with `aiProcessed > 0` wins; when none exists, `run` is `null`, not the failed one.
2. With a failed newest run + older good run: API returns `run` = older good run, `latestRun` = newer failed run, `lastSuccessfulRunDate` = older run's date.
3. With only failed runs: API returns `run: null`, `stocks: []`, `latestRun` = newest failed run, `lastSuccessfulRunDate: null` (UI shows empty state, NOT 100 HOLDs).
4. `repairFailedRunsWithPicks()` zeroes `uniqueStocks` on legacy failed/0-AI/with-picks runs, keeps journal stocks, invalidates cache, second call is a 0 no-op.
5. Cache fingerprint uses the same predicate (no stale-cache served after predicate change — test with mock cache).
6. `DailyPicksTab` shows the amber notice exactly when `latestRun.status === "failed"` and `run.id !== latestRun.id`.
7. `POST /api/admin/recommendations/repair-failed-runs` returns 401 without admin; audit emitted with repaired count.
8. Full Jest suite passes; no regression in History/Performance tabs (they read by explicit runId, unaffected).

---

## 11. Error Handling

| Scenario | Behavior | Log Level |
|----------|----------|-----------|
| DB unavailable in `getLatestRecommendations` | Existing `isDbUnavailableError` → serve stale cache / empty (unchanged) | `warn` |
| Repair sweep DB failure | `{ repaired: 0 }`, never throws | `error` |
| Repair route without admin | 401 | `warn` |
| Fingerprint query fails | Existing catch → serve stale cache (unchanged) | `warn` |

---

## 12. Test Strategy

### Unit Tests (`lib/__tests__/dailyRecommendationService.test.ts` — MODIFIED)

- [ ] Latest-run query picks `completed + aiProcessed>0` over older `failed + aiProcessed=0` (mock findFirst ordering)
- [ ] `failed + aiProcessed>0` still selected (partial-AI failure keeps its picks — status completed preferred but partial runs are honest: mark this case explicitly; if spec-owner prefers excluded, note and assert accordingly — see Risks)
- [ ] Only failed runs → `run: null, stocks: [], latestRun: newest-failed, lastSuccessfulRunDate: null`
- [ ] `getLastSuccessfulRunDate` returns ISO or null
- [ ] `repairFailedRunsWithPicks`: exact predicate, journal preserved, cache invalidated, idempotent
- [ ] Fingerprint parity: same predicate used for `runId` (cache-validity test)

### Route Test (`app/api/recommendations/route.ts` shape)

- [ ] Body contains `lastSuccessfulRunDate` matching serialized run date (or null)
- [ ] `latestRun.status === "failed"` + `run.id !== latestRun.id` case renders notice in component test (DailyPicksTab test — use @testing-library/react)

### E2E (defer to Spec 30 combined recs spec — manual live check acceptable here)

- [ ] Live-check on :3000 after repair route run: HOLDs section not rendered from failed runs

---

## 13. Performance Considerations

- **Reads**: predicate change is equivalent cost (same index usage `runDate` desc). `lastSuccessfulRunDate` derived from the already-fetched `run` — no extra query when `run` present.
- **Sweep**: `updateMany` single op; runs after repair no longer carried through the stocks-include heavy query.

---

## 14. Security Considerations

- **Auth**: repair route admin-only; probe-style fail-open status route N/A here (read path is public but only exposes non-secret run metadata + stock data as today)
- **Input**: no free-form user input (repair takes no body)
- **Audit**: `RECS_REPAIR_FAILED_RUNS` with count
- **Secrets**: none touched

---

## 15. Definition of Done

- [ ] `getLatestRecommendations` predicate = `status: "completed", aiProcessed > 0, uniqueStocks > 0` + fingerprint parity
- [ ] `lastSuccessfulRunDate` in API + `LatestRecommendations` interface
- [ ] `repairFailedRunsWithPicks` + admin route + audit
- [ ] DailyPicksTab reliable `aiUnavailable` notice + header date
- [ ] Tests: service + route + component; full Jest 134 suites green
- [ ] `npx tsc --noEmit` 0 new; `npm run lint` 0
- [ ] Live-verified on :3000: run the repair route against local data, confirm no 100-HOLD rendering path
- [ ] Docs updated (AGENTS.md, CHANGELOG, Todo-ref, Primer, agent-memory, Lessons if new, session docs, session-todos)

---

## 16. Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| A legacy `failed + aiProcessed>0` run (partially-AI'd) could be excluded by `status: "completed"` | Use `status in ["completed","failed"] AND aiProcessed > 0` instead if partial-AI runs are a real case; assert in test | Decide at implementation — default to `status: "completed"` (honest contract) unless a partial-AI run exists in local/prod data |
| Repair sweep zeroes pivot on runs users may reference | Journal preserved; History/Performance read by explicit `runId` so unaffected | No |
| Cache served during DB-unavailable after predicate change | Fingerprint parity + cache invalidation on repair | No |