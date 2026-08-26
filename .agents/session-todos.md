# Session Todos

## Current
- [ ] Commit on fix/nse-resilience — READY (all docs updated, code verified, tsc clean)
- [ ] Create PR to main — PENDING user request

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
