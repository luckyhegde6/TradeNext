# UX Audit Command

> Audit a TradeNext page for UI/UX completeness and enhance without over-engineering.

## Usage

```
/ux-audit [page] [mode]
```

### Parameters

| Parameter | Required | Description | Values |
|-----------|----------|-------------|--------|
| `page` | - | Page to audit | current route (default), `/recommendations`, `/portfolio`, `/alerts`, any |
| `mode` | - | Audit or enhance | `audit` (default), `fix` |

### Examples

```
/ux-audit                    # Audit current page
/ux-audit /recommendations   # Audit recommendations page
/ux-audit /alerts fix        # Audit + apply fixes
```

## Workflow

### 1. Pre-flight
```bash
npm run local          # or npm run dev (port 3000)
# demo@tradenext6.app / demo123 · admin@tradenext6.app / admin123
```

### 2. Audit Checklist
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

### 3. Enhance (mode=fix)
- **Minimum code that solves the problem** — no speculative features
- Reuse existing components (`LoadingSpinner`, `DataTable`, `LivePriceBadge`)
- Client components only where interactivity requires
- Match existing Tailwind patterns; surgical changes only

### 4. Verify (Playwright)
```
1. Navigate to page
2. Snapshot — verify all states render
3. Console errors after each interaction
4. Resize 375/768/1920
5. Toggle dark/light
6. Test sort, filter, pagination, forms, modals
7. Cleanup: kill only processes you started (3000/3001), never 4096
```

### 5. Report
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
- [ ] Contract mismatch found → handed to /find-bugs
