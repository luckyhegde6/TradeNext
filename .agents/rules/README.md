# TradeNext Coding Standards

## Agentic Operating Rules

- **`.agents/RULES.md`** — Master agentic rules (session/memory discipline, git, sensitive ops, security, checklist gate). Read on first session / fresh clone.
- **`.agents/SOUL.md`** — Agent identity & principles (think-first, minimal code, trustworthy, surgical, memory discipline, done definition).
- **`.agents/rules/session-memory-rules.md`** — Session start read-order, todo maintenance cadence, session archives, handoff updates, mandatory documentation updates, git guidelines summary, context/token efficiency, subagent sessions.
- **`.agents/rules/checklist.md`** — Engineering guardrail checklist (v1.2) — hard contract for all changes.
- See also `.agents/code-hygiene.md` (ponytail minimal code, file size/function limits), `.agents/linear-history.md` (git flow), `.agents/pre-commit-workflow.md`, `.agents/security-checklist.md`, `.agents/documentation-standards.md`.

## TypeScript Rules

- **Strict mode enabled** - do not disable strict checks
- Use explicit return types for exported functions
- Use `unknown` for external API responses, then narrow with type guards
- Avoid `any`; use `unknown` or proper typing instead
- Always parse strings to numbers: `parseFloat()`, `parseInt()`

## Import Order

1. React imports (`useState`, `useEffect`, etc.)
2. External libraries (`clsx`, `swr`, etc.)
3. Internal modules from `@/lib/`
4. Local imports

```typescript
// Correct order
import { useState, useEffect } from "react";
import clsx from "clsx";
import logger from "@/lib/logger";
import { nseFetch } from "@/lib/nse-client";
import prisma from "@/lib/prisma";
```

## Naming Conventions

- **Files**: kebab-case for utilities (`cache.ts`), PascalCase for components (`DataTable.tsx`)
- **Interfaces**: PascalCase (`StockQuote`, `Column<T>`)
- **Variables/functions**: camelCase
- **Constants**: SCREAMING_SNAKE_CASE

## Error Handling

- Use logger from `@/lib/logger` for all logging
- Log with context using object syntax
- Always return safe defaults on error

```typescript
// Good
logger.info({ msg: 'Fetching stock quote', symbol });
logger.warn({ msg: 'DB lookup failed', symbol, error: err });
logger.error({ msg: 'Sync failed', symbol: quote.symbol, error: e });

// Always return safe defaults
try {
  return await fetchData();
} catch (e) {
  logger.error({ msg: 'Failed to fetch', error: e instanceof Error ? e.message : String(e) });
  return [];
}
```

## React/Next.js

- Client components: Use `"use client"` at top
- Server Components: Default in App Router
- Use generic types for reusable components

## Testing

- Test files: `__tests__/*.test.ts` or `*.test.ts`
- Clear mocks in `beforeEach`
- Use `@testing-library/react` for components
- Aim for meaningful test coverage

## Security

- Never expose secrets in logs
- Validate all external input
- Use parameterized queries via Prisma
- Sanitize user content
