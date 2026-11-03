# Implementation Plan — Spec 38: RefSite-style Theme Refresh + Design System

> Generated from spec: `.agents/specs/38-refsite-style-theme-refresh.md`
> Save to `.agents/plans/38-refsite-style-theme-refresh.md`
> Branch: `feature/refsite-style-theme-refresh` (off `main`)
> Created: 2026-11-03
> Status: **PLAN DRAFT — pending human approval before implementation (D9)**

---

## Spec Reference

- **Spec**: `.agents/specs/38-refsite-style-theme-refresh.md`
- **Branch**: `feature/refsite-style-theme-refresh`
- **Created**: 2026-11-03

---

## Implementation Steps

> Ordered steps. Each step is atomic — can be verified independently.
> Format: `[N] Step description → verify: [check command]`

### Phase 1: Design tokens (CSS)

1. **Replace `:root` block in `app/globals.css`** with the full RefSite light token set (Appendix A.1) → verify: `npx tsc --noEmit` (no CSS typecheck, but visual check on :3000)
2. **Add `.dark` class block** with dark token set (Appendix A.2) → verify: toggling `.dark` on `<html>` swaps all colors
3. **Update `body` rule** — font-family `var(--font-body)`, background-image `var(--page-glow)`, `background-attachment: fixed` → verify: page glow visible
4. **Add `surface-card` / `glow-brand` utility classes** in globals.css → verify: class applies shadow

### Phase 2: Tailwind config

5. **Extend `tailwind.config.ts`** — colors (background, foreground, surface, border, up, down, flat, warn, info, chart 1-8, heat-*, brand, muted), fontFamily (sans, heading), borderRadius (DEFAULT/card/pill), boxShadow (card/raised/pop/glow/inset/control/header) → verify: `npx tsc --noEmit` 0 errors
6. **Verify utility classes resolve** — `bg-surface`, `text-muted-foreground`, `shadow-card`, `rounded-card`, `font-heading` → verify: dev server renders without "unknown utility" warnings

### Phase 3: Fonts

7. **Wire Outfit + Inter via `next/font/google`** in `app/layout.tsx` → verify: `--font-heading` and `--font-body` variables set on `<html>`
8. **Update font-family in Tailwind config** to use `var(--font-heading)` / `var(--font-body)` → verify: headings render in Outfit, body in Inter

### Phase 4: Dark mode toggle

9. **Create `lib/hooks/useTheme.ts`** — reads `localStorage('theme')`, applies `.dark` class to `<html>`, default light → verify: unit test passes
10. **Add ThemeToggle button in `app/Header.tsx`** → verify: clicking toggles class + persists
11. **Remove `prefers-color-scheme` media query** from globals.css (replaced by `.dark` class) → verify: dark mode only via toggle

### Phase 5: Header

12. **Update `app/Header.tsx`** — `sticky top-0 z-40 h-14 bg-surface shadow-header` → verify: header sticky at 56px with shadow
13. **Add dark toggle button** to header → verify: visible and functional

### Phase 6: Card component

14. **Create/update `app/components/ui/Card.tsx`** with `surface-card` + `glow-brand` classes → verify: card renders with layered shadow
15. **Apply `surface-card` to existing cards** (dashboard, portfolio, screener) → verify: visual check on :3000

### Phase 7: Button micro-interactions

16. **Update `app/components/ui/Button.tsx`** — add transition + `active:scale-[0.97]` + focus-visible ring → verify: button scales on press

### Phase 8: Main container + page glow

17. **Update main layout container** — `max-w-[1800px]` + responsive padding → verify: no overflow at 375px
18. **Page glow** already in body (Phase 1) → verify: radial gradients visible

### Phase 9: Semantic colors

19. **Replace ad-hoc `text-green-600`/`text-red-600`** with `text-up`/`text-down` in P&L, gains, alerts components → verify: grep shows no hardcoded green/red for P&L
20. **Wire chart palette** — feed `--chart-1..8` into Recharts/TradingView chart configs → verify: charts render with new colors

### Phase 10: Tests

21. **Write `useTheme` unit test** → verify: `npm run test` passes
22. **Playwright E2E**: theme toggle, dark persistence, responsive (375/768/1440), 0 console errors in light+dark → verify: `npm run test:e2e` passes

### Phase 11: Documentation

23. **Update AGENTS.md** — version row (v3.55.0 or next)
24. **Update CHANGELOG** — `.agents/changelog/versions-v3.55.md` + index
25. **Update TODO.md, Primer.md, agent-memory.md, Lessons.md, session-todos.md, handoff**
26. **Create session memory** — `decisions.md` + `flow.md`

---

## Test Strategy

### Unit Tests (Required)

| Test | File | What It Verifies |
|------|------|------------------|
| Theme toggle applies `.dark` class | `useTheme.test.ts` | Class toggling |
| Theme persists to localStorage | `useTheme.test.ts` | Persistence |
| Theme reads initial from localStorage | `useTheme.test.ts` | Initial state |
| Default theme is light | `useTheme.test.ts` | Default |

### E2E Tests (Required — UI change)

| Test | What It Verifies |
|------|------------------|
| Theme toggle switches `.dark` on `<html>` | Toggle works |
| Dark mode persists after reload | Persistence |
| No console errors on home in light + dark | Clean render |
| No console errors on portfolio in light + dark | Clean render |
| No horizontal overflow at 375px (light + dark) | Responsive |
| Cards render with shadow (visual) | Card treatment |

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
npm run dev                         # Check :3000 in light + dark, 375/768/1440
```

---

## Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| Token migration breaks existing component styles | Apply tokens incrementally; visual regression via Playwright screenshots | No |
| Font loading FOUT | `display: 'swap'` + next/font self-hosting | No |
| Dark mode toggle flash on load | Inline script in `<head>` sets class before paint | No |
| Tailwind config errors | Validate with `npx tsc --noEmit` + dev server | No |
| `lenis` smooth scroll | Deferred to later (optional) | Yes |
| Heat-map tiers (component) | Token only in v1; component in Spec 37 | Yes |

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

**End of Plan 38.** Implementation pending human approval (D9).
