# Implementation Plan — Spec 39: Advanced Analytics (Pulse, Radar, Calm, Orderflow, Liquidity)

> Generated from spec: `.agents/specs/39-advanced-analytics-dashboard.md`
> Save to `.agents/plans/39-advanced-analytics-dashboard.md`
> Branch: `feature/advanced-analytics` (off `main`)
> Created: 2026-11-03
> Status: **PLAN DRAFT — pending human approval before implementation (D9)**

---

## Spec Reference

- **Spec**: `.agents/specs/39-advanced-analytics-dashboard.md`
- **Branch**: `feature/advanced-analytics`
- **Created**: 2026-11-03

---

## Implementation Steps

> Ordered steps. Each step is atomic — can be verified independently.
> Format: `[N] Step description → verify: [check command]`

### Phase 1: Shared infrastructure

1. **Create `app/analytics/layout.tsx`** — shared layout with sub-nav tabs (Pulse/Radar/Calm/Order Flow/Liquidity) → verify: `npx tsc --noEmit`
2. **Create `app/analytics/page.tsx`** — redirect to `/analytics/pulse` → verify: navigation works
3. **Create `app/components/analytics/AnalyticsSubNav.tsx`** — tab bar component → verify: tabs render
4. **Add "Advanced Analytics" link to `app/Header.tsx`** → verify: link visible in nav
5. **Create `lib/services/analytics/analyticsCache.ts`** — cache wrapper around `market_cache` with live/closed TTL → verify: `npx tsc --noEmit`

### Phase 2: Market Pulse (MVP core)

6. **Implement `lib/services/analytics/pulseService.ts`** — mood score, headline, indices, VIX, sectors, flow → verify: `npx tsc --noEmit`
7. **Create `app/api/analytics/pulse/route.ts`** → verify: `curl localhost:3000/api/analytics/pulse` returns 200
8. **Create pulse page** `app/analytics/pulse/page.tsx` → verify: page loads
9. **Create pulse components** (PulseMoodGauge, PulseIndexCard, PulseSectorTreemap, PulseVixGauge, PulseMoneyFlow, PulseHeadline) → verify: `npx tsc --noEmit`
10. **Wire pulse page** with components + data fetching (SWR) → verify: data renders
11. **Add loading/empty/error states** → verify: all states render

### Phase 3: Stock Radar

12. **Implement `lib/services/analytics/radarService.ts`** — 8-axis composite, verdict, plan, levels, series, components → verify: `npx tsc --noEmit`
13. **Create `app/api/analytics/radar/route.ts`** → verify: route returns 200 for valid symbol
14. **Create radar page** `app/analytics/radar/page.tsx` → verify: page loads
15. **Create radar components** (SymbolSearch, RadarComposite, RadarPlan, RadarLevels, RadarSeriesChart, RadarComponents) → verify: `npx tsc --noEmit`
16. **Wire radar page** with symbol search + data fetching → verify: data renders for RELIANCE

### Phase 4: Calm Zone

17. **Implement `lib/services/analytics/calmService.ts`** — low-vol screener, calm score, ranking → verify: `npx tsc --noEmit`
18. **Create `app/api/analytics/calm/route.ts`** → verify: route returns 200
19. **Create calm page** `app/analytics/calm/page.tsx` → verify: page loads
20. **Create CalmTable component** (sortable, paginated) → verify: `npx tsc --noEmit`
21. **Wire calm page** with data + sorting + pagination → verify: table renders

### Phase 5: Order Flow (simplified v1)

22. **Implement `lib/services/analytics/orderflowService.ts`** — index + shard fetch, daily approximation → verify: `npx tsc --noEmit`
23. **Create `app/api/analytics/orderflow/route.ts`** → verify: route returns 200
24. **Create orderflow page** `app/analytics/orderflow/page.tsx` → verify: page loads
25. **Create OrderflowChart component** (candles + levels + OBs, no volume profile in v1) → verify: `npx tsc --noEmit`
26. **Wire orderflow page** with symbol search + data → verify: data renders

### Phase 6: Liquidity Map (simplified v1)

