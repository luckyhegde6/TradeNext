# Implementation Plan — Google Sheets Header-Label Fix

> Generated from spec: `.agents/specs/26-google-sheets-header-label-fix.md`
> Save to `.agents/plans/26-google-sheets-header-label-fix.md`

## Spec Reference

- **Spec**: `.agents/specs/26-google-sheets-header-label-fix.md`
- **Branch**: `fix/daily-rec-swing-cron-worker`
- **Created**: 2026-10-09

---

## Implementation Steps

> Ordered steps. Each step is atomic — can be verified independently.

### Phase 1: Align the contract

1. **Fix `type HeaderState`** (`page.tsx:17`) → `"matched" | "drifted" | "absent" | "unknown"` → verify: `npx tsc --noEmit`
2. **Rewrite `HEADER_BADGE`** (`page.tsx:124-131`) with the four server keys + correct labels → verify: `npx tsc --noEmit`
3. **Change the `absent` label** to "no header yet" (blue) → verify: read
4. **Export `HEADER_BADGE`** for testing (only production change beyond the map) → verify: `npx tsc --noEmit`

### Phase 2: Test

5. **Add `lib/__tests__/googleSheetsHeaderBadge.test.ts`** asserting each server state maps to a defined badge → verify: `npm run test`

### Phase 3: Verify

6. **Playwright** `/admin/google-sheets` (admin login) shows "header ok" for `custom`/`metrics` → verify: no console errors
7. **Responsive + dark-mode** spot check (375px / desktop) → verify: badges render

### Phase 4: Documentation

8. **AGENTS.md** version row + **CHANGELOG** → verify: added
9. **TODO.md / Primer.md / agent-memory.md** → verify: updated
10. **Session memory** (`decisions.md` + `flow.md`) → verify: updated

---

## Test Strategy

### Unit Tests (Required)

| Test | File | What It Verifies |
|------|------|------------------|
| `matched` → "header ok" | `googleSheetsHeaderBadge.test.ts` | Correct match label |
| `drifted` → "header drifted" | `googleSheetsHeaderBadge.test.ts` | Correct drift label |
| `absent` → "no header yet" | `googleSheetsHeaderBadge.test.ts` | Non-misleading label |
| `unknown` → "unknown" | `googleSheetsHeaderBadge.test.ts` | Defensive fallback |
| every server state defined | `googleSheetsHeaderBadge.test.ts` | No undefined badge |

### E2E Tests (If UI Change)

| Test | What It Verifies |
|------|------------------|
| Admin page renders correct badges | Label mapping end-to-end |
| Mobile layout (375px) | Responsive unchanged |

---

## Verification Checklist

```bash
npx tsc --noEmit     # 0 new errors (baseline: 46)
npm run test         # All pass
npm run lint         # No warnings
npm run test:e2e     # Admin GS spec (or a targeted grep run)
```

---

## Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| Server adds a new state later | Defensive `?? unknown` fallback remains | No |
| Importing server type breaks client bundle | Use `import type` only (erased) | No |

---

## Documentation Checklist

- [ ] **AGENTS.md** — version row in table
- [ ] **CHANGELOG** — detail in `.agents/changelog/versions-v3.47.md`
- [ ] **TODO.md** — quick-reference row
- [ ] **Primer.md** — status updated
- [ ] **agent-memory.md** — activity entry
- [ ] **Session memory** — `decisions.md` + `flow.md`

---

## Pre-Commit Gate

1. `npx tsc --noEmit` — 0 new errors
2. `npm run test` — all pass
3. `npm run lint` — no warnings
4. `git status` — no junk artifacts, no secrets
5. Documentation updated
6. Engineering checklist validated
