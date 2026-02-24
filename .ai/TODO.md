# TODO / Implementation Checklist

This file contains the implementation checklist for TradeNext features.

## Priority Items

- [ ] Integrate migrations into repo and run them on DB startup (e.g., using a migration tool or init script).
- [ ] Wire up authentication and seed a demo user + demo portfolio.
- [ ] Add API endpoints:
  - GET /api/portfolio/:id/value
  - POST /api/ingest/run (trigger ingestion)
  - GET /api/company/:ticker (fundamentals + latest prices)
- [ ] Implement Piotroski F-score fully in SQL and TypeScript (historical comparisons).
- [ ] Add unit tests for ingestion (golden file comparison).
- [ ] Add scheduler (cron or worker) for regular ingestion + retries.
- [ ] Add CI for linting, typecheck, and run basic integration test against a test Postgres.

## Nice-to-have

- [ ] Elasticsearch index for company documents and fast research queries.
- [ ] Backtest engine for saved screens.
- [ ] Alerts & notifications subsystem.

## Notes for Implementers

- When implementing Piotroski checks, make sure to compare year-over-year changes requiring fetching prior-period fundamentals.
- For performance, batch upserts using COPY or prepared statements and transactions.
- Use Timescale continuous aggregates for monthly/quarterly rollups.

---

See `.ai/rules/checklist.md` for engineering guardrails.
