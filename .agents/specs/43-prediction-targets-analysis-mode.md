# Spec 43: Prediction Targets & Analysis Mode (No "AI Targets Off")

## 1. Overview

**What**: Ensure Swing and Daily recommendations always have usable, persisted targets/analysis even when AI is unavailable. Replace "AI targets off"/AI-unavailable targetless states with prediction/calculation-generated targets, label every analysis with an explicit mode (`AI Targets` or `Prediction Targets`), and make performance checks able to backfill/generate missing prediction targets so tracking is never blocked by missing AI.

**Why**: Users currently see "AI targets off" / "AI analysis pending — screener signals only" and cannot rely on targets for Swing; AI outages can leave runs/signals without actionable persisted targets for performance evaluation. The system must remain actionable and transparent by falling back to deterministic prediction/technical calculations instead of hiding targets.

**Scope (IN)**:
- Add first-class `analysisMode` (`"AI Targets" | "Prediction Targets"`) to Swing and Daily recommendation analysis records (DB, SQLite mirror, APIs, UI, exports/Telegram payload text where applicable) so **each stock carries its own mode**.
- Swing: compute and persist prediction targets/analysis automatically on screener-only Swing view/load so users always see targets immediately (no "AI targets off" state for missing AI). Keep Swing action vocabulary `LONG/SHORT/OBSERVE` with targets.
- Daily: when AI is unavailable or per-stock AI analysis is missing/failed, generate prediction targets/analysis and persist as `Prediction Targets` (not forced HOLD). **Prediction/fallback must never return HOLD on weak signals**; it must produce directional `BUY` or `SELL`. Normal AI/rare-neutral cases may still be `HOLD` where appropriate, but fallback path is never HOLD.
- Partial results: per-stock mode (`AI Targets` for AI-analyzed stocks, `Prediction Targets` for fallback-filled stocks in the same run/feed).
- Performance checks (`checkRecommendationPerformance`, `checkSwingPerformance`): during scheduled/admin runs, generate & persist missing prediction targets/mode for eligible active/open rows (bounded per run) before/while evaluating, so performance is not blocked by missing targets.
- Backfill existing data: rows with any target/analysis -> `analysisMode = "AI Targets"`; rows missing targets/analysis that are eligible/backfilled -> `Prediction Targets` (with generated targets). Historical backfill via one-time script/migration-safe data task (idempotent) plus lazy/perf backfill.
- Keep Telegram/admin exports/Google Sheets working as-is but include the new mode.

**Scope (OUT)**:
- Changing AI provider credentials/model availability (external).
- Major UI redesign beyond showing mode and removing "AI targets off"/targetless-AI-missing states.
- Merge/deploy (user-controlled).
- Broad confidence-semantic redesign unrelated to mode/fallback.

**Depends on**: existing fallback analysis (`lib/services/ai/fallbackAnalysis.ts`), Swing/Daily services and performance services, Prisma schema + SQLite mirror/push sinks, recommendation/swing UI and broadcast/export paths.

**User decisions (approved in chat 2026-11-15)**:
1. `analysisMode = "AI Targets" | "Prediction Targets"`.
2. Backfill existing: apply `"AI Targets"` to all historical rows that have any target/analysis.
3. Daily: prefer BUY/SELL but allow HOLD in rare neutral cases for normal analysis; **never return HOLD for fallback which used to produce HOLD on weak signals**.
4. Prediction targets computed automatically on every screener-only Swing view/load.
5. Swing keeps `LONG/SHORT/OBSERVE` (with targets).
6. Each stock carries its own mode.
7. Performance-check jobs generate & persist missing prediction targets/mode (bounded per run).
8. Telegram/admin exports/Google Sheets continue to work as-is but include the new mode.

## 2. Routes / APIs (expected impact)

### Modified
| Area | Change |
|------|--------|
| `GET /api/recommendations` + daily data payloads | Include `analysisMode` on per-stock recommendation data; no longer present "AI unavailable => no targets" as the normal state when prediction targets exist. |
| `GET /api/recommendations/swing` | Always return prediction-backed targets for screener results when AI targets absent (auto-computed on screener-only load as needed); include per-stock `analysisMode`; replace `analysisStatus: "skipped"`/"AI targets off" semantics with mode-aware states (e.g. prediction-ready) while preserving compatibility fields where practical. |
| Recommendation/swing history/top-stocks/admin APIs | Include `analysisMode`; backfilled/generated values visible. |
| Google Sheets export rows | Add mode column/value while keeping existing sheet flow working. |
| Telegram/broadcast builders | Continue working; include mode label where picks/targets are described. |

