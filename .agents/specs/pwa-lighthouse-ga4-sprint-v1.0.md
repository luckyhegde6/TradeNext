# Spec: PWA + Lighthouse + GA4 Metric Tracking Sprint (v1.0)

**Date:** 2026-09-19
**Status:** DRAFT — awaiting human approval (repo rule: `human_approved_spec`)
**Owner:** TradeNext agent (swing/pwa/lighthouse/analytics)
**Linked PRs:** follow-on to PR #130 (swing SQLite mirror + predeploy mirror-preserve, MERGED+LIVE)

---

## 1. Problem Statement

The Lighthouse report for `https://tradenext6.netlify.app` (Moto G4 / Slow 4G / LH 9.6.8)
shows the following actionable regressions, and a live swing-persistence bug is reported:

| Category | Score | Headline issues |
|----------|-------|-----------------|
| Performance | 76 | unused JS ~0.91s, main-thread 6.0s, JS exec 2.6s, 33 req / 519 KiB, LCP 1.9s, 10 long tasks |
| Accessibility | 96 | contrast fail; heading order not sequentially-descending |
| Best Practices | 83 | browser errors in console; Issues panel entries; **CSP ineffective vs XSS** |
| SEO | 100 | — |
| PWA | **not installable** | no SW controlling start_url; no 512px PNG icon; no theme-color meta; no maskable icon; no splash |

**Live bug:** `/recommendations` swing tab keeps **refreshing** instead of persisting to the
SQLite mirror and serving stably when Prisma is unavailable.

## 2. Goals (SMART)

1. **PWA installable** — Lighthouse PWA category reaches all mandatory checks:
   - manifest with 512px PNG + maskable + maskable-icon entries
   - theme-color meta + theme-color/splash in manifest
   - service worker registered + controlling start_url
   - valid apple-touch-icon, splash config
2. **Lighthouse** ≥ what the report implies is fixable: Perf → 85+, a11y → 98+, BP → 90+,
   SEO stays 100.
3. **GA4**: wire web-vitals → GA4 `gtag` events (web-vitals/events/metrics) so metric
   tracking is meaningful and reportable in GA4, not just console.
4. **Swing persistence**: `/recommendations` swing serves from the SQLite mirror when
   Prisma is down (no endless refresh); verify live deploy actually runs the new code
   before editing the persistence path.

## 3. Non-Goals
- No schema changes (no migration).
- No auth/role changes.
- No dependency additions (use `web-vitals` already present; gtag injection via
  `@/lib/analytics` existing files).
- No changes to `/api/openapi` contract surface.
- No premature SW caching of admin/API routes (security).

## 4. Approach

### 4.1 PWA (high)
- `public/manifest.json`: populate `icons` with 512px + maskable (rasterize existing logo
  at 512px + maskable-safe padding), add `theme_color` + splash `background_color` +
  `description` + `purpose` fields; add `apple-touch-icon` + `theme-color` meta to layout.
- Generate icon assets into `public/icons/` (512px, 192px, maskable variants).
- Register a service worker in `app/layout.tsx` (or a small `app/sw.ts` via
  `public/`-served static file) that pre-caches app shell; register with
  `navigator.serviceWorker.register('/sw.js')` guarded to production.

### 4.2 Lighthouse (high)
- a11y: heading order fix (h1 → h2 → h3 sequential), contrast fixes on low-contrast text.
- BP: remove console errors (fix unhandled promise rejections / undefined access), tighten
  CSP header, remove CSP-ineffective warning.
- Perf: reduce unused JS (dynamic-lazy the heavy chart libs), trim main-thread busy loops.

### 4.3 GA4 metric tracking (medium)
- Extend `app/api/metrics/web-vitals/route.ts` + `WebVitals.tsx` to forward
  `web-vitals` → GA4 `gtag('event', ...)` and add more GA metric events (custom metrics)
  so Lighthouse CWV justify in GA4 dashboards.

### 4.4 Swing persistence (high — verify-first)
- **Verify live deploy runs current code** (check `/recommendations` feed epoch + logs
  after redeploy; diff deployed JS bundle vs local `quickbuild` output).
- If live is stale → redeploy; persistence bug may already be fixed by PR #130.
- If live is current → root-cause the serve path (find where a terminal/failed job row
  in SQLite is skipped in favor of a fresh screener run) and patch.

## 5. Acceptance Criteria
1. `npx tsc --noEmit` clean at baseline (no new errors).
2. `npm run test` (jest) passes — existing 1334 pass / 4 skip preserved.
3. `npm run lint` passes.
4. `npm run quickbuild` passes (185/185 pages).
5. Lighthouse re-run: PWA installable; Perf ≥ 85; a11y ≥ 98; BP ≥ 90; SEO 100.
6. Docs updated: AGENTS.md table, CHANGELOG, versions-index, Primer, Lessons,
   agent-memory, session-todos.
7. Live `/recommendations` swing no longer refreshes on Prisma outage; served from SQLite.

## 6. Risks / Mitigations
- **Stale-build hypothesis** → verify before code (cheapest fix may be nothing but a deploy).
- Corrupt/truncated filesystem reads this session → use edit tool + git for ground truth;
  small targeted reads; re-verify any read before editing.
- CSP tightening could break inline GA gtag scripts → keep gtag nonce-able or use
  next/script; test after change.
