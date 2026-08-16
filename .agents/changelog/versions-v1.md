# Version History v1

> From TradeNext version history. Index: [../CHANGELOG.md](../CHANGELOG.md). Latest versions in [versions-v3.md](./versions-v3.md).
>
> **Per-minor index** — full detail lives in the per-minor file for each minor version.
> Load only the file you need; never the whole directory.

## Per-minor files

| File | Contents |
|------|----------|
| [versions-v1.16.md](./versions-v1.16.md) | **v1.16.0–v1.16.1** — Advanced screener (filter grammar, technical analysis lib, backtest engine, TradingView `advancedScan`, 10 APIs, 45 tests) + code hygiene docs |
| [versions-v1.15.md](./versions-v1.15.md) | **v1.15.0** — Agent handoff system (`.agents/handoffs/`), 6 agent profiles, self-learning loop, `/handoff` `/self-learn` `/review-diff` |
| [versions-v1.14.md](./versions-v1.14.md) | **v1.14.0** — MCP API `/api/mcp` — 22 functions for external NSE data, optional `x-api-key`, discovery |
| [versions-v1.13.md](./versions-v1.13.md) | **v1.13.0** — Corporate action alerts (dividend/bonus/split/rights/buyback/meeting) |
| [versions-v1.12.md](./versions-v1.12.md) | **v1.12.0–v1.12.1** — Netlify build fix (secrets omit paths), cache-control headers, lazy loading, web vitals, worker auto-start fix |
| [versions-v1.11.md](./versions-v1.11.md) | **v1.11.0–v1.11.1** — Worker task mgmt (run now/retry/cancel/delete); GA4 + SEO (JSON-LD, sitemap, robots, metadata) |
| [versions-v1.10.md](./versions-v1.10.md) | **v1.10.0–v1.10.6** — Screener enhancement (live TradingView, quick/basic/advanced filters); corp actions dedup + NSE field fix; serverless DB logging; worker cache key + logger security fixes |
| [versions-v1.9.md](./versions-v1.9.md) | **v1.9.0–v1.9.3** — Secure join-request flow (RBAC), notifications page, Netlify Blobs logging, worker engine + NSE sync, build fixes |
| [versions-v1.8.md](./versions-v1.8.md) | **v1.8.1–v1.8.3** — Security (httpOnly cookies, no localStorage, CSRF, session tracking); Netlify 502 fix (minimal middleware, no NextAuth); Prisma 7 adapter |

> Older pre-1.8 rows (v1.7.0, v1.6.x, v1.5.0, v1.4.0, v1.3.0, v1.2.0, v1.1.0, v1.0.0) exist only as compact summaries in `AGENTS.md` / `CHANGELOG.md` — no per-minor file was ever created for them.
