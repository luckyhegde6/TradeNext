# TradeNext AI Agent Configuration

This folder contains AI agent configuration files for TradeNext - a Next.js 16 stock market data visualization application.

## Structure

```
.ai/
├── rules/           # Coding rules and guidelines
├── commands/       # Slash commands for AI agents
├── agents/         # Specialized subagents
├── skills/         # Workflow definitions
├── hooks/         # Trigger-based automations
├── contexts/      # Dynamic system prompt injection
└── schemas/       # JSON schemas for validation
```

## Quick Commands

- Read `AGENTS.md` for complete development guide
- Read `.ai/rules/` for coding standards
- Use `.ai/commands/` for specific workflows

## Prisma Integration

This project uses Prisma 7 with AI agents. For accurate Prisma knowledge:

```bash
# Install Prisma Skills
npx skills add prisma/skills
```

This provides:
- `prisma-cli` - Complete CLI commands reference
- `prisma-client-api` - CRUD operations, filters, transactions
- `prisma-upgrade-v7` - Migration guide from v6 to v7
- `prisma-database-setup` - Database configuration
- `prisma-postgres` - Prisma Postgres workflows

## Technologies

- Next.js 16 (App Router)
- TypeScript 5.9 (strict mode)
- Tailwind CSS 4.x
- Prisma 7 + PostgreSQL/TimescaleDB
- Jest 30 + Testing Library
- NextAuth.js (role-based auth)

## Credentials

Demo: `demo@tradenext.in` / `demo123`  
Admin: `admin@tradenext6.app` / `admin123` (configurable via env)
