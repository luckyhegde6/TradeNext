# TradeNext - Technical Architecture

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        TradeNext Architecture                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐   │
│  │   Browser    │────▶│  Next.js    │────▶│   Database   │   │
│  │  (React)    │     │  (Node.js)  │     │  (PostgreSQL)│   │
│  └──────────────┘     └──────────────┘     └──────────────┘   │
│         │                    │                    │              │
│         │                    ▼                    │              │
│         │            ┌──────────────┐          │              │
│         │            │  NSE API     │          │              │
│         │            │  (External)  │          │              │
│         │            └──────────────┘          │              │
│         │                    │                    │              │
│         ▼                    ▼                    ▼              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                      Caching Layer                        │  │
│  │              (In-Memory + Redis Optional)                 │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 16 (App Router), React 19, Tailwind CSS 4.x |
| **Backend** | Next.js API Routes (Node.js) |
| **Database** | PostgreSQL 14 + TimescaleDB |
| **Backup DB** | SQLite (sql.js, in-memory, pure-JS) |
| **ORM** | Prisma 7 |
| **Authentication** | NextAuth.js (Credentials) |
| **Caching** | Node-cache (in-memory), optional Redis |
| **Testing** | Jest, Playwright |
| **Deployment** | Netlify, Docker |

---

## 3. Database Schema

### Core Models

```
User
├── id (Int, PK)
├── email (String, unique)
├── password (String, hashed)
├── name (String)
├── mobile (String, (Enum: nullable)
├── role admin, user)
├── isVerified (Boolean)
├── isBlocked (Boolean)
├── createdAt (DateTime)
└── updatedAt (DateTime)

Portfolio
├── id (String, PK)
├── userId (Int, FK)
├── name (String)
├── currency (String)
├── createdAt (DateTime)
└── updatedAt (DateTime)

Transaction
├── id (String, PK)
├── portfolioId (String, FK)
├── ticker (String)
├── side (Enum: BUY, SELL)
├── quantity (Int)
├── price (Decimal)
├── fees (Decimal)
├── tradeDate (DateTime)
└── createdAt (DateTime)

FundTransaction
├── id (String, PK)
├── portfolioId (String, FK)
├── type (Enum: DEPOSIT, WITHDRAWAL)
├── amount (Decimal)
├── date (DateTime)
├── notes (String, nullable)
└── createdAt (DateTime)

StockQuote (TimescaleDB)
├── symbol (String)
├── lastPrice (Decimal)
├── change (Decimal)
├── percentChange (Decimal)
├── open (Decimal)
├── high (Decimal)
├── low (Decimal)
├── prevClose (Decimal)
├── volume (BigInt)
├── timestamp (DateTime)
└── (Hypertable for time-series)

IndexQuote
├── symbol (String)
├── lastPrice (Decimal)
├── change (Decimal)
├── percentChange (Decimal)
├── timestamp (DateTime)
└── (Hypertable)

CorporateAnnouncement
├── id (Int, PK)
├── symbol (String)
├── announcementType (String)
├── description (Text)
├── pdfUrl (String, nullable)
├── broadcastDate (DateTime)
├── createdAt (DateTime)
└── indexName (String, nullable)

Post
├── id (Int, PK)
├── title (String)
├── content (Text)
├── published (Boolean)
├── authorId (Int, FK)
├── createdAt (DateTime)
└── updatedAt (DateTime)

WorkerTask
├── id (String, PK)
├── name (String)
├── taskType (String)
├── status (Enum: pending, running, completed, failed)
├── taskCategory (Enum: cron, async, regular)
├── payload (Json)
├── parentTaskId (String, nullable)
├── triggeredBy (String)
└── createdAt (DateTime)

TaskEvent
├── id (String, PK)
├── taskId (String, FK)
├── eventType (String)
├── message (String)
└── createdAt (DateTime)

DailyScreenerSync
├── id (String, PK)
├── syncDate (DateTime, unique)
├── data (Json)
└── createdAt (DateTime)
```

---

## 4. API Structure

### Public Endpoints
```
GET  /api/market/indices          - Get NSE indices
GET  /api/market/quote/:symbol   - Get stock quote
GET  /api/market/advances-declines - Market breadth
GET  /api/announcements           - Corporate announcements
```