## 3. Database Schema

### A. New/modified fields

Add nullable-then-backfilled string field `analysisMode` to:
- `DailyRecommendationStock` — per-run daily stock analysis mode (`"AI Targets" | "Prediction Targets"`).
- `RecommendationTracker` — current/latest tracked analysis mode for the tracker.
- `SwingSignal` — per-swing-signal analysis mode.

```prisma
// DailyRecommendationStock
analysisMode String? // "AI Targets" | "Prediction Targets"

// RecommendationTracker
analysisMode String? // "AI Targets" | "Prediction Targets"

// SwingSignal
analysisMode String? // "AI Targets" | "Prediction Targets"
```

Notes:
- Keep nullable for safe migration/backfill; backfill sets values for existing rows with targets/analysis and perf/load paths fill missing eligible rows.
- Swing job payload (`SwingAnalysisJob.payload`) and any serialized analysis blobs must also carry per-stock `analysisMode`.
- SQLite mirror tables and push sinks (`lib/sqlite.ts`, `lib/sqlitePushSinks.ts`) must include the new columns/mappings.

### B. Migration
- Create Prisma migration adding `analysisMode` columns.
- Idempotent data backfill:
  - set `"AI Targets"` where any target/analysis exists (daily: `targetPrice`/`stopLoss`/`aiRecommendation`/`reasoning`/confidence/analysis fields present as applicable; swing: `analysis`/`targetPrice`/`stopLoss`/`aiRecommendation` present).
  - generate+set `"Prediction Targets"` for eligible rows missing targets during perf backfill / screener-load generation (not blindly for all historical empties unless safely derivable).

## 4. Functions / Behavior

### A. Shared prediction/labeling helpers
- Define canonical constants/types for `analysisMode` values and helpers to resolve mode.
- **Daily fallback must be directional (no HOLD):** extend `calculateFallbackRecommendation` (or add a strict variant) so weak-signal fallback returns `BUY` or `SELL` with valid target/stop/confidence/reasoning; never `HOLD`. Deterministic tie-break based on screener/momentum/price context.
- **Swing fallback:** reuse/extend `calculateFallbackSwingAnalysis` to always produce target/stop-bearing analysis for screener rows (action may remain `LONG/SHORT/OBSERVE` per decision, but targets present and mode `Prediction Targets`).

### B. Daily recommendation pipeline (`lib/services/dailyRecommendationService.ts`, `lib/services/ai/recommendation-agent.ts`)
- On AI success per stock: persist AI verdict/targets with `analysisMode: "AI Targets"`.
- On AI unavailable/skip/failure/partial failure: fill missing per-stock results with prediction targets + `analysisMode: "Prediction Targets"` (directional BUY/SELL fallback, `success` semantics updated so run produces usable picks rather than targetless/ai-unavailable-only outcomes where appropriate).
- Persist `analysisMode` into `DailyRecommendationStock` and `RecommendationTracker` upserts/updates.
- Broadcast/export/API payloads include mode; Telegram/admin/Sheets remain functional.

### C. Swing pipeline (`lib/services/swingRecommendationService.ts`, swing agent/types/UI contracts)
- Auto-compute prediction targets on screener-only Swing view/load for stocks lacking targets/analysis so feed is immediately actionable (per decision 4); mark those `Prediction Targets`.
- When AI analysis runs/completes, AI-analyzed stocks become/update to `AI Targets`; fallback-filled stocks remain `Prediction Targets` (per-stock mode).
- Remove/avoid user-facing "AI targets off" dead-end: response should present prediction-ready targets (and accurate status/labels) instead of skipped targetless state caused by missing AI.
- Persist mode in `SwingSignal` create/patch and job payload snapshots.
- Reconcile `SwingSignal.status` handling so active/performance-evaluable signals are actually picked up by `checkSwingPerformance` (align create/status/query contract) as part of making targets/performance reliable.

