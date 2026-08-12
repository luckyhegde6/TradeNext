# Session Todos

> Maintained during a session. Completed sessions are archived to `.agents/sessions/YYYY-MM-DD-<commit-hash>.md` and removed from this file.
> Rules:
>
> 1. Keep this file short — only the current session's todos.
> 2. Before a commit: mark done/cancelled, carry forward unfulfilled ones as new todos.
> 3. If an unfulfilled todo is a confirmed bug, log it in `BUGS.md`.
> 4. Never delete history — archive it to `.agents/sessions/` (date + commit hash in the filename) for future reference.

## Current Session (2026-08-12) — v3.6.4: IPO Issue Size + NSE events + AI IPO report v2 (JSON) + MCP/Telegram

**Working tree**: uncommitted v3.5.4→v3.6.4 work on main (per earlier pending-commit holds). Code + tests + docs + Playwright verify done. Commit pending user approval. **No deploy.**

### Completed
- [x] Issue Size: pure helpers (`parseSharesPerLot`, `parsePriceBandLow`, `perLotInvestment`, `formatIssueSize`, `IssueSizeInput`) → "154 shares per lot · ₹14,168 per lot"; server proxy `app/api/recommendations/ipos/[symbol]/detail/route.ts` (24h cache, memory→NSE→DB); landing IPO page + `IposTab.tsx` batched per-symbol detail fetch
- [x] NSE events feed: `lib/services/nseEventsService.ts` (6h TTL, EVENTS_FETCH audit, https thumbnail prefix) + `app/api/events/route.ts` + `app/components/EventsFeedWidget.tsx` wired below Corporate Announcements
- [x] AI IPO report v2 = JSON: `lib/services/ipoReport.ts` (18-section `IpoReport` schema, `buildIpoReportPrompt`, `parseIpoReportJson`, `normalizeReport`); `ipoAnalysisService` derives `report?` (legacy markdown → null); `IpoReportView.tsx` premium renderer wired into modal + panel; analysis API adds `report`
- [x] MCP 23→26: `getIpoAnalysis` (43200s), `getIpoIssueDetail` (3600s), `getNseEvents` (21600s) in union/list/descriptions/schemas/POST+GET switches
- [x] Telegram: `/ipo <SYMBOL>`, `/ipo-analysis <SYMBOL>`, `/events` (dynamic imports) in COMMAND_MAP + KNOWN_COMMANDS + help
- [x] Client-bundle leak fix: NEW zero-import `lib/services/ipoIssueSize.ts`; `nseIpoService.ts` re-exports; `IposTab.tsx` value-imports only from pure module (fixes `Can't resolve 'dns'/'fs'` HTTP 500)
- [x] Tests: 533 pass (+26: 10 ipoReport, 6 nseEvents, +7 nseIpoService, +3 ipoAnalysis v2; fixed `@/lib/logger` mock gap `debug`); scoped tsc clean
- [x] Docs: AGENTS.md row + MCP 26 functions, CHANGELOG index + versions-v3.md, TODO.md rows, Primer.md, agent-memory.md, README.md, docs/architecture.html (23→26)
- [x] Playwright verified: home events feed (3 real events), IposTab Issue Size cells in all 3 sections, landing page Issue Size card, mobile 375px — 0 console errors (3 expected OpenRouter-429 degrade logs on landing = self-heal works)
- [x] Cleanup: deleted tmp-probe scripts (events/ipo-detail/check-sync/diff-ipo/ipo-probe); git status clean of junk (`.playwright-mcp` gitignored)

### Pending (this session)
- [ ] Pre-commit review (Lessons.md, security checklist, hygiene — mostly done; final `git status` + secret grep)
- [ ] Commit v3.6.4 (working tree has v3.5.4→v3.6.4 accumulated) — ONLY after user approval; no `--no-verify`; no deploy
- [ ] v3.6.3 backfill script `scripts/backfill-recommendation-levels.ts` still awaits user consent (separate item)

### Pending (carried forward — other branches / later sessions)
- [ ] **Deploy to Netlify (user-approved) → rerun recommendations → verify BUY/SELL picks + fresh public date; verify cron ledger populates after next scheduled run**
- [ ] Re-seed demo holdings on prod
- [ ] F&O Analytics UI (services + API done, UI pending)
- [ ] #68 remaining: Server Log Files tab serverless-aware notice ("FS-based logging unavailable on serverless — use DB Logs tab")
