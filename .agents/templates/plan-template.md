# Implementation Plan — [Feature Name]

> Generated from spec: `.agents/specs/NN-feature-name.md`
> Save to `.agents/plans/NN-feature-name.md`

## Spec Reference

- **Spec**: `.agents/specs/NN-feature-name.md`
- **Branch**: `feature/feature-name`
- **Created**: YYYY-MM-DD

---

## Implementation Steps

> Ordered steps. Each step is atomic — can be verified independently.
> Format: `[N] Step description → verify: [check command]`

### Phase 1: Database

1. **Add Prisma model(s)** to `prisma/schema.prisma` → verify: `npx prisma validate`
2. **Generate migration SQL** → `npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema prisma/schema.prisma --script > migration.sql` → verify: migration file exists with correct DDL
3. **Apply migration** → `npx prisma db execute --file migration.sql` (local) / commit migration dir (prod) → verify: `npx prisma db pull` shows new model
4. **Regenerate client** → `npx prisma generate` → verify: no errors

### Phase 2: Service Layer

5. **Implement service functions** in `lib/services/exampleService.ts` → verify: `npx tsc --noEmit` (0 new errors)
6. **Add audit tags** in `lib/audit.ts` → verify: tags exported
7. **Wire cache** (if applicable) → verify: cache invalidation on write path

### Phase 3: API Routes

8. **Create API route** in `app/api/example/route.ts` → verify: `curl localhost:3000/api/example` returns expected shape
9. **Add Zod validation** → verify: invalid input returns 400
10. **Add auth middleware** (if admin route) → verify: unauthenticated request returns 401

### Phase 4: UI Components

11. **Create component(s)** in `app/components/example/` → verify: `npx tsc --noEmit`
12. **Add loading/empty/error states** → verify: all three states render
13. **Wire into page** → verify: page loads with new component
14. **Responsive check** → verify: 375px, 768px, 1440px all render correctly

### Phase 5: Tests

15. **Write unit tests** in `lib/__tests__/exampleService.test.ts` → verify: `npm run test` passes
16. **Write integration tests** (if API route) → verify: route tests pass
17. **Write E2E tests** (if UI change) → verify: `npm run test:e2e` passes

### Phase 6: Documentation

18. **Update AGENTS.md** → verify: version row added
19. **Update CHANGELOG** → verify: `.agents/changelog/versions-v3.XX.md` created
20. **Update TODO.md** → verify: feature row added
21. **Update Primer.md** → verify: status updated
22. **Update agent-memory.md** → verify: activity entry added
23. **Update Lessons.md** (if new pattern discovered) → verify: lesson added
24. **Create session memory** → verify: `decisions.md` + `flow.md` in `.agents/sessions/`

---

## Test Strategy

### Unit Tests (Required)

| Test | File | What It Verifies |
|------|------|------------------|
| Valid input → success | `exampleService.test.ts` | Happy path |
| Invalid input → rejection | `exampleService.test.ts` | Zod validation |
| DB failure → safe default | `exampleService.test.ts` | Error handling |
| Cache hit → no DB call | `exampleService.test.ts` | Caching |
| Cache invalidation → DB read | `exampleService.test.ts` | Write-through |

### Integration Tests (If API Route)

| Test | What It Verifies |
|------|------------------|
| GET returns 200 + correct shape | Route wiring |
| GET returns 404 for missing resource | Not-found handling |
| POST returns 400 for invalid input | Validation |
| POST returns 401 without auth | Auth middleware |

### E2E Tests (If UI Change)

| Test | What It Verifies |
|------|------------------|
| Page loads with data | Component rendering |
| Empty state renders | Empty state handling |
| Mobile layout (375px) | Responsive design |
| Dark mode renders | Theme support |

---

## Verification Checklist

> Run these commands after implementation. All must pass.

```bash
# Type checking
npx tsc --noEmit                    # 0 new errors (baseline: 46)

# Tests
npm run test                        # All pass
npm run lint                        # No warnings

# Prisma
npx prisma validate                 # Schema valid
npx prisma generate                 # Client regenerated

# Build
npm run build                       # Production build succeeds (optional)
```

---

## Risks & Tradeoffs

> Document any known risks, trade-offs, or deferred items.

| Risk | Mitigation | Deferred |
|------|------------|----------|
| NSE API rate limit | Cache + retry with backoff | No |
| Large dataset query perf | Pagination + indexed columns | No |
| Multi-instance cron race | Atomic claim + dedup window | No |

---

## Documentation Checklist

> All docs must be updated before commit.

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

> Must pass before any commit.

1. `npx tsc --noEmit` — 0 new errors
2. `npm run test` — all pass
3. `npm run lint` — no warnings
4. `git status` — no junk artifacts, no secrets in diff
5. Documentation updated per checklist above
6. Engineering checklist (`.agents/rules/checklist.md`) validated
