# TradeNext - Smart NSE Analytics & Portfolio Manager

[![Netlify Status](https://api.netlify.com/api/v1/badges/78401e5d-b137-4b6d-94bb-ad1ec8de6b05/deploy-status)](https://app.netlify.com/projects/tradenext6/deploys)

**Live Demo:** https://tradenext6.netlify.app/

## Overview

TradeNext is a Next.js 16 application providing stock market data visualization and portfolio management for NSE (India).

## Features

- **User Management**: Secure signup with email verification, role-based access control (Admin/User)
- **Portfolio Engine**: Real-time P&L tracking, transaction history, cost-basis analysis
- **Market Intelligence**: Comprehensive NSE data (quotes, charts, corporate actions)
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
| Demo | demo@tradenext.in | demo123 |
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
```

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
└── .ai/                  # AI agent configuration
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