### Protected Endpoints (Authenticated)
```
GET    /api/portfolio             - User's portfolios
POST   /api/portfolio             - Create portfolio
GET    /api/portfolio/:id         - Portfolio details
PUT    /api/portfolio/:id         - Update portfolio
DELETE /api/portfolio/:id         - Delete portfolio

GET    /api/portfolio/:id/holdings - Holdings with P&L
POST   /api/transaction           - Add transaction
GET    /api/transaction           - List transactions

POST   /api/fund                 - Add fund transaction
GET    /api/fund/:portfolioId    - Fund history
```

### Admin Endpoints (Admin Only)
```
GET   /api/admin/users            - List users
POST  /api/admin/users            - Create user
PUT   /api/admin/users/:id        - Update user
DELETE /api/admin/users/:id       - Delete user
GET   /api/admin/stats            - System stats
POST  /api/admin/ingest/announcements - Trigger ingest
GET   /api/admin/workers            - List worker tasks
POST  /api/admin/workers            - Create ad-hoc task
POST  /api/admin/workers/engine     - Start/Stop worker loops
POST  /api/admin/workers/trigger    - Trigger linked cron job
GET   /api/admin/db-usage           - DB ops counters + write budget
GET   /api/admin/db-health          - Prisma connectivity + SQLite health + sync history
POST  /api/admin/db-health          - Manual SQLite sync trigger
```

---

## 5. Caching & Backup Strategy

### Cache Layers

| Data Type | Cache Strategy | TTL |
|-----------|----------------|-----|
| Stock Quotes | Real-time cache | 15 sec |
| Index Quotes | Real-time cache | 15 sec |
| Corporate Announcements | Medium cache | 5 min |
| User Portfolios | No cache (DB) | - |
| Market Breadth | Medium cache | 1 min |

### SQLite Backup Layer (v3.19.1–v3.19.2)

When the primary PostgreSQL database is unavailable (plan limit exceeded, network outage, Accelerate proxy errors), TradeNext falls back to an **in-memory SQLite** database powered by `sql.js` (pure-JS, no native compilation). This provides read access to critical data even when the main DB is completely down.

```
┌──────────────────────────────────────────────────────────┐
│              SQLite Backup Architecture                   │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  ┌──────────────┐     ┌──────────────┐                   │
│  │  Prisma DB   │────▶│   SQLite     │                   │
│  │ (PostgreSQL) │     │ (sql.js)     │                   │
│  └──────────────┘     └──────────────┘                   │
│         │                    ▲                            │
│         │   syncFromPrisma() │                            │
│         └────────────────────┘                            │
│                                                           │
│  Recovery: 5-min background probe when DB is down         │
│  Auto-sync on Prisma recovery                             │
└──────────────────────────────────────────────────────────┘
```

**Tables backed up** (10 total, v3.19.2):
- `daily_recommendation_run`, `daily_recommendation_stock` — AI recommendations
- `corporate_action` — dividends, splits, bonus
- `chartink_screener` — screener definitions
- `worker_status` — worker liveness
- `server_log` — application logs
- `audit_log` — audit trail
- `cron_job` — cron job definitions
- `cron_run` — cron execution history
- `worker_task` — background task queue
- `_backup_meta` — sync metadata

**Route fallback chain** (DB → SQLite → memory → 500):
- `GET /api/recommendations` — recommendations with SQLite fallback
- `GET /api/corporate-actions/combined` — corporate actions with SQLite fallback
- `GET /api/screener/chartink` — screener results with SQLite fallback

**Admin health dashboard**: `GET /api/admin/db-health` + UI at `/admin/utils/db-health` showing Prisma connectivity, ops counters, table row counts, write budget, and sync history.

### Leader Election (v3.22.0)

**Why**: Netlify runs a persistent Next.js server, but a cold-start burst can spin up several instances at once — each booting and independently running SQLite sync + scheduler/cron + the write-behind flush timer. That multiplies Prisma plan ops and background work ~5–10×. `lib/services/leader.ts` elects a **single writer** per role.

- `acquireLeaderLock(role)` / `renewLeaderLock` / `releaseLeaderLock` / `isLeader` / `getLeaderInfo` — a single-writer lock on a `worker_status` row (`leader-<role>`), with a **5-minute staleness** expiry so any instance can reclaim a dead leader's row.
- Roles: `cron-daemon`, `worker`, `sqlite-sync`.
- **DB down → fail-open to a local leader** (so cron/work never halt); on DB recovery the election re-runs. `acquireLeaderLock` reconciles the two paths: a genuine `create`-path non-conflict/unavailable error **rethrows** (never silently stands down), a generic `updateMany` claim-race failure **stands down → return false**, DB-unavailable returns **true** (fail-open).
- `instrumentation.ts` acquires the `worker` + `cron-daemon` locks and only starts each engine on the leader; SQLite full-sync and the write-behind flush timer are leader-gated on `sqlite-sync`. Non-leader instances log `standby (non-leader)`.

