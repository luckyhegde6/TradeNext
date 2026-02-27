# AGENTS.md - TradeNext Development Guide

## Overview
TradeNext is a Next.js 16 application with TypeScript, Tailwind CSS, Prisma, and Jest. It provides stock market data visualization and portfolio management for NSE (India).

## Version History
- **v1.1.0** - Added Stock Recommendations, User Alerts, Audit Logging, Rate Limiting, Admin Holdings Management
- **v1.0.0** - Initial release

## Required Reading for AI Agents

Before making any changes, AI agents MUST read and validate against:

1. **`.ai/rules/checklist.md`** - Engineering guardrails (hard contract)
2. **`TODO.md`** - Implementation priorities
3. **`ai/AGENT_INSTRUCTIONS.md`** - Agent operating principles

---

## Build, Lint & Test Commands

### Development
```bash
npm run dev              # Start Next.js dev server
npm run dev:local        # Full local dev with cross-platform support
npm run dev:clean        # Clean restart
npm run dev:only-host    # Start dev server only (host mode)
```

### Building
```bash
npm run build            # Run Prisma migrations + Next.js build
npm run quickbuild       # Next.js build only (skip migrations)
npm run start            # Start production server
```

### Linting
```bash
npm run lint             # Run Next.js ESLint
```

### Testing
```bash
npm run test             # Run all tests
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage report
```

**Running a single test:**
```bash
# Run specific test file
npm run test -- lib/__tests__/cache.test.ts

# Run tests matching a pattern
npm run test -- --testNamePattern="Cache Operations"

# Run specific test file with watch mode disabled
npm run test -- lib/__tests__/cache.test.ts --watchAll=false
```

### Database (Prisma)
```bash
npm run prisma:gen       # Generate Prisma client
npm run prisma:migrate   # Run migrations
npm run prisma:studio    # Open Prisma Studio
npm run db:up            # Start local DB (docker)
npm run db:down          # Stop local DB
npx prisma db seed       # Seed database with demo + admin users
```

### Data Ingestion
```bash
npm run ingest:run       # Run NSE CSV ingestion
npm run ingest:zip       # Ingest from NSE ZIP file
```

---

## OpenCode Setup

### Install & Launch
```bash
# Install OpenCode
npm install -g opencode

# Launch web UI (recommended)
opencode --web

# Or start in terminal
opencode .
```

### Quick Commands
- `/tdd` - Run TDD workflow
- `/code-review` - Review code
- `/build-fix` - Fix build errors
- `/plan [feature]` - Plan implementation

See `.opencode/README.md` for full guide.

---

## Code Style Guidelines

> **Important:** See `.ai/rules/checklist.md` for mandatory engineering checks

### TypeScript
- **Strict mode enabled** in `tsconfig.json` - do not disable strict checks
- Use explicit return types for exported functions
- Use `unknown` for external API responses, then narrow with type guards
- Avoid `any`; use `unknown` or proper typing instead

```typescript
// Good
interface StockQuote {
  symbol: string;
  lastPrice: number;
}

// Good - narrowing unknown
const data = response as { metaData?: any };
const price = typeof data.metaData?.lastPrice === 'string' 
  ? parseFloat(data.metaData.lastPrice) 
  : 0;
```

### Imports
- Use path aliases: `@/*` maps to project root
- Order imports: external libraries, then internal modules
- Group: React imports, then other imports, then local imports

```typescript
import { useState, useEffect } from "react";
import clsx from "clsx";
import logger from "@/lib/logger";
import { nseFetch } from "@/lib/nse-client";
import prisma from "@/lib/prisma";
```

### Naming Conventions
- **Files**: kebab-case for utilities (`cache.ts`), PascalCase for components (`DataTable.tsx`)
- **Interfaces**: PascalCase with meaningful names (`StockQuote`, `Column<T>`)
- **Variables/functions**: camelCase
- **Constants**: SCREAMING_SNAKE_CASE for config values

### Error Handling
- Use the centralized logger from `@/lib/logger`
- Log errors with context using object syntax

```typescript
// Good - structured logging
logger.info({ msg: 'Fetching stock quote from NSE', symbol });
logger.warn({ msg: 'DB lookup failed for quote', symbol, error: err });
logger.error({ msg: 'DailyPrice sync failed', symbol: quote.symbol, error: e });

// Always return safe defaults on error
try {
  return await fetchData();
} catch (e) {
  logger.error({ msg: 'Failed to fetch', error: e instanceof Error ? e.message : String(e) });
  return [];
}
```

### React/Next.js Patterns
- Client components: Use `"use client"` directive at top
- Server Components: Default in App Router, don't add directive unnecessarily
- Use generic types for reusable components

```typescript
// Good - generic table component
type Column<T> = {
  key: keyof T;
  label: string;
  render?: (value: any, row: T) => React.ReactNode;
};

export function DataTable<T extends Record<string, any>>({
  columns,
  data,
}: {
  columns: Column<T>[];
  data: T[];
}) { ... }
```

