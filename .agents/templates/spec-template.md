# Spec Document — [Feature Name]

> Copy this template for every new feature. Fill in ALL sections. Delete N/A sections only with justification.
> Save to `.agents/specs/NN-feature-name.md` (NN = sequential number per branch/epic).

## 1. Overview

**What**: One-paragraph description of the feature/fix.

**Why**: The problem this solves or the gap it fills. Link to GitHub issue, user request, or prod log if applicable.

**Scope**: Explicitly state what is IN scope and what is OUT of scope.

**Depends on**: Previous features, migrations, or services this builds on. "Nothing" if first step.

---

## 2. Routes

> List ALL API routes (existing modified + new) this feature touches.

### New Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/example` | public | Fetch example data |
| POST | `/api/admin/example` | admin | Create example |

### Modified Routes

| Method | Path | Change |
|--------|------|--------|
| GET | `/api/existing` | Added `example` query param |

---

## 3. Database Schema

> New Prisma models + modifications to existing models. Include the exact Prisma snippet.

### A. New Model: `ExampleModel`

```prisma
model ExampleModel {
  id        String   @id @default(cuid())
  userId    String
  name      String
  value     Float?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id])

  @@index([userId])
  @@map("example_models")
}
```

### B. Modifications to Existing Models

```prisma
// Add to existing User model:
model User {
  // ... existing fields ...
  examples ExampleModel[]  // NEW relation
}
```

### C. Migration Notes

- Migration name: `2026MMDDHHMMSS_add_example_model`
- Applied via: `prisma migrate dev --name <name>` (dev) / `migrate deploy` (prod)
- ⚠️ Local DB caveat: if local DB has no `_prisma_migrations` ledger, use `migrate diff --to-schema` + `db execute` instead of `migrate dev`

---

## 4. Functions to Implement

> Every function/class this feature requires. Include signature, purpose, and key behavior.

### A. `lib/services/exampleService.ts`

#### `getExample(id: string): Promise<Example | null>`

- Fetches example by ID from DB
- Returns `null` if not found (never throws)
- Cache: `node-cache` 60s TTL

#### `createExample(input: CreateExampleInput): Promise<Example>`

- Validates input via Zod schema
- Creates record in DB
- Audits: `EXAMPLE_CREATED` tag
- Returns created record

---

## 5. Files to Change

> Every file that needs modification. Include the nature of the change.

| File | Change Type | Description |
|------|-------------|-------------|
| `prisma/schema.prisma` | Modified | Add `ExampleModel` |
| `lib/services/exampleService.ts` | **Created** | Core service |
| `app/api/example/route.ts` | **Created** | API endpoint |
| `app/components/example/ExampleCard.tsx` | **Created** | UI component |
| `lib/__tests__/exampleService.test.ts` | **Created** | Tests |
| `lib/audit.ts` | Modified | Add audit tags |

---

## 6. Dependencies

### New Packages

| Package | Version | Reason |
|---------|---------|--------|
| None | — | — |

### Internal Dependencies

| Module | Function Used | Purpose |
|--------|---------------|---------|
| `@/lib/prisma` | `prisma.exampleModel.findUnique` | DB access |
| `@/lib/logger` | `logger.info/warn/error` | Structured logging |
| `@/lib/audit` | `audit()` | Audit trail |

---

## 7. API Contract

> Request/response shapes for every route. Include Zod schemas.

### GET /api/example

**Query Params:**
```typescript
{ id: string }  // required
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "clx...",
    "name": "Example",
    "value": 42.5
  }
}
```

**Response (404):**
```json
{
  "success": false,
  "error": "Example not found"
}
```

---

## 8. UI/UX Requirements

> If the feature has a UI component.

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `ExampleCard.tsx` | `app/components/example/` | Display single example |

### States

- **Loading**: Skeleton loader (pulsing placeholder)
- **Empty**: "No examples yet" with CTA button
- **Error**: "Failed to load" with retry button
- **Data**: Card with name, value, timestamp

### Responsive

- Desktop (1440px): Full layout
- Tablet (768px): Stacked layout
- Mobile (375px): Single column, horizontal scroll for tables

