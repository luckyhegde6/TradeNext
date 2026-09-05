# Implementation Plan — Screener / Backtest / Watchlist UI/UX Audit Fixes (v3.29.0)

> Generated from spec: `.agents/specs/07-ui-ux-audit-fixes.md`
> Save to `.agents/plans/07-ui-ux-audit-fixes.md`

## Spec Reference

- **Spec**: `.agents/specs/07-ui-ux-audit-fixes.md`
- **Branch**: `fix/v3.28.1-sqlite-self-heal` (same working branch; commit separately after v3.28.5)
- **Created**: 2026-09-05

---

## Implementation Steps

> Ordered steps. Each step is atomic — can be verified independently.
> No DB schema → no migration. No new dependencies.

### Phase 1: Backtest route — symbol-presence softening

1. **`app/api/backtest/run/route.ts`** — remove the `if (!symbolRecord) → 404` hard gate; keep the
   `prisma.symbol.findUnique` lookup ONLY to derive `symbolSource` (`"known"` when found, `"unlisted"` when
   missing); log the fall-through via `logger.warn` (symbol + source). Response gains `symbolSource`
   (server-derived). The existing `barCount < 50 → 400` guard stays the only "no data" failure.
   → verify: `npx tsc --noEmit` (0 new); `npx jest lib/__tests__/backtestSymbolFallthrough.test.ts`

### Phase 2: Watchlist AI failure surfacing

2. **NEW `lib/aiErrorMessage.ts`** — pure zero-dependency error extractor:
   `const message = typeof err.error === "string" ? err.error : err.error?.message ?? err.message ?? "AI analysis failed";`
   (decision per spec note: prefer the tiny pure module so tests don't mount the page).
   → verify: `npx tsc --noEmit` (0 new); `npx jest lib/__tests__/watchlistAiError.test.ts`

3. **`app/components/AiActionButton.tsx`** — optional `error?: string | null` prop rendered as a small red
   status line under the button (mirrors the existing rate-limit badge pattern); rate-limit badge + spinner
   behavior unchanged.
   → verify: `npx jest lib/__tests__/aiActionButton.test.tsx`

4. **`app/watchlist/page.tsx`** — use the extractor in `analyzeWithAI`'s catch; pass the computed `aiError`
   into `AiActionButton`'s `error` prop.
   → verify: `npx tsc --noEmit` (0 new); page-level Playwright check at 375px + desktop

### Phase 3: Mobile nav — Alerts link

5. **Header mobile menu** (in the `app/Header.tsx` component tree) — add the existing `/alerts` link using the
   exact href/icon convention of the neighbouring mobile `Link`s (Dashboard/Portfolio/F&O group or its own row
   next to Watchlist). Desktop header untouched.
   → verify: Playwright at 375px (Alerts reachable) + 1440px (desktop header unchanged)

### Phase 4: Tests

6. **`lib/__tests__/watchlistAiError.test.ts`** — extractor truth table: string `err.error`, nested
   `{ error: { message } }` (the real `/api/ai/query` 500 shape), both missing → fallback, `null`/undefined err.
7. **`lib/__tests__/aiActionButton.test.tsx`** — `error` line renders; error absent → no line; rate badge unchanged.
8. **`lib/__tests__/backtestSymbolFallthrough.test.ts`** — route-level (mock `@/lib/prisma` + `getBacktestData`):
   unlisted symbol w/ ≥50 bars → 200 + `symbolSource:"unlisted"`; unlisted w/ <50 bars → 400; listed → 200 + `"known"`.
   → verify: `npx jest lib/__tests__/watchlistAiError.test.ts lib/__tests__/aiActionButton.test.tsx lib/__tests__/backtestSymbolFallthrough.test.ts`

### Phase 5: Verification + docs

9. `npx tsc --noEmit` → **46 = exact baseline (0 new)**; targeted suites green; adjacent watchlist/backtest
   suites green.
10. Docs: AGENTS.md v3.29.0 row, `.agents/changelog/versions-v3.29.md` (new), `.agents/CHANGELOG.md` index,
    TODO.md row, Primer.md, agent-memory.md, Lessons (error-shape lesson if new), session memory.

---

## Test Strategy

### Unit Tests (Required)

| Test | File | What It Verifies |
|------|------|------------------|
| Extractor truth table | `watchlistAiError.test.ts` | string vs nested `error.message` vs fallback |
| Error line renders | `aiActionButton.test.tsx` | New `error` prop UI, rate badge unchanged |
| Fall-through 200/400/known | `backtestSymbolFallthrough.test.ts` | Softened gate + `symbolSource` |

### E2E (Playwright, manual run)

| Scenario | What It Verifies |
|----------|------------------|
| Watchlist Analyze with AI credits exhausted | Red error line under button (no silent `[object Object]`) |
| Backtest RBLBANK | 200 with trades + `symbolSource:"unlisted"` + dataSource |
| Mobile nav at 375px | Alerts link reachable |

---

## Verification Checklist

```bash
# Type checking
npx tsc --noEmit                    # 46 = exact baseline (0 new)

# Tests
npx jest lib/__tests__/watchlistAiError.test.ts lib/__tests__/aiActionButton.test.tsx lib/__tests__/backtestSymbolFallthrough.test.ts
npm run test                        # full suite

# Prisma
npx prisma validate                 # Schema valid (unchanged)
```

---

## Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| Unlisted symbol with <50 bars still 400s | By design — that IS the no-data case; UI hint `symbolSource` tells why | No |
| Page-export vs pure-module extractor | Spec note resolves: tiny `lib/aiErrorMessage.ts` keeps tests light | No |
| Mobile menu markup churn | Surgical: reuse existing mobile `Link` conventions, verify desktop untouched | No |
| Per-row source badge / dead AI modal removal | Kept out of scope (spec OUT list) | Yes |

---

## Documentation Checklist

- [ ] **AGENTS.md** — v3.29.0 version row
- [ ] **CHANGELOG** — `.agents/changelog/versions-v3.29.md` + index update
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
3. `git status` — no junk artifacts, no secrets in diff
4. Documentation updated per checklist above
5. Engineering checklist (`.agents/rules/checklist.md`) validated