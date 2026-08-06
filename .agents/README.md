# TradeNext AI Agent Configuration

This folder contains AI agent configuration files for TradeNext - a Next.js 16 stock market data visualization application.

## Structure

```
.agents/
├── rules/           # Coding rules and guidelines
├── commands/       # Slash commands for AI agents
│   ├── plan.md         # Create implementation plans
│   ├── code-review.md  # Code quality review
│   ├── tdd.md          # Test-driven development
│   ├── build-fix.md    # Fix build errors
│   ├── handoff.md      # Agent handoff orchestration
│   ├── self-learn.md   # Self-learning loop trigger
│   └── review-diff.md  # Full diff review
├── agents/         # Specialized agent profiles
│   ├── gh-helper.md       # GitHub/Git diff review & bug fixer
│   ├── e2e-agent.md       # Playwright E2E testing
│   ├── integrator.md      # Merge & conflict resolution
│   ├── observability.md   # Logging, metrics, security audit
│   ├── devops.md          # Docker, Vercel, Netlify, CI/CD
│   ├── qa.md              # Test writing & E2E execution
│   ├── code-reviewer.md   # Senior-level code review
│   └── tdd-guide.md       # Test-driven development
├── handoffs/       # Agent session handoff system (v1.15.0)
│   ├── README.md       # Handoff system overview
│   ├── SCHEMA.md       # Handoff file schema
│   ├── active/         # Current session handoff
│   │   └── latest.md
│   ├── archive/        # Completed session handoffs
│   └── flow/           # Handoff flow definitions
│       ├── session-cycle.md
│       ├── agent-to-agent.md
│       └── error-recovery.md
├── learning/       # Self-learning loop system (v1.15.0)
│   ├── README.md       # Learning loop overview
│   └── session-log.md  # Session outcome tracker
├── skills/         # Workflow definitions
├── hooks/         # Trigger-based automations
├── contexts/      # Dynamic system prompt injection
└── schemas/       # JSON schemas for validation
```

## Quick Commands

- Read `HANDOFF.md` (root) for orchestration state
- Read `AGENTS.md` for complete development guide
- Read `.agents/rules/` for coding standards
- Read `.agents/handoffs/active/latest.md` for current session context
- Use `.agents/commands/` for specific workflows

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

Demo: `demo@tradenext6.app` / `demo123`  
Admin: `admin@tradenext6.app` / `admin123` (configurable via env)