---

## 9. Rules & Guardrails

> Technology-specific rules that MUST be followed.

- [ ] No Prisma in client components
- [ ] All DB operations use parameterized queries (Prisma handles this)
- [ ] Server-side proxy only for NSE API — never call from client
- [ ] All external inputs validated via Zod
- [ ] Errors return safe defaults, never expose internals
- [ ] Logging via `@/lib/logger` only (no `console.log`)
- [ ] Background sync is fire-and-forget (never blocks HTTP response)
- [ ] Cache invalidation on write (not just TTL expiry)
- [ ] Audit trail for all state-changing operations

---

## 10. Expected Behavior

> Concrete, testable descriptions of what should happen.

1. `getExample("valid-id")` returns the example record with all fields populated
2. `getExample("nonexistent")` returns `null` (no error thrown)
3. `createExample({ name: "Test" })` creates a record and returns it with generated `id` and `createdAt`
4. `createExample({})` (missing required `name`) throws Zod validation error
5. API `GET /api/example?id=valid` returns 200 with the example data
6. API `GET /api/example?id=nonexistent` returns 404 with error message
7. UI shows skeleton during loading, data when loaded, empty state when no data
8. Mobile layout (375px) renders without horizontal overflow

---

## 11. Error Handling

> How each failure mode is handled.

| Scenario | Behavior | Log Level |
|----------|----------|-----------|
| DB connection failure | Return safe default (`[]` or `null`) | `error` |
| Invalid input | Throw Zod error → 400 response | `warn` |
| NSE API timeout | Fallback to cache, log warning | `warn` |
| Cache miss + NSE fail | Return empty, don't throw | `error` |

---

## 12. Test Strategy

> What tests are required and where they live.

### Unit Tests (`lib/__tests__/exampleService.test.ts`)

- [ ] `getExample` returns record for valid ID
- [ ] `getExample` returns null for nonexistent ID
- [ ] `createExample` persists and returns record
- [ ] `createExample` validates input (Zod rejection)
- [ ] DB failure returns safe default (no throw)

### Integration Tests

- [ ] API route returns correct response shape
- [ ] API route returns 404 for missing resource

### E2E Tests (`e2e/`)

- [ ] UI renders example card with data
- [ ] UI shows empty state when no data
- [ ] Responsive layout works at 375px

---

## 13. Performance Considerations

> Caching, pagination, query optimization.

- **Cache**: NodeCache 60s TTL for reads; invalidate on write
- **Pagination**: OFFSET/LIMIT for list endpoints (max 100 per page)
- **Queries**: Use `findMany` with `where` clause (indexed fields only)
- **Batching**: Use `createMany` for bulk inserts (not N individual creates)

---

## 14. Security Considerations

> Auth, RBAC, input sanitization, secrets.

- **Auth**: Public routes return only safe data; admin routes require `adminAuthMiddleware`
- **Input**: All inputs validated via Zod before DB access
- **Secrets**: Never in client components, never in logs, never in `NEXT_PUBLIC_*` env
- **RBAC**: Admin-only operations gated by role check

---

## 15. Definition of Done

> checkboxes that MUST all pass before the feature is complete.

- [ ] All functions implemented per section 4
- [ ] All files created/modified per section 5
- [ ] All routes working per section 2 + contract in section 7
- [ ] Prisma schema updated + migration applied
- [ ] `npx prisma generate` run (client regenerated)
- [ ] Unit tests written and passing (`npm run test`)
- [ ] `npx tsc --noEmit` passes (0 new errors beyond baseline)
- [ ] `npm run lint` passes
- [ ] UI states (loading/empty/error/data) all implemented
- [ ] Responsive at 375px, 768px, 1440px
- [ ] Dark/light mode renders correctly
- [ ] Audit trail for state-changing operations
- [ ] Cache invalidation on write
- [ ] Error handling per section 11 (safe defaults, no thrown internals)
- [ ] Documentation updated (AGENTS.md, CHANGELOG, TODO, Primer, agent-memory, Lessons)
- [ ] Live-verified on :3000 (if UI change)
- [ ] 0 console errors in browser
