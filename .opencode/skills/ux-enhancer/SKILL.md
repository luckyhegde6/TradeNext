---
name: ux-enhancer
description: UI/UX enhancement and audit workflow for TradeNext - audit pages for completeness (loading/empty/error states, responsive, dark mode), verify with Playwright, enhance without over-engineering
metadata:
  audience: agents
  workflow: quality
---

# UX Enhancer Skill

Audits and improves TradeNext's UI/UX. Follows the repo's UI/UX checklist (`TODO.md` + `.agents/rules/checklist.md`): loading state, error state, empty state, responsive, dark/light mode.

## 1. Pre-flight

```bash
npm run local          # or npm run dev (port 3000)
# Credentials: demo@tradenext6.app / demo123, admin@tradenext6.app / admin123
```

## 2. Page audit checklist (every page touched)

| Aspect | Pass criteria |
|--------|---------------|
| Loading state | Skeleton/pulse while fetching, not blank |
| Error state | Retry button + message, no silent failure |
| Empty state | "No data" / CTA when empty, no crash |
| Responsive | 375px / 768px / 1920px — no overflow, scrollable tables |
| Dark/light mode | Toggle works, no unreadable contrast |
| Console | Zero errors after every interaction |
| Accessibility | Snapshot a11y tree; buttons have labels |
| Performance | No heavy client renders; lazy load below fold |

## 3. Enhancement principles (ponytail style)

- **Minimum code that solves the problem** — no speculative features.
- Reuse existing components (`LoadingSpinner`, `DataTable`, `LivePriceBadge`).
- Client components only where interactivity requires it; server components otherwise.
- Match existing Tailwind patterns — don't introduce new styling systems.
- Don't "improve" adjacent code; surgical changes only.

## 4. Verification workflow (Playwright)

```
1. Navigate to page (start dev server if needed).
2. Take snapshot — verify all states render.
3. Check console errors after each interaction.
4. Resize 375/768/1920 — verify responsive.
5. Toggle dark/light — verify contrast.
6. Test interactions: sort, filter, pagination, forms, modals.
7. Cleanup: kill only processes you started (port 3000/3001), never 4096.
```

## 5. Common TradeNext UX gaps (check first)

- Table columns sortable in UI but API rejects → **bug-finder** territory (fix API or disable sortable).
- Null fields rendering as bare `%` / `🟡` — hide or default gracefully.
- Tables not horizontally scrollable on mobile.
- Long lists without pagination or "load more" cap.
- Live prices not wired into portfolio/watchlist tables (SSE hooks exist).

## 6. Deliverable format

```markdown
## UX Audit: <Page>
- [x] Loading / [x] Error / [x] Empty / [x] Responsive / [x] Dark mode / [x] Console clean
- Issues found: N
- Fixes applied: ...
- Left for later (documented in TODO.md): ...
```

## Checklist

- [ ] Loading, error, empty states all present
- [ ] Responsive 375/768/1920 verified
- [ ] Dark/light mode verified
- [ ] Zero console errors
- [ ] Playwright snapshot documented
- [ ] Cleanup dev server (only processes you started)