27. **Implement `lib/services/analytics/liquidityService.ts`** — bars + walls + chips + read → verify: `npx tsc --noEmit`
28. **Create `app/api/analytics/liquidity/route.ts`** → verify: route returns 200
29. **Create liquidity page** `app/analytics/liquidity/page.tsx` → verify: page loads
30. **Create LiquidityChart component** (bars + walls, no OI buildup overlay in v1) → verify: `npx tsc --noEmit`
31. **Wire liquidity page** with symbol search + data → verify: data renders

### Phase 7: Tests

32. **Write unit tests** (pulseService, radarService, calmService) → verify: `npm run test` passes
33. **Write E2E tests** (`e2e/analytics.spec.ts`) → verify: `npm run test:e2e` passes

### Phase 8: Documentation

34. **Update AGENTS.md** — version row
35. **Update CHANGELOG** — `.agents/changelog/versions-v3.XX.md` + index
36. **Update TODO.md, Primer.md, agent-memory.md, Lessons.md, session-todos.md, handoff, HANDOFF.md**
37. **Create session memory** — `decisions.md` + `flow.md`

---

## Test Strategy

### Unit Tests (Required)

| Test | File | What It Verifies |
|------|------|------------------|
| Mood score computation | `pulseService.test.ts` | Weighted average of 4 drivers |
| Breadth calculation | `pulseService.test.ts` | adv/(adv+dec) |
| Flow aggregation | `pulseService.test.ts` | Sector net flow |
| Radar axis scoring | `radarService.test.ts` | Each axis 0–100 |
| Calm score ranking | `calmService.test.ts` | Sort by calm desc |
| Cache TTL by market hours | `analyticsCache.test.ts` | Live vs closed TTL |

### E2E Tests (Required — UI change)

| Test | What It Verifies |
|------|------------------|
| Analytics nav link visible | Nav wiring |
| Sub-nav tabs switch pages | Routing |
| Pulse page renders mood + indices | Component rendering |
| Radar page loads with symbol | Data flow |
| Calm page shows table | Component rendering |
| Responsive at 375px | Mobile layout |
| Dark mode renders | Theme support |
| No console errors | Clean render |

---

## Verification Checklist

```bash
# Type checking
npx tsc --noEmit                    # 0 new errors (baseline: 46)

# Tests
npm run test                        # All pass
npm run lint                        # No warnings

# Build
npm run quickbuild                  # Production build succeeds

# Visual
npm run dev                         # Check :3000 /analytics/* in light + dark, 375/768/1440
```

---

## Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| Intraday data not available (Order Flow, Liquidity) | v1 uses daily approximation; full version needs `intraday_prices` table | Yes (v2) |
| IV/IVR for Calm Zone requires per-stock option chain | Heavy API calls; cache aggressively; consider limiting to F&O stocks only | No |
| Radar composite scoring accuracy | Start with heuristic weights; tune based on user feedback | No |
| Large payload for orderflow shards | Lazy-load shards per symbol; cache per symbol | No |
| NSE rate limits | Cache + retry with backoff; reuse existing `nse-client` | No |

---

## Documentation Checklist

- [ ] **AGENTS.md** — version row in table
- [ ] **CHANGELOG** — `.agents/changelog/versions-v3.XX.md` detail + index update
- [ ] **TODO.md** — quick-reference row
- [ ] **Primer.md** — current project status
- [ ] **agent-memory.md** — activity log entry
- [ ] **Lessons.md** — new lesson (if pattern/bug discovered)
- [ ] **Session memory** — `decisions.md` + `flow.md`
- [ ] **session-todos.md** — current session updated
- [ ] **handoffs/active/latest.md** — resume context

---

## Pre-Commit Gate

1. `npx tsc --noEmit` — 0 new errors
2. `npm run test` — all pass
3. `npm run lint` — no warnings
4. `git status` — no junk artifacts, no secrets in diff
5. Documentation updated per checklist above
6. Engineering checklist (`.agents/rules/checklist.md`) validated

---

**End of Plan 39.** Implementation pending human approval (D9).
