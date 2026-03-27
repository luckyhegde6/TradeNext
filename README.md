# TradeNext - Smart NSE Analytics & Portfolio Manager

[![Netlify Status](https://api.netlify.com/api/v1/badges/78401e5d-b137-4b6d-94bb-ad1ec8de6b05/deploy-status)](https://app.netlify.com/projects/tradenext6/deploys)

**Live Demo:** https://tradenext6.netlify.app/

## Latest Update - v1.13.0 (March 27, 2026)

### Corporate Action Alerts
- **New Alert Types**: Added support for dividend_alert, bonus_alert, split_alert, rights_alert, buyback_alert, meeting_alert
- **Alert Service**: Added `checkCorporateActionAlerts()` function that scans upcoming corporate actions
- **Check API**: Enhanced `/api/alerts/check` to handle both price alerts and corporate action alerts
- **UI Updates**: Added corporate action alert options in `/alerts` page including minimum dividend filter
- **Notifications**: Enhanced alert messages to include action details (ex-date, purpose, ratio)
- **Real-time Fallback**: Alerts page triggers check on load for serverless environments

### Tested Features (March 2026)
| Feature | Status | Notes |
|---------|--------|-------|
| Authentication | ✅ Working | Demo: demo@tradenext6.app / demo123 |
| Admin | ✅ Working | Admin: admin@tradenext6.app / admin123 |
| Portfolio | ✅ Working | Holdings (5 stocks), P&L tracking |
| Markets Overview | ✅ Working | NIFTY 50, BANK, IT, MIDCAP, SMALLCAP, AUTO, PHARMA |
| Analytics | ✅ Working | 14 tabs including Financial Results |
| Corporate Actions | ✅ Working | Dividend (₹) and Yield (%) display correctly |
| Calendar | ✅ Working | Month view with corporate actions |
| Cron Config | ✅ Working | Create and manage scheduled tasks |
| Workers | ✅ Working | Task queue with priority and retries |
| News | ✅ Working | Market news, India/Global filters |
| Stock Screener | ✅ Working | 2000+ stocks, multiple filters |
| Watchlist | ✅ UI Ready | Empty state (expected) |
| Alerts | ✅ UI Ready | Empty state (expected) |
| Financial Results | ✅ Working | NSE format (quarters as columns) |
| TradingView | ✅ Working | Links on dashboard charts |
| Session Management | ✅ Working | Admin can view/invalidate sessions |
| Web Vitals | ✅ New | Core Web Vitals monitoring |

## Overview

TradeNext is a Next.js 16 application providing stock market data visualization and portfolio management for NSE (India).

## Features

- **User Management**: Secure signup with email verification, role-based access control (Admin/User)
- **Portfolio Engine**: Real-time P&L tracking, transaction history, cost-basis analysis
- **Market Intelligence**: Comprehensive NSE data (quotes, charts, corporate actions)
- **Corporate Actions Management**: Admin upload via CSV/manual, NSE live integration, combined view with historical data and filtering
  - **Dividend Tracking**: Dividend per share display with computed yield percentages
  - **Enhanced UX**: Clickable type filters, search by symbol/company, pagination, sortable columns
  - **Date Formatting**: Supports both ISO and DD-MMM-YYYY formats with day-of-week display
- **Technical Analysis**: Piotroski F-Score, technical indicators (RSI, MACD, Bollinger Bands, SMA, EMA)
- **Stock Screening**: Advanced filtering with multiple criteria
- **Alert System**: Price alerts and recommendation subscriptions
- **Watchlist**: Quick price tracking and management
- **Data Import**: CSV/Excel transaction import
- **Docker-ready**: Local development with PostgreSQL/TimescaleDB + Redis

## Quick Start

```bash
# Install dependencies
npm install

# Start local database
npm run db:up

# Run migrations
npx prisma migrate dev

# Seed database
npx prisma db seed

# Start development server
npm run dev
```

Visit http://localhost:3000

## Login Credentials

| User | Email | Password |
|------|-------|----------|
| Demo | demo@tradenext6.app | demo123 |
| Admin | admin@tradenext6.app | admin123 |

Admin credentials can be configured via environment variables:
```bash
ADMIN_EMAIL=admin@tradenext6.app
ADMIN_PASSWORD=admin123
```

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Next.js 16 |
| Language | TypeScript 5.9 |
| Styling | Tailwind CSS 4.x |
| Database | Prisma 7 + PostgreSQL/TimescaleDB |
| Testing | Jest 30 + Testing Library |
| Auth | NextAuth.js |

## Commands

```bash
# Development
npm run dev              # Start dev server
npm run dev:local        # Full local dev with cross-platform support

# Building
npm run build            # Run migrations + Next.js build
npm run quickbuild       # Next.js build only (skip migrations)

# Testing
npm run test             # Run all tests
npm run test:watch       # Watch mode
npm run test:coverage    # Coverage report

# Database
npm run db:up            # Start local DB (docker)
npm run db:down         # Stop local DB
npx prisma studio        # Open Prisma Studio

# Linting
npm run lint             # Run ESLint

# Development Checks
# These scripts are in scripts/dev-checks/
node scripts/dev-checks/check-db.js      # Check database connection and users
node scripts/dev-checks/check-schema.js  # Verify database schema
node scripts/dev-checks/check-deals.js   # Check deals data (Block, Bulk, Short Selling)
node scripts/dev-checks/test-auth.js     # Test authentication (demo user)

## OpenCode Integration

This project is configured for AI-assisted development with OpenCode.

### Setup

```bash
# Install OpenCode
npm install -g opencode

# Launch web UI (recommended)
opencode --web
```

### MCP Servers

The project includes pre-configured MCP servers in `opencode.json`:

- **Context7** - Documentation lookup
- **GitHub Search** - Code search
- **Prisma Local** - Database migrations, generate, studio
- **Prisma Remote** - Prisma Postgres management
- **Playwright** - UI testing

### Prisma Skills

For AI agents, install Prisma Skills:

```bash
npx skills add prisma/skills
```

This provides accurate Prisma 7 knowledge for:
- CLI commands
- Client API (CRUD, transactions)
- Upgrade guides
- Database setup

## Project Structure

```
/
├── app/                    # Next.js App Router pages
│   ├── api/                # API routes
│   │   └── admin/          # Admin-only endpoints
│   └── [route]/            # Dynamic routes
├── lib/                    # Business logic
│   ├── services/           # Service layer
│   ├── nse/               # NSE API utilities
│   └── __tests__/         # Unit tests
├── prisma/                # Database schema + seed
├── scripts/               # Build/ingestion scripts
│   └── dev-checks/       # Development verification scripts
└── .agents/              # AI agent configuration
```

## Environment Variables

See `.env.example` for required variables:

```bash
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tradenext

# Auth
AUTH_SECRET=your-secret-key

# Admin (optional - defaults provided)
ADMIN_EMAIL=admin@tradenext6.app
ADMIN_PASSWORD=admin123

# Server
PORT=3000
```

## License

MIT
