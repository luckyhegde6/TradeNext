# UX Enhancer Skill

Audits and improves TradeNext UI/UX. Follows repo checklist (`TODO.md` + `.agents/rules/checklist.md`): loading, error, empty, responsive, dark/light.

## Pre-flight

```bash
npm run local          # or npm run dev (port 3000)
# demo@tradenext6.app / demo123 · admin@tradenext6.app / admin123
```

## Page audit checklist

| Aspect | Pass criteria |
|--------|---------------|
| Loading state | Skeleton/pulse while fetching, not blank |
| Error state | Retry button + message, no silent failure |
| Empty state | "No data" / CTA, no crash |
| Responsive | 375/768/1920px — no overflow, scrollable tables |
| Dark/light | Toggle works, readable contrast |
| Console | Zero errors after every interaction |
| A11y | Snapshot a11y tree; labeled buttons |
| Performance | No heavy client renders; lazy load below fold |

## Enhancement principles (ponytail style)

- Minimum code that solves the problem — nothing speculative.
- Reuse existing components (`LoadingSpinner`, `DataTable`, `LivePriceBadge`).
- Client components only where interactivity requires; server components otherwise.
- Match existing Tailwind patterns.
- Surgical changes — don't "improve" adjacent code.

## Playwright verification

```
1. Navigate to page.
2. Snapshot — verify all states render.
3. Console errors after each interaction.
4. Resize 375/768/1920.
5. Toggle dark/light.
6. Test sort, filter, pagination, forms, modals.
7. Cleanup: kill only processes you started (3000/3001), never 4096.
```

## Common TradeNext UX gaps (check first)

- Columns sortable in UI but API rejects → fix API or disable sortable (bug-finder territory).
- Null fields rendering bare `%` / `🟡` — hide or default gracefully.
- Tables not horizontally scrollable on mobile.
- Long lists without pagination / "load more" cap.
- Live prices not wired into portfolio/watchlist tables (SSE hooks exist).

## Deliverable format

```markdown
## UX Audit: <Page>
- [x] Loading / [x] Error / [x] Empty / [x] Responsive / [x] Dark mode / [x] Console clean
- Issues found: N
- Fixes applied: ...
- Left for later (documented in TODO.md): ...
```

Source: `.opencode/skills/ux-enhancer/SKILL.md`