### D. Performance backfill (`lib/services/swingPerformanceService.ts`, daily perf/check paths, worker/admin triggers)
- During scheduled/admin performance checks, for eligible rows missing targets/analysis/mode: generate prediction targets via calculation functions, persist target/stop/analysis fields + `analysisMode="Prediction Targets"` (or `"AI Targets"` for historical rows with existing targets/analysis), bounded per run (configurable limit/batch, idempotent).
- Then evaluate/refresh status/returns as today.
- Must not regress existing hit/expiry semantics.

### E. Backfill
- One-time idempotent backfill (script or service routine invoked safely) to set `analysisMode="AI Targets"` for all historical rows that have any target/analysis; leave/generate others per rules without corrupting history.

## 5. Files to Change (expected)

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `analysisMode` to `DailyRecommendationStock`, `RecommendationTracker`, `SwingSignal` |
| `prisma/migrations/*_add_analysis_mode*` | **Create** migration |
| `lib/sqlite.ts` | Mirror schema/read-write support for new columns |
| `lib/sqlitePushSinks.ts` | Push/sink mapping for new columns |
| `lib/services/ai/fallbackAnalysis.ts` | Directional daily fallback (never HOLD on weak signals) + swing prediction helpers as needed |
| `lib/services/ai/recommendation-agent.ts` | Per-stock fallback mode handling |
| `lib/services/dailyRecommendationService.ts` | Persist mode, AI-unavailable -> prediction targets path, partial per-stock modes |
| `lib/services/swingRecommendationService.ts` | Auto prediction on screener-only load, job/payload/signal mode, remove "AI targets off" targetless behavior |
| `lib/services/swingPerformanceService.ts` | Bounded prediction backfill + mode backfill/persist; status/query alignment as needed |
| daily/swing performance check entrypoints/services | Invoke bounded backfill during scheduled/admin checks |
| `app/api/recommendations/*`, swing/daily routes | Expose `analysisMode` and updated statuses |
| `app/components/recommendations/*` (SwingTab, SwingCard, DailyPicks/History/RecommendationCard etc.) | Show mode column/badge; remove "AI targets off" UX in favor of prediction targets/mode |
| `lib/services/recommendationBroadcast.ts`, Telegram/export/Sheets code | Include mode, keep compatible |
| `lib/__tests__/*` + relevant e2e | Coverage for mode, no-HOLD fallback, auto prediction, perf backfill |
| docs/TODO/session files | Tracking and decisions |

## 6. Rules & Guardrails
- Follow `.agents/rules/checklist.md` and existing DB/perf discipline (bounded batch work in perf checks, idempotent backfill, no unbounded per-row Prisma ops in hot paths).
- DB schema/migration/data backfill requires explicit user permission before execution.
- No Prisma in client components; validate inputs; safe logging; keep exports/Telegram compatible.
- Add tests and run tsc/tests/lint/build verification before claiming done.

## 7. Expected Behavior / Acceptance Criteria
1. Swing screener-only view/load auto-generates prediction targets so users see targets immediately with `analysisMode="Prediction Targets"` (no "AI targets off" targetless state).
2. When AI is available, AI-analyzed stocks show/persist `analysisMode="AI Targets"`; partial runs label each stock by its own mode.
3. Daily fallback/prediction never returns HOLD on weak signals (always BUY/SELL with targets); normal analysis may still be HOLD in rare neutral cases.
4. All relevant analysis records/surfaces include `analysisMode` (DB, APIs, UI, exports/Sheets, Telegram) and historical rows with any target/analysis are backfilled as `AI Targets`.
5. Scheduled/admin performance checks generate & persist missing prediction targets/mode (bounded, idempotent) and evaluate them (including Swing status contract correctness).
6. Existing flows (Telegram, admin exports, Google Sheets) continue to work and now include mode.

## 8. Risks
- Schema/mirror/push-sink drift -> migration and runtime errors; mitigate with coordinated Prisma+SQLite updates and tests.
- Over-eager auto prediction on view load -> latency; mitigate by bounded fast calculation (no AI/network-heavy path) and caching.
- Backfill/perf jobs touching many rows -> ops/time; mitigate with strict batch limits and idempotent guards.
- Changing fallback from HOLD to directional BUY/SELL alters downstream metrics/broadcast composition; mitigate with explicit tests and transparent mode labeling.