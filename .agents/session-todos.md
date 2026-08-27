# Session Todos

## Current
- [x] DB ops optimization (v3.20.1) — committed `5156eb3`
- [x] DB failure ring buffer (`lib/prisma.ts`) — DONE
- [x] Daily Price Cache batch writer (`lib/services/priceCache.ts`) — DONE
- [x] DB Health API + UI (ops, price cache, errors, flush) — DONE
- [x] Docs updated (AGENTS.md v3.20.2, versions-v3.20.md, TODO, Primer, agent-memory) — DONE
- [ ] Commit v3.20.2 code on feat/db-health-price-cache — IN PROGRESS
- [ ] Push main + branch to origin
- [ ] Create PR to main

## Completed This Session
- [x] Verify test suite baseline (869 pass / 4 skip, tsc 57)
- [x] MCP GET endpoint fix — DONE (shared `handleMcpRequest()`)
- [x] MCP graceful empty — DONE (POST+GET catch return `{data:null, warning}` not 500)
- [x] Corporate actions NSE decoupling — DONE (`triggerNseRefresh()` fire-and-forget)
- [x] Corporate actions graceful empty — DONE (outer catch returns `{data:[], warning}` not 500)
- [x] `/api/news/market` Prisma fix + DB error catching — DONE
- [x] 17+ NSE routes hardened (graceful empty/null) — DONE
- [x] NIFTY_50 constants consolidated + 2026 holidays — DONE
- [x] `netlify.toml` stale extension removed — DONE
- [x] DB-down testing — DONE (stopped Docker PG, all routes HTTP 200; PG restart recovery confirmed)
- [x] Documentation updates (AGENTS.md, versions-v3.20.md, CHANGELOG, TODO, Primer, agent-memory, HANDOFF) — DONE
- [x] Lesson 88 added (graceful degradation pattern for API routes) — DONE
