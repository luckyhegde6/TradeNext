# TradeNext Usage Guide

Follow these steps to set up and run the TradeNext project.

## Prerequisites

- Node.js 18+
- Docker Desktop (for local PostgreSQL)
- npm or pnpm

## 1. Clone and Install

```bash
git clone <repo-url>
cd TradeNext
npm install
```

## 2. Configure Environment

Create or update `.env` file (see `.env.example`):

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/tradenext"
AUTH_SECRET="your-secret-key"
ADMIN_EMAIL=admin@tradenext6.app
ADMIN_PASSWORD=admin123
```

## 3. Start Local Database

```bash
npm run db:up
```

This starts PostgreSQL and Redis via Docker.

## 4. Run Migrations

```bash
npx prisma migrate dev
```

## 5. Seed Database

```bash
npx prisma db seed
```

This creates:
- Demo user: `demo@tradenext.in` / `demo123`
- Admin user: `admin@tradenext6.app` / `admin123`

## 6. Start Development Server

```bash
npm run dev
```

Visit http://localhost:3000

## Login Credentials

| Role | Email | Password |
|------|-------|----------|
| Demo | demo@tradenext.in | demo123 |
| Admin | admin@tradenext6.app | admin123 |

## Running Tests

```bash
npm run test
```

## Building for Production

```bash
npm run build
npm run start
```

## OpenCode Integration

For AI-assisted development:

```bash
npm install -g opencode
opencode --web
```

See `AGENTS.md` for full development guide.
