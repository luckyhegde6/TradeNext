# Development Context

Active development mode for TradeNext.

## Current Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript 5.9 (strict)
- **Styling**: Tailwind CSS 4.x
- **Database**: Prisma 7 + PostgreSQL/TimescaleDB
- **Testing**: Jest 30 + Testing Library

## Key Commands

```bash
npm run dev              # Start dev server
npm run test             # Run tests
npm run lint             # Lint code
npm run build            # Build production
npm run prisma:gen       # Generate Prisma client
```

## Path Aliases

- `@/*` maps to project root

## Important Files

- `AGENTS.md` - Development guide
- `package.json` - Scripts and dependencies
- `prisma/schema.prisma` - Database schema
- `lib/` - Business logic
- `app/` - Next.js pages and components
