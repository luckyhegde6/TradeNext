# Spec — v3.40.5: Swing AI auto-generate-once (stale-proof, budget-safe)

> **Status**: DRAFT — awaiting human approval
> **Branch**: `feat/pwa-sprint-phase-b-ga4` (extends open PR #131)
> **Target version**: v3.40.5
> **Author**: TradeNext agent
> **Date**: 2026-09-20

---

## 1. Overview

**What**: Auto-start swing AI target generation from two natural, user-intent triggers instead of leaving the Swing tab perpetually empty on first-ever use. Serves the same "stored, not regenerated" guarantee from v3.40.4 — the AI only ever runs when the user has **asked for something** (added a stock to watchlist) or when the tab is in its **unusable empty state** (nothing stored, so generation is the only way to render content). Plain page load / refresh still never runs AI.

**Why**: The v3.40.4 fix (PR #131) correctly stopped AI-on-load and serves stored targets. But we observed the obverse gap: for a brand-new user with zero stored swing targets, the Swing tab now shows a permanent "No recommendations yet — Next scan 10:00 AM IST tomorrow" dead-end with **no path to first content except a hidden manual refresh**. Users who add a stock to their watchlist expect some follow-up signal, and the empty state has no self-healing.

**Scope (IN)**:
- Add-to-watchlist → generate one swing AI target for the **added symbol only** (single symbol, one AI call).
- Empty-state → **auto-generate once** on first Swing-tab load-with-no-stored-targets (seed the feed; subsequent loads serve stored).

**Scope (OUT)**:
- No AI on ordinary page load or auto-refresh poll when stored targets already exist (that stays v3.40.4 behavior).
- No full 34-screener rescan on watchlist-add (single symbol only).
- No changes to Today's Picks / History / Performance / Dividends / Subscribe paths.

**Depends on**: v3.40.4 swing serve fix (`9e7ab89`), currently in PR #131 (open, mergeable).

---

## 2. Routes

### New Routes
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/recommendations/swing/analyze` | user session | Manually triggered single-symbol (or empty-state seed) AI generation — body `{ symbol?, forceSeed? }` |

### Modified Routes
| Method | Path | Change |
|--------|------|--------|
| `GET` | `/api/recommendations/swing` | `analyze=0` unchanged (serve stored); README route comment documents the new trigger paths. **No signature change.** |

---

## 3. Database Schema

No new models. Target data reuses existing `SwingRecommendation`/tracker rows (`analysisStatus`, `stocks[]`, `generatedAt`, `source`). The empty-state "seed once" guard uses a **dot-flag keyed by user id** (not a schema change) so a freshly-restored DB that already has stored targets never re-seeds.

---

## 4. Functions to Implement

### A. `lib/services/swingRecommendationService.ts` (modified)

#### `generateSwingTargetForSymbol(symbol: string, userId: string): Promise<{ ok: boolean; target?: unknown; error?: string }>`

- Runs the swing screener scan **filtered to the single symbol** + AI analysis for that one symbol.
- Persists the target back into the stored swing feed for that symbol.
- Idempotent-ish: if a stored target for the symbol already exists and is fresh, returns it (no AI).
- Errors fail-safe: returns `{ ok:false, error }`, never throws.
- Rate-limit-safe: respects `nseRateGuard` + `isDbWriteBudgetExceeded`.

#### `seedSwingTargetsOnce(userId: string): Promise<{ seeded: boolean; reason: "no-op" | "seeded" | "cached" }>`

- Checks the per-user "seed once" flag. If already set, or stored targets exist → `no-op`.
- Otherwise runs **one** generation pass (the existing `runSwingAnalysis` path), sets the flag.
- Never blocks the HTTP response (fire-and-forget with result log) — but the seed call from the client waits for its own 2xx/attempt.

### B. `app/api/recommendations/swing/analyze/route.ts` (new)

- `POST` guarded by session.
- Body: `{ symbol?: string; forceSeed?: boolean }` (Zod).
- Validates symbol against known NSE set; 400 on bad input; 401 unauthenticated.
- Calls either single-symbol generator or empty-state seeder.
- Returns 200 `{ success, seeded?, target? }` or 4xx per contract.

---

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/services/swingRecommendationService.ts` | Modified | Add `generateSwingTargetForSymbol` + `seedSwingTargetsOnce` |
| `app/api/recommendations/swing/analyze/route.ts` | **Created** | Manual single-symbol / seed trigger endpoint |
| `app/components/recommendations/SwingTab.tsx` | Modified | Wire watchlist-add + empty-state triggers; keep `analyze=0` load |
| `lib/services/watchlistService.ts` (or add-to-watchlist route) | Modified | Fire-and-forget single-symbol generation on add |
| `lib/audit.ts` | Modified | New event types: `SWING_TARGET_GENERATED`, `SWING_SEEDED` |
| `lib/__tests__/swingAutoGenerateService.test.ts` | **Created** | Unit tests |
| `lib/__tests__/swingRecommendationService.test.ts` | Modified | New cases |

---

## 6. Dependencies

### New Packages
None.

### Internal Dependencies
| Module | Function | Purpose |
|--------|----------|---------|
| `@/lib/services/swingRecommendationService` | `getSwingRecommendations`, scan/screener | Core reuse |
| `@/lib/services/ai/recommendation-agent` | `analyzeRecommendation` | Single-symbol AI target |
| `@/lib/nseRateGuard` | rate-limit check | Respect API budget |
| `@/lib/logger` | `logger.info/warn/error` | Structured logs |
| `@/lib/audit` | `audit()` | Event trail |

---

## 7. API Contract (POST /api/recommendations/swing/analyze)

**Request** (Zod):
```ts
z.object({
  symbol: z.string().toUpperCase().optional(), // single-symbol trigger
  forceSeed: z.boolean().optional(),           // empty-state seed trigger
}).refine(d => d.symbol || d.forceSeed, { message: "Provide symbol or forceSeed" })
```

**Response 200**:
```json
{ "success": true, "seeded": true, "symbol": "RELIANCE", "target": { ... } }
```

**Response 401 / 400 / 500** per route template contract.

---

## 8. UI/UX Requirements

### Components
| Component | Location | Purpose |
|-----------|----------|---------|
| `SwingTab.tsx` (exists) | Modified | Add "🎯 targeting <symbol>…" inline badge on watchlist-add; "⚙️ seeding first targets…" state on empty-state auto-generate |

### States
- **Watchlist-add**: Stock gets a `🎯 targeting {SYMBOL}…` chip (skeleton) → resolves to stored target or fades if failed.
- **Empty-state**: First load with no stored targets shows `⚙️ Seeding first AI targets…` -> then content or the existing empty state with a "Run scan now" CTA.
- **Stored targets exist**: Unchanged v3.40.4 behavior (fast serve, no AI).
- **Error/empty**: Existing empty-state with retry.

### Responsive
- Same as current SwingTab (works at 375/768/1440; badge wraps on mobile).

---

## 9. Rules & Guardrails

- [x] **No AI on plain page load** (unchanged; only watchlist-add or empty-seed) — preserves v3.40.4/handoff guarantee.
- [ ] Zod validation on all API input
- [ ] Server-side only; no Prisma in client components
- [ ] Session-guarded endpoints
- [ ] `nseRateGuard` respected before any AI call
- [ ] Safe defaults on error (never throw)
- [ ] Logging only via `@/lib/logger`; audit trail for state-changing ops
- [ ] Cache invalidation after write
- [ ] Docs updated (AGENTS.md version table, CHANGELOG v3.40.5, Primer, agent-memory, Lessons)

---

## 10. Expected Behavior

1. User adds `RELIANCE` to watchlist → **one** AI target generated for RELIANCE; Swing tab shows stored target; no other symbols scanned.
2. Brand-new user (no stored targets) opens Swing tab → seed runs **once**, seed flag set; reload shows stored targets with zero AI.
3. User with existing stored targets opens Swing tab → instant serve, **no** AI (regression guard for v3.40.4).
4. Watchlist-add for a symbol that already has a fresh stored target → no duplicate AI call.
5. AI provider down → `{ ok:false }`, audit logged, UI shows graceful error (no crash, no infinite retry).
6. Rate budget exceeded → call deferred/logged, not fatal.

---

## 11. Test Strategy

### Unit Tests (`lib/__tests__/swingAutoGenerateService.test.ts`)
- `generateSwingTargetForSymbol` happy path → persisted target, `ok:true`
- single-symbol: other symbols untouched
- duplicate/fresh target → no second AI call
- AI fail → `{ok:false,error}` safe return
- rate-limit → skip + log, not throw

### Unit Tests (`lib/__tests__/swingRecommendationService.test.ts`)
- `seedSwingTargetsOnce` first call → `seeded`, flag set
- second call → `no-op`
- existing stored targets → `no-op` (no AI)

### Integration
- POST without session → 401
- POST bad body → 400 (Zod)
- POST valid → 200 with seeded/target

### E2E (Playwright, headed)
- Add stock to watchlist → Swing tab shows targeting badge + stored target; network shows **zero** AI call on plain load
- Empty-state auto-seed appears once; reload serves stored

---

## 12. Definition of Done (gate)

- [ ] All functions per §4
- [ ] Files per §5
- [ ] Route contract per §7
- [ ] `npx tsc --noEmit` clean (0 new)
- [ ] `npm run test` — all pass (baseline 99/99 suites)
- [ ] `npm run lint` — 0 errors
- [ ] `npx playwright test` headed verify (watchlist-add + seed + no-AI-on-load)
- [ ] Docs updated per §9
- [ ] PR #131 extended with this feature
- [ ] No console errors at 375/768/1440

---

## 13. Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|-----------|----------|
| Watchlist-add storms (many adds) | Per-symbol debounce + single-symbol scope + rate guard | No |
| Seed runs before user expects AI | One-shot flag + only on genuinely-empty tab; clearly visible UI state | No |
| Duplicate AI calls | Fresh-target check before generation | No |

---

## 14. Open Questions for Approval

1. **Watchlist-add trigger source**: fire from the watchlist **add** UI (the `POST /api/watchlist` route) vs. the Swing tab button? — I recommend **the watchlist add route** (fires regardless of which page added it) hitting a fire-and-forget background job.
2. **Empty-seed blocking**: should the empty-state seed **block the first render** (spinner) or run in background and fill in when done? — I recommend **non-blocking** with an inline "Seeding…" state (keeps page-load guarantees).

Please approve (or adjust) this spec, then I'll write the plan and get your approval before implementing. 🚀