### Styling (Tailwind CSS)
- Use Tailwind 4.x classes
- Dark mode: use `dark:` prefix with `dark:border-slate-800`, `dark:bg-slate-900`
- Use CSS variables from `tailwind.config.ts`: `--background`, `--foreground`, `--surface`, etc.

```tsx
// Good - using CSS variables and dark mode
<div className="bg-surface dark:bg-slate-900 border border-border dark:border-slate-800">
  <table className="min-w-full text-sm">...</table>
</div>
```

### Testing (Jest)
- Test files: `__tests__/*.test.ts` or `*.test.ts` patterns
- Use `@testing-library/react` for component tests
- Clear mocks and caches in `beforeEach`

```typescript
describe('Cache System', () => {
  beforeEach(() => {
    cache.flushAll();
    hotCache.flushAll();
    jest.clearAllMocks();
  });

  test('should set and get values', () => {
    cache.set('key', 'value', 300);
    expect(cache.get('key')).toEqual('value');
  });
});
```

### Database (Prisma)
- Use Prisma 7.x with PostgreSQL/TimescaleDB
- Schema in `prisma/schema.prisma`
- Generate client after schema changes: `npm run prisma:gen`

### Prisma Skills & MCP

AI agents often struggle with Prisma 7 - they generate outdated v6 patterns, hallucinate APIs, and miss breaking changes. **Prisma Skills** fix this.

#### Install Prisma Skills
```bash
# Add all Prisma skills
npx skills add prisma/skills

# Or install specific skills
npx skills add prisma/skills --skill prisma-client-api
npx skills add prisma/skills --skill prisma-cli
npx skills add prisma/skills --skill prisma-upgrade-v7
```

Available skills:
- `prisma-cli` - Complete CLI commands reference
- `prisma-client-api` - CRUD operations, filters, transactions
- `prisma-upgrade-v7` - Migration guide from v6 to v7
- `prisma-database-setup` - PostgreSQL, MySQL, SQLite, MongoDB config
- `prisma-postgres` - Prisma Postgres workflows

#### Prisma MCP Server

The project uses **both** local and remote Prisma MCP servers for database management.

**Local MCP** - For migrations, generate, studio:
```bash
npx prisma mcp
```

**Remote MCP** - For Prisma Postgres management:
```bash
npx -y mcp-remote https://mcp.prisma.io/mcp
```

#### OpenCode MCP Configuration

Update `opencode.json` with:
```json
{
  "mcp": {
    "prisma": {
      "type": "local",
      "command": ["npx", "-y", "prisma", "mcp"],
      "enabled": true
    },
    "Prisma-Remote": {
      "type": "remote",
      "url": "https://mcp.prisma.io/mcp",
      "enabled": true
    }
  }
}
```

#### AI Safety Guardrails

Prisma ORM includes built-in safety checks to prevent destructive commands (like `prisma migrate reset --force`) when run through AI coding agents. Agents must get explicit user consent before executing dangerous database operations.

---

## UI/UX Testing

> **Important:** After making any UI/UX changes or implementing new features, ALWAYS test using Playwright MCP with demo credentials.

### Demo Credentials
```bash
Demo User:
  Email: demo@tradenext.in
  Password: demo123

Admin User (configured via env):
  Email: admin@tradenext6.app (or ADMIN_EMAIL from .env)
  Password: admin123 (or ADMIN_PASSWORD from .env)
```

### Testing Steps
1. Start the dev server: `npm run dev`
2. Start database: `npm run db:up`
3. Run seed: `npx prisma db seed`
4. Enable Playwright MCP in opencode.json
5. Use Playwright MCP to:
   - Navigate to the login page
   - Login with demo/admin credentials
   - Test all implemented features by:
     - Navigating to new pages (e.g., /news/market, /markets/analytics)
     - Verifying API data loads correctly
     - Checking for console errors
     - Testing interactive elements (tabs, buttons, forms)
     - Verifying responsive behavior
     - Testing dark/light mode if applicable
6. Check API endpoints directly in browser or via curl to verify data

### Enable Playwright MCP
In `opencode.json`, set:
```json
{
  "mcp": {
    "playwright": {
      "enabled": true
    }
  }
}
```

### Testing New Features (v1.1.0)

After implementing new features, test the following:

#### Stock Recommendations (/admin/recommendations)
- [ ] Navigate to recommendations page
- [ ] Click "Add Recommendation" button
- [ ] Fill form with: symbol, recommendation type, target price, analysis
- [ ] Submit form and verify recommendation appears in list
- [ ] Edit existing recommendation
- [ ] Delete recommendation
- [ ] Toggle recommendation active/inactive

#### User Alerts (/portfolio)
- [ ] Navigate to portfolio page
- [ ] Scroll to "My Alerts" section
- [ ] Click "Create Alert" button
- [ ] Fill alert form: symbol, alert type, title, target price
- [ ] Submit and verify alert appears
- [ ] Test "Dismiss" action on alert

#### Audit Logs (/admin/audit)
- [ ] Navigate to audit page
- [ ] Verify audit logs are displayed
- [ ] Filter by action type (API_CALL, NSE_CALL, etc.)
- [ ] Filter by date range
- [ ] Test pagination

