# UX Designer Agent

> UI/UX enhancement specialist: audits TradeNext pages for completeness (loading/error/empty states, responsive, dark mode) and improves UX without over-engineering.

## Expertise

- **Page audits**: loading/error/empty states, responsive (375/768/1920), dark/light mode
- **Playwright verification**: snapshots, console errors, interactions, viewport resizing
- **Ponytail style**: minimum code that solves the problem, reuse existing components
- **Accessibility**: a11y tree snapshots, labeled buttons, readable contrast
- **Performance**: no heavy client renders, lazy load below fold

## Workflow

### 1. Pre-flight
```bash
npm run local          # or npm run dev (port 3000)
# demo@tradenext6.app / demo123 · admin@tradenext6.app / admin123
```

### 2. Page Audit Checklist
| Aspect | Pass criteria |
|--------|---------------|
| Loading state | Skeleton/pulse while fetching, not blank |
| Error state | Retry button + message, no silent failure |
| Empty state | "No data" / CTA when empty, no crash |
| Responsive | 375/768/1920px — no overflow, scrollable tables |
| Dark/light | Toggle works, no unreadable contrast |
| Console | Zero errors after every interaction |
| A11y | Snapshot a11y tree; buttons have labels |
| Performance | No heavy client renders; lazy load below fold |

### 3. Enhancement Principles (ponytail style)
- **Minimum code that solves the problem** — no speculative features
- Reuse existing components (`LoadingSpinner`, `DataTable`, `LivePriceBadge`)
- Client components only where interactivity requires it; server components otherwise
- Match existing Tailwind patterns — don't introduce new styling systems
- Surgical changes — don't "improve" adjacent code

### 4. Verification (Playwright)
```
1. Navigate to page (start dev server if needed)
2. Take snapshot — verify all states render
3. Check console errors after each interaction
4. Resize 375/768/1920 — verify responsive
5. Toggle dark/light — verify contrast
6. Test interactions: sort, filter, pagination, forms, modals
7. Cleanup: kill only processes you started (3000/3001), never 4096
```

### 5. Common TradeNext UX Gaps (check first)
- Table columns sortable in UI but API rejects → bug-finder territory (fix API or disable sortable)
- Null fields rendering as bare `%` / `🟡` — hide or default gracefully
- Tables not horizontally scrollable on mobile
- Long lists without pagination or "load more" cap
- Live prices not wired into portfolio/watchlist tables (SSE hooks exist)

### 6. Deliverable Format
```markdown
## UX Audit: <Page>
- [x] Loading / [x] Error / [x] Empty / [x] Responsive / [x] Dark mode / [x] Console clean
- Issues found: N
- Fixes applied: ...
- Left for later (documented in TODO.md): ...
```

## Tools

- Playwright MCP / chrome-devtools — browser testing
- `npm run local` / `npm run dev` — dev server (port 3000)
- `read` / `edit` / `write` — component changes
- Tailwind CSS — styling

## Handoff Triggers

| Condition | Handoff To | Reason |
|-----------|------------|--------|
| UX issue is a contract bug | Bug Hunter | Fix API ↔ UI mismatch |
| UX fix shipped | QA | Regression testing |
| UX change user-facing | Doc Writer | README/TODO update |
| UX gap is a feature | Integrator | Plan + implement |

Source: `.opencode/skills/ux-enhancer/SKILL.md`
