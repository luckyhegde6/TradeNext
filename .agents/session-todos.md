# Session Todos

> Maintained during a session. Completed sessions are archived to `.agents/sessions/YYYY-MM-DD-<commit-hash>.md` and removed from this file.
> Rules:
>
> 1. Keep this file short — only the current session's todos.
> 2. Before a commit: mark done/cancelled, carry forward unfulfilled ones as new todos.
> 3. If an unfulfilled todo is a confirmed bug, log it in `BUGS.md`.
> 4. Never delete history — archive it to `.agents/sessions/` (date + commit hash in the filename) for future reference.

## Current Session (2026-08-13) — v3.7.2: Netlify secrets-scan build-failure fix + live-site health/staleness finding + v3.6.3 levels backfill executed

**Working tree**: branch `fix/netlify-secrets-scan` (fresh from main — old local copy `58d18c9` deleted, was 0 ahead / 55 behind main, fully merged). 5 files modified (+7/−7): `netlify.toml` (omit `.githooks`), `lib/alerts/delivery/telegram.ts`, `app/components/alerts/TelegramSubscription.tsx`, `app/api/user/telegram/verify/route.ts`, `lib/__tests__/nse-api.test.ts`. `npx jest lib/__tests__/nse-api.test.ts` → 8/8 PASS; grep-verified zero credential-shaped numeric literals in `*.{ts,tsx,js,json,toml,yaml,yml,prisma}`; full suite **582 pass / 11 skipped** unchanged. Docs pass done (AGENTS.md v3.7.2 row, CHANGELOG index + versions-v3.md, TODO rows + v3.6.3 backfill note, Primer, agent-memory, Lessons #63, session flow/decisions). **Commit pending user approval; NO deploy (deploy on hold per user).**

### Completed
- [x] Netlify secrets-scan fix: `netlify.toml` `SECRETS_SCAN_OMIT_PATHS` += `.githooks` (extensionless file held demo-cred literals from v3.5.7 masking; scanner flags EVERY repo file)
- [x] App hygiene: placeholder-looking numeric secrets in scanned paths → clearly-fake values — `telegram.ts` example botToken/chatId (`87654321:AAfake0token1for2docs3only` / `-1008765432100`), `TelegramSubscription.tsx` chatId `876543210`, verify-route JSDoc code + `nse-api.test.ts` timestamps `654321`
- [x] Live-site verify (user clarified: LIVE site = tradenext6.netlify.app, not localhost): `/markets/analytics` + `/recommendations` healthy — live NSE breadth, Corp Events table, pagination, 0 console errors, mobile 375px no overflow — **BUT OLD BUILD: no v3.6.3 SECTIONS sidebar, no v3.7.x features**
- [x] v3.6.3 levels backfill EXECUTED (user consent): `npx tsx --env-file=.env scripts/backfill-recommendation-levels.ts` → **792 scanned / 513 updated / 2 corrected** (GMRAIRPORT SELL, LICI HOLD)
- [x] User rotated Netlify `DEFAULT_PASSWORD` — acknowledged in docs (repo scans clean regardless)
- [x] Docs: AGENTS.md v3.7.2 row, CHANGELOG index + versions-v3.md entry, TODO.md rows + v3.6.3 backfill note, Primer.md, agent-memory.md, Lessons.md #63, session flow.md/decisions.md

### Pending (this session)
- [ ] Commit + push v3.7.2 on `fix/netlify-secrets-scan` (commit message WITHOUT credential literals — hook blocks them; pre-commit tsc must pass — never `--no-verify`), open PR
- [ ] After merge: Netlify deploy → verify live site picks up v3.6.3 SECTIONS sidebar + v3.7.x features (deploy on hold per user until approved)

### Pending (carried forward — other branches / later sessions)
- [ ] Commit + push v3.7.1 on `fix/ai-config-cron-ledger` (PR #88 open; pre-commit tsc must pass — never `--no-verify`), live-verify analytics side-nav
- [ ] **Deploy to Netlify (user-approved) → rerun recommendations → verify BUY/SELL picks + fresh public date; verify cron ledger populates after next scheduled run**
- [ ] Re-seed demo holdings on prod
- [ ] Prod: AI Connection Test cron first runs (verify audit entries + AI Monitoring `connection_test` rows after deploy)