#### Holdings Management (/admin/holdings)
- [ ] Navigate to holdings page
- [ ] Select a user from dropdown
- [ ] View user's transactions
- [ ] Add new transaction
- [ ] Edit existing transaction
- [ ] Delete transaction

#### Admin Overview (/admin/utils)
- [ ] Verify NSE API Calls tile is visible
- [ ] Verify Rate Limited Users tile is visible
- [ ] Check total calls count displays
- [ ] View flagged users list

#### Rate Limiting
- [ ] Test API returns 429 when limit exceeded
- [ ] Verify Retry-After header is present
- [ ] Verify X-RateLimit headers are present

---

## Project Structure

```
/
├── app/                    # Next.js App Router pages
│   ├── admin/             # Admin pages
│   │   ├── recommendations/  # Stock Recommendations Management
│   │   ├── audit/            # Audit Log Management
│   │   └── holdings/         # User Holdings Management
│   ├── portfolio/          # User Portfolio
│   ├── components/        # React components
│   │   └── modals/       # Modal components (incl. UserAlertModal)
│   ├── api/
│   │   ├── admin/        # Admin API routes
│   │   │   ├── recommendations/
│   │   │   ├── audit/
│   │   │   ├── holdings/
│   │   │   └── nse-stats/
│   │   └── user/         # User API routes
│   │       ├── alerts/
│   │       └── recommendations/
│   └── [route]/          # Dynamic routes
├── lib/                   # Business logic
│   ├── services/         # Service layer
│   ├── nse/             # NSE API utilities
│   ├── __tests__/       # Unit tests
│   ├── audit.ts         # Audit logging utilities
│   └── *.ts             # Utilities (cache, logger, auth)
├── prisma/               # Database schema
├── tests/               # Playwright UI tests
└── public/              # Static assets
```

---

## New Features (v1.1.0)

### Stock Recommendations Management
Admin can create, edit, delete stock recommendations with:
- Symbol (with autocomplete from DB), Entry Range, Short/Long Term, Intraday ratings
- Recommendation types: BUY, SELL, HOLD, ACCUMULATE, NEUTRAL
- Analyst Rating, Profit Range, Target Price
- Analysis text and Chart Image (stored as base64 in DB)
- API: `/api/admin/recommendations`
- Page: `/admin/recommendations`

### User Alerts
Users can create and manage price alerts:
- Alert types: price_above, price_below, volume_spike, custom
- Status tracking: active, triggered, dismissed
- Today's alerts shown in portfolio
- API: `/api/user/alerts`
- Page: `/portfolio` (My Alerts section)

### User Holdings Management
Users can manage their own holdings:
- View all their transactions in Transactions tab
- Add new transactions via modal
- Edit existing transactions
- Delete transactions
- Holdings are automatically recalculated
- API: `/api/user/holdings`
- Page: `/portfolio` (Transactions tab)

### Audit Logging
Comprehensive logging of all actions:
- API_CALL, NSE_CALL, USER_ACTION, PORTFOLIO_ACTION
- LOGIN, LOGOUT, RATE_LIMIT events
- Filterable by action type, date range
- Response time and status tracking
- API: `/api/admin/audit`
- Page: `/admin/audit`

### Rate Limiting
Protects API endpoints from abuse:
- 10 requests per 60 second window
- Returns 429 status with Retry-After header
- Flags users exceeding 2x limit
- Admin monitoring in Overview page
- API: `/api/rate-limit`

### Admin Holdings Management
Admin can manage user holdings:
- View all user transactions
- Add/Edit/Delete transactions for any user
- Filter by user
- API: `/api/admin/holdings`
- Page: `/admin/holdings`

### NSE API Monitoring
Admin dashboard tile showing:
- Total NSE API calls in 24h
- Top endpoints by usage
- Flagged users with rate limit violations
- Page: `/admin/utils`

---

## Key Libraries

| Category | Library |
|----------|---------|
| Framework | Next.js 16 |
| Language | TypeScript 5.9 |
| Styling | Tailwind CSS 4.x |
| Database | Prisma 7 + PostgreSQL/TimescaleDB |
| Testing | Jest 30 + Testing Library + Playwright |
| HTTP | node-fetch, SWR |
| Validation | Zod 4.x |
| Logging | pino (via custom wrapper) |

---

## Common Patterns

### Caching
Use the centralized cache system in `@/lib/enhanced-cache`:

```typescript
const cacheConfig = nseCache.stockQuote(symbol);
const data = await enhancedCache.getWithCache(cacheConfig, fetchFn, pollingConfig);
```

### API Fetching
Use `nseFetch` for NSE API calls, which handles cookies and caching:

```typescript
const data = await nseFetch("/api/endpoint", "?param=value");
```

### Background Sync
Fire-and-forget with `.catch()` to avoid blocking responses:

```typescript
syncService.syncFinancials(symbol, data).catch(err =>
  logger.error({ msg: "Financial sync failed", symbol, error: err })
);
```
