# TODO / Implementation Checklist

This file contains the implementation checklist for TradeNext features.

## Priority Items

### Completed
- [x] Integrate migrations into repo and run them on DB startup
- [x] Wire up authentication and seed demo user + demo portfolio
- [x] Add API endpoints:
  - [x] GET /api/portfolio/:id/value
  - [x] POST /api/ingest/run (trigger ingestion)
  - [x] GET /api/company/:ticker (fundamentals + latest prices)
- [x] Admin routes with role-based protection

### In Progress
- [ ] Implement Piotroski F-score fully in SQL and TypeScript (historical comparisons)
- [ ] Add unit tests for ingestion (golden file comparison)
- [ ] Add scheduler (cron or worker) for regular ingestion + retries
- [ ] Add CI for linting, typecheck, and run basic integration test against a test Postgres

### Pending
- [ ] Elasticsearch index for company documents and fast research queries
- [ ] Backtest engine for saved screens
- [ ] Alerts & notifications subsystem

## Notes for Implementers

- When implementing Piotroski checks, make sure to compare year-over-year changes requiring fetching prior-period fundamentals
- For performance, batch upserts using COPY or prepared statements and transactions
- Use Timescale continuous aggregates for monthly/quarterly rollups
- Admin credentials are now configured via environment variables (ADMIN_EMAIL, ADMIN_PASSWORD)
- Use Prisma Skills for accurate Prisma 7 knowledge: `npx skills add prisma/skills`

---

See `.ai/rules/checklist.md` for engineering guardrails.
