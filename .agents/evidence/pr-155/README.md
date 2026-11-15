# PR #155 evidence — Swing auto-seed + Quality Gate fix

Branch: `feature/spec-42-durable-worker-cron-v2` (PR https://github.com/luckyhegde6/TradeNext/pull/155)  
Date: 2026-11-15 (local verification)  
Policy: no merge, no deploy. `WORKER_DISPATCH_SECRET` must be set in Netlify dashboard before deploy. Dev server started for verification was stopped (port 3000 not listening after checks); no `:4096` processes touched.

## 1) Swing `/recommendations/swing`: `AI targets off` / `AI analysis pending — screener signals only`

### RCA
- **Root cause:** `lib/services/swingAutoSeedService.ts` `hasStoredSwingTargetsForUser` treated **any non-empty** `analyze=false` swing feed as “stored targets” (`stocks.length > 0`). A screener-only feed (`analysisStatus: "skipped"`, `stock.analysis: null`) contains **no AI targets**, but the probe returned `true`.
- **Impact:** `autoTriggerOnce({ trigger: "empty-state" })` (fired by `GET /api/recommendations/swing`) skipped the one-time bounded AI generation for users/sessions seeing only screener-only skipped feeds, leaving the Swing tab stuck on **“AI targets off”** with **“AI analysis pending — screener signals only”** on cards.
- **Why escaped:** “Stored feed” vs “stored AI targets” semantics were conflated; probe/tests did not cover a non-empty screener-only `skipped` feed (no per-stock analysis). Job-aware bypass logic existed in `getSwingRecommendations`, but auto-seed gating prevented the initial generation trigger.

### Fix
- `hasStoredSwingTargetsForUser` is now read-only and target-aware:
  - Inspects durable swing-analysis jobs first (SQLite mirror, then Prisma fallback): `pending/running` ⇒ in-progress (do not double-trigger); `done/failed` ⇒ a generation attempt completed (seed-once, no retry loop).
  - Falls back to serve-first feed probe (`analyze:false`, `forceRefresh:false`): `analysisStatus` `pending|done|failed` or any `stock.analysis != null` ⇒ stored/in-progress.
  - **Screener-only/skipped feeds (even with picks) are not treated as stored**, so `autoTriggerOnce` can run **one bounded** generate (`forceRefresh:true, analyze:true`) for the empty-state trigger.
- No scan/AI side effects added to the probe.

### Code / tests
- `lib/services/swingAutoSeedService.ts` — fixed probe/gating.
- `lib/__tests__/swingAutoSeedService.test.ts` — regression added: screener-only `skipped` feed (no AI targets) triggers one bounded auto-seed; suite **12 passed**.
- `lib/__tests__/swingRecommendationService.test.ts` — **68 passed** (swing feed/job behavior unaffected).

### Before / After evidence (Swing)

**Before (prod, 2026-11-15):** `https://tradenext6.netlify.app/recommendations` → Swing tab showed **“AI targets off”**, `20 picks · 200 flagged · 34 screeners`, and every visible card showed **“AI analysis pending — screener signals only”** (screener-only feed, no per-stock AI targets). See:
- `before-prod-swing-tab.png` (Swing tab state)
- `before-prod-recommendations.png` (Recommendations page context)

**After (local branch with fix, 2026-11-15):** `http://localhost:3000/recommendations` → Swing tab loaded the same screener-only feed state in this local environment (**“AI targets off”**, `20 picks · 200 flagged · 34 screeners`, cards **“AI analysis pending — screener signals only”**). This is expected when local DB/AI/screener dependencies cannot complete a durable swing analysis run in-place; the **behavioral fix** is verified by unit tests: the auto-seed probe no longer treats this screener-only state as “already stored”, so the empty-state trigger can now enqueue/run one bounded generation instead of no-oping. See:
- `after-local-swing-tab.png`
- `after-local-swing-analyze0.json` (API payload summary from local `GET /api/recommendations/swing?analyze=0`; written if dev server was reachable at capture time)

> Note: successful end-to-end AI target generation depends on environment/runtime capabilities (screeners, NSE/Chartink data, AI provider credits/quota, durable job execution). The fix removes the incorrect “already seeded” gate that blocked auto-seed for screener-only feeds.

## 2) PR #155 `Quality Gate / quality-gate` — `Run tests` failure

### RCA
- **Run:** `43646720667`, job `132606058816` (PR head at the time had stale assertion).
- **Failure:** `lib/__tests__/dailyRecommendationService.test.ts › dailyRecommendationService › checkRecommendationPerformance › survives live-quote failures — symbol skipped, no throw`
  - Expected: `mockPrisma.recommendationTracker.update` not called
  - Received: 1 call `{"data":{"lastCheckedAt": <date>},"where":{"id":"t1"}}`
- **Cause:** Test expected pre-`bd43efd` behavior; intended behavior stamps `lastCheckedAt` on the no-price perf path (mirror + best-effort Prisma) so trackers are not repeatedly rechecked without progress.

### Fix
- `lib/__tests__/dailyRecommendationService.test.ts` aligned to `bd43efd` behavior (`lastCheckedAt` stamped in mirror + best-effort Prisma, `skippedNoPrice: 1`).

### Verification
- `npx jest --runInBand lib/__tests__/dailyRecommendationService.test.ts` → **58 passed**
- Earlier targeted: `recommendation-agent` fallback/quota/failed subset → **7 passed, 34 skipped** (as noted in session)

## 3) Mandatory evidence/RCA rule added (request)
- `.agents/rules/checklist.md` bumped to **v1.4**: added **“Bugfix & Feature Evidence (MANDATORY)”** (RCA for bug fixes, verification evidence, before/after screenshots for UI/UX-visible changes or before/after evidence for non-visual fixes, PR-linked explanation).
- `.agents/pre-commit-workflow.md`: added matching **EVIDENCE** gate.

## Validation summary
- `npx jest --runInBand lib/__tests__/swingAutoSeedService.test.ts` → **12 passed**
- `npx jest --runInBand lib/__tests__/swingRecommendationService.test.ts` → **68 passed**
- `npx jest --runInBand lib/__tests__/dailyRecommendationService.test.ts` → **58 passed**
- `node scripts/dev-checks/check-tsc-baseline.mjs` → **OK (total 46, prod 0, delta +0/+0)**
- `node scripts/dev-checks/check-doc-sizes.mjs` → **OK (95.8 KB / 100 KB)** (earlier in session)
- `npm run lint` → **0 errors, 1177 warnings (pre-existing)** (earlier in session)

## Not run / notes
- **S2 prod Prisma-Remote diagnostics not run** (no permission): run `77c94771-2442-4880-9a26-b8fd21fe0642`, 2026-11-04 AI-unavailable run, tracker `lastCheckedAt` distribution on `proj_cmikwbg4q06d53nfj4tuw90tj` / `db_cmikwbg4q06d33nfjnpxjio09`.
- AI-unavailable fallback target generation/storage paths were reviewed and already present in daily/swing flows; no additional product-code gap found in that area.
- **No merge/deploy.** `WORKER_DISPATCH_SECRET` must be set in Netlify dashboard before deploy.
