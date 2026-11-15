# PR evidence — Spec 43 prediction targets & analysisMode + Tracks 1–4 outbound notifications / sync deploy-prep

**Branch:** `feature/spec-43-prediction-targets` (PR target: `main`)  
**Date:** 2026-11-15 (local implementation, verification, and visual validation)  
**Policy:** no merge, no deploy performed by agent. `WORKER_DISPATCH_SECRET` must be set in Netlify dashboard before deploy (Spec 42 carry-forward). Dev server started for visual validation was stopped after capture; `:4096` not touched. No production DB calls / no batch-huge operations.

## Scope (commits included vs `origin/main`)
- `df5ef74` docs-spec43-planning
- `683a937` merge-origin-main-spec43-and-lesson173
- `0e9c64f` docs-update-spec43-branch-status
- `1cb4d36` **feat(spec43): add prediction targets and analysisMode** (Spec 43 implementation)
- `e3be4ed` **feat(notifications): unified outbound tracking, notifications admin, sync deploy prep, and diagram artifacts** (Tracks 1–4 + Archify/Graphify/docs)

Primary feature/fix work in this evidence set: **Spec 43** and **Tracks 1–4** (`1cb4d36`, `e3be4ed`).

---

## 1) Spec 43 — Prediction targets & `analysisMode` (feature)

### What changed
- Always show persisted prediction/calculated targets when AI is unavailable (no "AI targets off"/targetless screener-only state) with explicit per-stock `analysisMode = "AI Targets" | "Prediction Targets"` across Swing + Daily (DB/mirror/sinks/APIs/UI/Telegram/exports/Sheets).
- Per decisions (D1–D8): per-stock mode, historical targeted rows backfilled as `"AI Targets"`, missing targets/mode generated/persisted as `"Prediction Targets"` (bounded/idempotent in perf checks), daily fallback **never HOLD** on weak signals (BUY/SELL), Swing keeps `LONG/SHORT/OBSERVE` with auto prediction on screener-only view/load, Telegram/admin exports/Google Sheets include mode.

### Key artifacts (in repo)
- Spec/plan: `.agents/specs/43-prediction-targets-analysis-mode.md`, `.agents/plans/43-prediction-targets-analysis-mode.md`
- Migration: `prisma/migrations/20261115160000_add_analysis_mode_prediction_targets/migration.sql`
- Session memory: `.agents/sessions/2026-11-15-prediction-targets/{decisions.md,flow.md}`

### Verification (Spec 43, session-recorded)
- Targeted Jest: **174/174 pass** (`dailyRecommendationService` 58, `swingRecommendationService` 68, `swingPerformanceService` 27, `recommendationsPlanLimitFallbacks` 21)
- `npm run lint`: **0 errors** (warnings present)
- `npx tsc --noEmit`: **46 errors, baseline-aware** (no Spec 43-modified prod/service/component or non-test errors identified at time of check)
- `node scripts/dev-checks/check-doc-sizes.mjs`: **OK** (95.7 KB total at time of check)

---

## 2) Tracks 1–4 — Unified outbound notifications, notifications admin, sync deploy-prep/workers fix

### Track 1–3: Unified outbound notification tracking/persistence/admin (feature)

**What changed**
- Per-recipient/chatId outbound-notification tracking in structured server logs and DB for outbound notifications (Telegram broadcasts, direct user alerts, bot command replies, email/webhook/in-app deliveries, admin/announcement sends, including daily/all-HOLD notices).
- `OutboundNotification` (`@@map("outbound_notifications")`) with SQLite-first mirror/outbox/id-keyed upsert + Prisma fallback via `lib/services/outboundNotificationService.ts`; Prisma/SQLite mirror/outbox/push-sink/read-write updates (`lib/sqlite.ts`, `lib/sqlitePushSinks.ts`, schema/migration).
- Admin history/manage: `GET/PATCH /api/admin/notifications`, `/admin/utils/notifications` UI (filters/detail/message preview/retry/cancel/bulk + audit trail), utils sidebar `Notifications`, cross-links/unified send history in `/admin/alerts` and `/admin/utils/announcements`; announcement create/activate stores notification send records.
- Audit actions updated (`lib/audit.ts`); integrations wired in Telegram/daily/swing/admin broadcast/user test/notification+alert delivery/announcements services.

**Key artifacts**
- Migration: `prisma/migrations/20261115170000_add_outbound_notifications/migration.sql`
- Service: `lib/services/outboundNotificationService.ts`
- UI/API: `app/admin/utils/notifications/page.tsx`, `app/api/admin/notifications/route.ts`
- Cross-links: `app/admin/alerts/page.tsx`, `app/admin/utils/announcements/page.tsx`, `app/admin/utils/layout.tsx`