### Write-Behind Log Store (v3.22.0)

**Why**: `APIRequestLog` (`logAPIRequest` in `lib/rate-limit.ts`), `ServerLog` (`logToDb` in `lib/services/db-logger.ts` + `ai-monitoring.ts`), and `AuditLog` (`createAuditLog` in `lib/audit.ts`) previously wrote directly to Prisma on every call. With **SQLite as the primary durable log store** and **Prisma reserved for only the important rows**, net Prisma ops stay below the **< 1000/day** target.

```
┌──────────┐   enqueue (0 Prisma ops)  ┌──────────────────────────┐
│  App/API │ ──────────────────────────▶  SQLite wb_* tables      │
└──────────┘                            │   (in-memory, 14-day TTL)│
                                        └────────────┬─────────────┘
                                                     │ drain (15-min, leader-gated)
                                                     ▼
                                        ┌──────────────────────────┐
                                        │  isWbImportant() filter  │
                                        └────────────┬─────────────┘
                                                     │ ONE createMany (≈1 op)
                                                     ▼
                                        ┌──────────────────────────┐
                                        │  Prisma APIRequestLog /  │
                                        │  ServerLog / AuditLog    │
                                        └──────────────────────────┘
```

- **`isWbImportant()`** promotes ONLY: `api_request` with `is_anomaly=1`, `is_rate_limited=1`, `status_code ≥ 500`, or an `error_message`; `server_log` at `error`/`warn` level; `audit_log` with a security/critical action (`AUTH`/`JOIN`/`PASSWORD`/`ADMIN`/`SESSION`/`LOGIN`/`LOGOUT` prefix, or suffix `_FAILED`/`_BLOCKED`/`_REJECTED`, or `response_status ≥ 400` with `error_message`).
- **`drainWriteBehind()`** reads up to `WB_CHUNK × WB_MAX_DRAIN_CHUNKS` (250 × 8 = 2000) rows, promotes the important subset in **ONE `createMany` (≈1 op)**, deletes only promoted rows; bulk info/api logs stay SQLite-only (**0 Prisma ops**). Returns `{ flushed, retained, skipped }` (kind-keyed by `api_request`/`server_log`/`audit_log`).
- **`pruneWriteBehind()`** enforces a **14-day TTL** (delete by PK); **`startWriteBehindFlush()`**/**`stopWriteBehindFlush()`** run a leader-gated 15-min interval (drains + prunes), booted after `startOpsCounterPersistence()` in `instrumentation.ts`.
- **Op accounting**: `createMany` counts as **1 op** via `$allOperations` — never `+= rows.length` (a double-count that inflated the write-budget gauge is removed). `lastPromoted`/`lastRetained` are surfaced in `getWriteBehindStats()` / `flushWriteBehind()` and on the `/admin/utils/db-health` Log Flush card (emerald promoted vs amber retained).
- SQLite is in-memory sql.js — a deploy wipes non-promoted rows. Accepted: retained rows are low-value metric/info logs already captured in pino/file logs; only important logs get cross-deploy durability via Prisma.

### Cache Implementation

```typescript
// In lib/enhanced-cache.ts
interface CacheConfig {
  key: string;
  ttl: number;        // seconds
  staleWhileRevalidate?: boolean;
}

// Usage
const quoteCache = enhancedCache.getWithCache(
  { key: `quote:${symbol}`, ttl: 15 },
  () => fetchQuoteFromNSE(symbol),
  { polling: true, pollInterval: 15000 }
);
```

---

## 6. Frontend Architecture

### Component Hierarchy

```
app/
├── layout.tsx              # Root layout + auth provider
├── page.tsx               # Dashboard (Home)
├── markets/
│   ├── page.tsx           # Markets overview
│   ├── analytics/page.tsx # Market analytics
│   └── [symbol]/page.tsx # Index/stock detail
├── portfolio/
│   ├── page.tsx           # Portfolio list
│   └── new/page.tsx       # Create portfolio
├── posts/
│   ├── page.tsx           # Community posts
│   └── new/page.tsx       # Create post
├── company/
│   └── [ticker]/page.tsx  # Company detail
├── admin/
│   ├── users/page.tsx     # User management
│   ├── utils/page.tsx    # Admin dashboard
│   └── utils/db-health/page.tsx # DB health monitoring
└── api/                   # API routes
```

### State Management

| Data Type | Solution |
|-----------|----------|
| Auth State | NextAuth.js useSession() |
| Market Data | SWR for fetching + caching |
| Portfolio | Server Components + SWR |
| UI State | React useState/useReducer |

---

## 7. Security Architecture

### Authentication Flow
```
1. User submits credentials
2. NextAuth validates against DB (bcrypt)
3. Session created with user role
4. Middleware checks role for protected routes
5. API routes verify session before processing
```

### Role-Based Access
```typescript
// Middleware protection
const isAdminRoute = pathname.startsWith('/admin') || 
                     pathname.startsWith('/api/admin');

// Redirect non-admins
if (isAdminRoute && !isAdmin) {
  return NextResponse.redirect(new URL('/', req.url));
}
```

### Security Measures
- Passwords: bcrypt (12 rounds)
- Sessions: NextAuth with secure cookies
- API: Session validation on every request
- XSS: React escapes by default
- CSRF: Next.js built-in protection

---

## 8. Deployment Architecture

### Development
```
localhost:3000 (Next.js)
  └── localhost:5432 (PostgreSQL via Docker)
```

### Production (Netlify — Persistent Server)
```
Netlify Persistent Server (cold-start bursts can run several instances)
  ├── Next.js (Node.js runtime)
  ├── In-process cron daemon (instrumentation.ts)
  ├── Leader election (lib/services/leader.ts) — single-writer
  │     per role (cron-daemon / worker / sqlite-sync) on a
  │     worker_status row; 5-min staleness, DB-down fail-open
  ├── SQLite backup + write-behind log store (sql.js, in-memory,
  │     synced from Prisma; important logs promoted to Prisma)
  └── PostgreSQL (Prisma Cloud/TimescaleDB)
```
Cold-start bursts are de-duplicated by leadership: only ONE instance runs the full SQLite sync, the scheduler/cron, and the write-behind flush timer; the others log `standby (non-leader)`. This keeps Prisma plan ops near the **< 1000/day** target even under multi-instance starts.

### Docker Compose (Optional)
```yaml
services:
  db:
    image: timescale/timescaledb:latest-pg14
    ports:
      - "5432:5432"
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
  app:
    build: .
    ports:
      - "3000:3000"
```

---

## 9. Performance Optimizations

### Implemented
- [x] Server-side rendering for initial load
- [x] SWR for data fetching with deduplication
- [x] In-memory caching for market data
- [x] Database indexes on frequently queried columns
- [x] SQLite backup layer (sql.js) for DB outage resilience (v3.19.1)
- [x] Write budget guard — reject non-critical writes when daily ops budget exceeded (v3.19.0)
- [x] Automatic recovery sync — background probe detects Prisma recovery and re-syncs SQLite (v3.19.2)
- [x] Admin DB health monitoring dashboard (v3.19.2)
- [x] Leader election — single-writer lock per role avoids multi-instance boot duplication of SQLite sync / cron / flush (v3.22.0)
- [x] Write-behind log store — SQLite-primary, only important logs promoted to Prisma in ONE `createMany`; net Prisma ops < 1000/day (v3.22.0)

### Planned
- [ ] Redis for distributed caching
- [ ] CDN for static assets
- [ ] Image optimization
- [ ] Code splitting per route

---

## 10. Testing Strategy

### Unit Tests (Jest)
- Utility functions
- Component rendering
- API route handlers

### E2E Tests (Playwright)
- User flows (login, portfolio)
- Admin operations
- Critical paths

### Test Coverage Target
- Core business logic: 80%+
- API routes: 70%+
- Components: 60%+

---

## 11. Monitoring & Logging

### Logging
- Application: pino logger
- Levels: debug, info, warn, error
- Format: JSON with metadata
- SQLite backup: server_log, audit_log tables synced from Prisma

### Metrics to Track
- API response times
- Page load times
- Error rates
- Active users
- DB operations (reads/writes per IST day, budget guard)
- SQLite backup health (Prisma connectivity, sync status)

---

## 12. Future Enhancements Architecture

### Scalability
- Horizontal scaling with more instances
- Read replicas for market data
- Message queue for async jobs

### Features
- WebSocket for real-time quotes
- Background workers for data ingestion (Implemented v1.9.0)
- AI/ML service integration
- Dynamic server-side logging in `.next/server_logs`
