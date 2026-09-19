# Plan: PWA + Lighthouse + GA4 Metric Tracking Sprint (v1.0)

**Spec:** `.agents/specs/pwa-lighthouse-ga4-sprint-v1.0.md`
**Status:** DRAFT — awaiting human approval (repo rule: `human_approved_plan`)
**Owner:** TradeNext agent (swing/pwa/lighthouse/analytics)

---

## Phase 0 — Verify (no code changes)

**Gate: swing-persistence root-cause (LIVE, highest priority).**

- [ ] Diff the **live deployed bundle** (`https://tradenext6.netlify.app/...` assets) against
      Local_git `lib/services/swingRecommendationService.ts`. Confirm whether the deployed
      byte actually contains the SQLite-mirror + breaker + staticCache serve path.
  - If live is **stale** (old bundle): the fix is already committed/deployed-pending —
    redeploy + re-verify; DO NOT edit persistence code.
  - If live is **current** but still refreshing: proceed to Phase 1d root-cause below.
- [ ] `git fetch origin && git log --oneline -5 origin/main` — confirm HEAD + merge state.
- [ ] Capture current Lighthouse numbers for the 4 categories as a baseline.

## Phase 1 — Implementation (only after Phase 0 confirms a real delta)

### 1a. PWA (high)
- [ ] Generate icon assets `public/icons/` — 512px PNG (maskable-safe padding) +
      192px + 512px maskable + apple-touch-icon(180px) + favicon.
- [ ] `public/manifest.json`: fill `icons[]` (512px + maskable entries with
      `purpose: "any maskable"`), add `theme_color`, `background_color`,
      `splash_pages`, `description`, `display_override`.
- [ ] `app/layout.tsx`: add `<meta name="theme-color">`, apple-touch-icon link,
      manifest link, maskable icon link.
- [ ] Register SW: `public/sw.js` (cache-first for shell, network-first for API,
      runtime cache for icons/GA) + `registerSW` in layout (prod only).
- [ ] Google Analytics + WebVitals remain functional after SW caching (exclude
      gtag/API from aggressive cache).

### 1b. Lighthouse (high)
- [ ] a11y 96→97+: fix heading order (h1→h2→h3 sequential), contrast on low-contrast
      text (check `text-slate-400`/`text-gray-400` on gray bg).
- [ ] Perf 76→85+: lazy-load unused JS (chart libs not on recommendations tab),
      defer non-critical, trim main-thread busy loops (screener), code-split.
- [ ] BP 83→90+: browser-console errors (fix unhandled rejections / undefined access),
      CSP header effective (add nonce-able inline handling or tighten), theme-color meta.
- [ ] Double-check CSP doesn't break existing gtag/GA inline script.

### 1c. GA4 metric tracking (medium)
- [ ] Wire `web-vitals` → GA4 `gtag('event', ...)` for each core-web-vitals metric
      (web_vitals events with metric name/value/rating).
- [ ] Extend `trackEvent.ts` + `WebVitals.tsx` to map web-vitals ratings to GA4 events.
- [ ] Add GA4 metric events for more metrics (LCP, FID, CLS, INP) with rating buckets.
- [ ] Ensure no duplicate/leaky events on SW-cached reloads.

### 1d. Swing persistence (ONLY if Phase 0 shows live is current + still buggy)
- [ ] Add a `dataSource: "sqlite"` + jobId marker to the served swing payload so we can
      tell whether the live tab is being served from the mirror.
- [ ] Log a `SWING_SERVE_SOURCE` audit flag at serve time identify which path fired.
- [ ] Re-test with Prisma forcibly unavailable; confirm the swing feed serves the frozen
      mirror result and stops refreshing.

## Phase 2 — Verify + Docs
- [ ] `npx tsc --noEmit` (baseline clean)
- [ ] `npm run test` (jest — run alone)
- [ ] `npm run lint`
- [ ] `npm run quickbuild`
- [ ] Re-run Lighthouse → confirm improved scores (PWA installable, perf ≥85, a11y ≥97,
      BP ≥90, SEO 100)
- [ ] Docs: CHANGELOG.md + `.agents/changelog/versions-index.md` + versions-v*.md +
      Primer + Lessons + agent-memory + HANDOFF/latest.md. Update AGENTS.md
      table row if new scripts/commands.
- [ ] Bump version per docs standard; update versions-index with MERGED/LIVE thumbs.

---

## Acceptance Criteria (from spec §5)
1. tsc baseline clean; jest passes (no regressions); lint clean; quickbuild passes.
2. Lighthouse: PWA installable; Perf ≥85; a11y ≥97; BP ≥90; SEO 100; no console errors.
3. GA4 web-vitals metrics flow to GA4 as events.
4. Live swing: served from SQLite mirror, no endless refresh when Prisma down.
5. All docs updated.