### Track 4: Synchronous deploy-prep + workers visibility (fix)

**RCA**
- **Problem:** “Prepare for Deploy” behavior/contract and `/admin/utils/workers` visibility were not aligned with the desired synchronous, inspectable flow (workers showing 0 / deploy-prep not represented as a real in-request task record with checks).
- **Impact:** Operators could not reliably observe deploy-prep progress/state in workers/admin.

**Fix**
- `POST /api/admin/db-health` `deploy_prep` runs **synchronously in-request** and **creates/updates a real `worker_tasks` record** with checks/result (not queued/pending scheduler path).
- Checks include `probePrismaNow`/breaker/latency, SQLite ready/health, mirror/outbox state (as implemented).
- `lib/__tests__/dbHealthRoute.test.ts` aligned to the sync contract.

**Key artifacts**
- `app/api/admin/db-health/route.ts`
- `lib/__tests__/dbHealthRoute.test.ts`

---

## 3) Local DB/schema application (evidence)
- Started local DB: `docker compose up -d db` (`tradenext-db-1` healthy on `:5432`)
- Applied schema locally (incl. `outbound_notifications`): `npx prisma db push` — synced successfully

---

## 4) Verification evidence (Tracks 1–4, recorded)
| Check | Result |
|---|---|
| `npx tsc --noEmit` | **47 pre-existing test-file errors only** (no new prod errors attributed to Tracks 1–4) |
| `npm run lint` | **Exit 0** (warnings present) |
| `npx jest lib/__tests__/dbHealthRoute.test.ts --runInBand` | **21/21 pass** |
| `npm run quickbuild` | **202/202** pages built (includes `/admin/utils/notifications`) |
| `node scripts/dev-checks/check-doc-sizes.mjs` | **OK (95.9 KB / 100.0 KB)** |
| `git` pre-commit checks | **Passed** for commit `e3be4ed` |

**Not run:** full `npm test` suite; full eslint warning summary.

---

## 5) Visual validation (Playwright, local dev `:3000`, admin session) — screenshots

Login: `admin@tradenext6.app` / `admin123` (local). Dev server started/stopped for validation; no console errors observed on captured pages.

| Track | Page | Screenshot | Notes |
|---|---|---|---|
| 2 | `/admin/utils/notifications` | [`track2-notifications.png`](track2-notifications.png), [`track2-notifications-loaded.png`](track2-notifications-loaded.png) | Unified notifications admin/history UI renders and loads |
| 3 | `/admin/alerts` | [`track3-admin-alerts.png`](track3-admin-alerts.png) | Alerts page with unified send-history/cross-links context |
| 3 | `/admin/utils/announcements` | [`track3-admin-announcements.png`](track3-admin-announcements.png) | Announcements page with unified send-history/cross-links context |
| 4 | `/admin/utils/workers` | [`track4-workers.png`](track4-workers.png) | Workers/tasks visible (**50 total shown**, not 0) |
| 4 | `/admin/utils/db-health` | [`track4-db-health.png`](track4-db-health.png) | DB health / deploy-prep context visible |

> “Before” screenshots for newly introduced admin pages are not applicable (pages did not previously exist). Workers visibility fix evidenced by current state showing tasks present (not 0).

---

## 6) Archify & Graphify artifacts (committed)
- **Archify (project-only, opencode, doctor OK):** `.archify/{architecture,dataflow,workflow}-tracks-1-4-20261116/` — finalized validated HTML + candidates/receipts
  - `tracks-1-4-architecture.html`, `tracks-1-4-dataflow.html`, `tracks-1-4-workflow.html`
- **Graphify (`graphifyy-0.9.110`, `extract --code-only` + `cluster-only`):** `graphify-out/graph.json`, `graphify-out/graph.html`, `graphify-out/GRAPH_REPORT.md` (+ cache/labels/metadata). Stats: 8936 nodes, 22473 edges, 278 communities; labels placeholders (no LLM backend configured).

---

## 7) Observations / carry-forwards
- Dev-log observation during local run (likely unrelated to Tracks 1–4): SQLite push/outbox errors for `swing_analysis_job`/`swing_signal` (`analyzedCount` null / FK).
- S2 minimal Prisma-Remote prod read-only diagnostics remain pending approval/tool access.
- Set `WORKER_DISPATCH_SECRET` in Netlify dashboard before deploy (Spec 42). No merge/deploy by agent.
