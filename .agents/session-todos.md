# Session Todos

> Maintained during a session. Completed sessions are archived to `.agents/sessions/YYYY-MM-DD-<commit-hash>.md` and removed from this file.
> Rules:
>
> 1. Keep this file short — only the current session's todos.
> 2. Before a commit: mark done/cancelled, carry forward unfulfilled ones as new todos.
> 3. If an unfulfilled todo is a confirmed bug, log it in `BUGS.md`.
> 4. Never delete history — archive it to `.agents/sessions/` (date + commit hash in the filename) for future reference.

## Current Session (2026-08-13) — v3.7.0: F&O Analytics UI complete + NSE option-chain-v3 migration + MCP getOptionChain/getFoExpiries + #68 serverless logs notice

**Working tree**: docs pass done (AGENTS.md v3.7.0 row + MCP 28, CHANGELOG index + versions-v3.md, TODO rows, Primer, agent-memory, session-todos). Checks ran on `fix/ai-config-cron-ledger`: full suite **560 pass** (was 533, +27 nseFoApi), 11 skipped; `npx tsc --noEmit` clean on all touched files (remaining repo errors are pre-existing test-only noise). Commit pending (user approved commit — run pre-commit + hygiene first). **No deploy.**

### Completed
- [x] F&O Analytics UI (closes v3.2.0 "Partial"): `app/fo/page.tsx` + `FoClient.tsx` (positions dashboard, 4 stat cards, add-position modal, option chain, expiries, Greeks, P&L summary) + 6 new `app/components/fo/` components; `app/Header.tsx` F&O nav link
- [x] NSE option-chain-v3 migration: `lib/services/nse-fo-api.ts` rewrite (v3 URL, `type=Indices|Stocks`, `expiry=DD-MMM-YYYY`) + pure exported parsers (`parseNseExpiryDate`/`parseNseTimestamp`/`toNseExpiryParam`/`isIndexSymbol`/`parseOptionChainV3`); `filtered` totals top-level of `records`; empty `{}` strike rows skipped; `FOContract`/`FOChainData` extended
- [x] API: `app/api/fo/chain/route.ts` gains `expiry` query param (ISO → pass-through)
- [x] MCP 26→28: `getOptionChain` (300s), `getFoExpiries` (3600s) in union/list/descriptions/schemas/POST+GET switches
- [x] Tests: NEW `lib/__tests__/nseFoApi.test.ts` (27); full suite **560 pass**; tsc clean on touched files
- [x] Docs: AGENTS.md v3.7.0 row + MCP 28 functions, CHANGELOG index + versions-v3.md, TODO.md rows (F&O section + 3 v3.7.0 rows), Primer.md, agent-memory.md, session-todos
- [x] #68 carried: serverless-aware Server Logs notice (monitoring route `serverless: true` + page amber banner → DB Logs tab)

### Pending (this session)
- [ ] Pre-commit review + commit v3.7.0 (no --no-verify) on `fix/ai-config-cron-ledger` (linear history; user approved commit)
- [ ] Wiki update (user-requested): F&O/option-chain-v3 highlights + rewrites + changes; guides — join/login/reset password + Telegram linking; new-user guide with screenshots (recommendations, alerts, other features)
- [ ] v3.6.3 backfill script `scripts/backfill-recommendation-levels.ts` still awaits user consent (separate item — fixes persisted trackers incl. ITC)

### Pending (carried forward — other branches / later sessions)
- [ ] **Deploy to Netlify (user-approved) → rerun recommendations → verify BUY/SELL picks + fresh public date; verify cron ledger populates after next scheduled run**
- [ ] Re-seed demo holdings on prod
