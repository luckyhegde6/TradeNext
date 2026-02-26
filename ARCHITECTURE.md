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
```

---

## 5. Caching Strategy

### Cache Layers

| Data Type | Cache Strategy | TTL |
|-----------|----------------|-----|
| Stock Quotes | Real-time cache | 15 sec |
| Index Quotes | Real-time cache | 15 sec |
| Corporate Announcements | Medium cache | 5 min |
| User Portfolios | No cache (DB) | - |
| Market Breadth | Medium cache | 1 min |

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
│   └── utils/page.tsx    # Admin dashboard
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

### Production (Netlify)
```
Netlify Edge
  └── PostgreSQL (Prisma Cloud/Timescale)
```

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

### Metrics to Track
- API response times
- Page load times
- Error rates
- Active users

---

## 12. Future Enhancements Architecture

### Scalability
- Horizontal scaling with more instances
- Read replicas for market data
- Message queue for async jobs

### Features
- WebSocket for real-time quotes
- Background workers for data ingestion
- AI/ML service integration
