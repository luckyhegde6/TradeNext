# AGENTS.md - TradeNext Development Guide

> **Read this first.** TradeNext is a Next.js 16 + TypeScript + Prisma 7 + PostgreSQL (TimescaleDB) app for NSE (India) market data, portfolio management, capital gains tax, F&O analytics, dividends, rebalancing, alerts, and AI-driven daily recommendations. Deployed on Netlify.
>
> **Agentic operating model:** `.agents/RULES.md` (must-read on first session) + `.agents/SOUL.md` (identity). Full history & legacy docs live in `.agents/CHANGELOG.md`.

## Version History
| **v3.46.0** | 2026-10-09 | Specs 22/23/24 — ops-counter authority sync + Google-Sheets table-missing tolerance + cron missed-tick catch-up (user-approved specs/plans 22/23/24; branch `feature/fix-ops-counter-authority-sync` = PR #134, HEAD `5a0ddb2`; COMMIT/PUSH PENDING USER) — (22) `buildQueryConsumption(state, live, planLimit, authorityToday?)` in `lib/services/opsMonthly.ts` — ops month mirrors the live day (`DbHealthCheck.live_ops_month`/`last_reset`); db-health route GET (counters + authority) + PATCH `set_ops_counter` (zod, :226/:444, audit `DB_HEALTH_SET_OPS_COUNTER`). (23) SQLite mirror-writer tolerates `P2021`/"does not exist" for the Google-Sheets tables (`logger.info` + `return null`, never throws); `netlify.toml` build = `prisma migrate deploy && preserve-mirror && generate && quickbuild` (**production-affecting — flag in PR**). (24) `catchUpMissedCronJobs()` with `CRON_CATCHUP_WINDOW_MS=15min`: missed ≤15min spawned (same guards as `checkScheduledJobs`, skip `running`), stale re-armed advance never fired; wired at daemon boot + 5-min resync tick. 10 new tests (7 catch-up + 3 wiring); Jest **133/134 suites · 1979 pass / 4 skip / 3 fail** (only pre-existing AGENTS.md doc-gate, Lesson 142) · tsc **46 exact (prod 0)** · ESLint 0 (8 files) · quickbuild **199/199**. Lesson 158. Full detail: `.agents/changelog/versions-v3.46.md`. |
| **v3.45.0** | 2026-10-06 | Spec 21 Degraded SQLite execution engine + preemptive plan-limit switch (user-approved; branch `feature/google-sheets-tracking`; COMMITTED `138d69a` + security-deps `a433039` + PUSHED + PR #133 all-9-checks GREEN + MERGED into `main` per explicit user approval — the 2026-10-02 P6003 hold-lift premise proved FALSE, breaker never opened in prod) — worker/cron core (recommendations + corp-actions) becomes degraded-mode + SQLite-first: precedence `off > forced > breaker > threshold` (hysteresis enter ≥180,000 / stay >160,000 / exit ≤160,000 AND breaker closed; `_degraded_state` persists operator mode only; **zero Prisma ops in the degraded branch incl. transitively**, Lesson 156); SQLite queue (90-min dedup, 5-task drain bound, 30-min stale-`running` reclaim); Netlify-Blobs ETag-CAS degraded leader (fail-closed); 29-type registry with 2 degraded-safe; admin `GET/POST /api/admin/degraded-mode` + 5 audit tags. 6 new suites (~144 tests) incl. Lesson 157 2×2 gate matrix; Jest **134/134 · 1972 pass / 4 skip / 0 fail** · tsc 46 exact · lint 0 · quickbuild 199/199 · doc budget 91.4/100 KB. Lessons 152–157. Full detail: `.agents/changelog/versions-v3.45.md`. |
| **v3.44.0** | 2026-09-28 | Spec 02 Public legal pages Privacy + Terms (branch `feature/google-sheets-tracking`, commits `fb29b16`→`66db159`→`ac24ede`; PR #133 MERGED 2026-10-06) — public `/privacy` + `/terms` (no auth, **no date/effective line** per user decision): truthful disclosures (account/sessions, portfolio/alerts/Telegram chat ID, audit + server logs, AI-analysis inputs, optional admin Google Sheets export — anonymous rows only), Terms = "tool, not adviser" + NSE disclaimers + 18+ + laws of India; contact footer + Header links; sitemap + llms.txt (+2). Unit 6/6 + e2e privacy-terms 4/4 chromium; tsc 46 exact · lint 0 · quickbuild 198/198. Lesson 150. Full detail: `.agents/changelog/versions-v3.44.md`. |
| **v3.43.0** | 2026-09-26 | Spec 20 Google Sheets admin console (user-approved; branch `feature/google-sheets-tracking` on `2fbf0c7`; COMMITTED `645cf85` + live-verification wrap-up `aba7fa6`; PR #133 MERGED 2026-10-06) — turns the v3.42.0 fire-and-forget export into an **operable** system: /admin/google-sheets queue visibility, drain, poisoned-row recovery, tracker-performance metrics history, scan re-run. Invariants preserved: append-only (no `values.clear`/data update outside the guarded ledger path), positional (header mismatch → warn + append by position, user header never rewritten), producers never throw. (1) **Guarded ledger `DELETE`** — the subsystem's only destructive action, re-validated server-side on every guard (breaker/config/sheet → 503, `decisions` → 400, shared re-validation, all-or-nothing partial → 409, 200 cap, audit + real count). (2) **`metrics` = 5th syncable tab** (11 cols from `RecommendationTracker`; non-computable stays `null`, console renders —). (3) **Re-scan ≠ Sync** (screener forceRefresh; custom fresh `randomUUID()` export). 6 admin routes + 2 Prisma models (migrations written, NOT applied — P6003 hold). Sheets tests 142/142 + real-sql.js read-by-seq guard + e2e 7 tests (routes deliberately MOCKED). tsc 46 exact · quickbuild 196/196 · full Jest 1813 pass. Lessons 144/147. Full detail: `.agents/changelog/versions-v3.43.md`. |
| **v3.42.0** | 2026-09-25 | Spec 19 Google Sheets tracking — flag-gated, fire-and-forget, **append-only** export of 5 event streams. **Superseded by v3.43.0.** Full detail: `.agents/changelog/versions-v3.42.md`. |
| **v3.41.3** | 2026-09-25 | Spec 18 Laya real inference P1–P3 + real provider path (user-approved; branch `feature/ph22-decision-engine`; COMMITTED `3c765b9` + docs `2ac5e1f`; pushed; PR #132 MERGED `4b68e30`) — real Laya inference runtime behind a parity gate (`DECISION_LAYA_REAL=1` → `LayaRealProvider`; else laya-mock byte-identical): `lib/services/laya/` P1 pure-TS ports (Python 1:1) · P2 `tokenizer.ts` WASM lazy-singleton (@huggingface/tokenizers, v1 special ids 50281–50284) · P3 `decisionModel.ts` two chained ONNX InferenceSessions encoder_q8→head_q8 (onnxruntime-node 1.30.0; ~503 MB int8 weights gitignored + fetch script) · minimal `agent.ts` systemOne decode. 7 new laya suites; tsc 46 exact · 116/116 suites (1538 pass) · quickbuild 189/189 · live in-process real ping (`laya: ok`) + HTTP ping 200. Lesson 140 (CodeQL cleared). Full detail: `.agents/changelog/versions-v3.41.md` §v3.41.3. |
| **v3.41.2** | 2026-09-25 | Spec 01 Recommendations plan-limit fallbacks (user-approved; branch `feature/ph22-decision-engine`; COMMITTED `5b088e3`) — prod /recommendations History/Performance/Ideas returned HTTP 500 under the Prisma **P6003 plan-limit hold** because the read paths were Prisma-only while the SQLite mirror held fresh copies. Fix: SQLite mirror reads (`getRecommendationRuns()` → `topStocksFromSqlite()` → mirror-tracker list + mirror market-cache) behind breaker/hold-aware `mirrorWriteThrough`; degraded `[]` only when the mirror HAS data — mirror-exhausted RETHROWS the ORIGINAL 500 (never mask as empty, Lesson 138); HistoryTab explicit error card + Retry. NEW `recommendationsPlanLimitFallbacks.test.ts` 21/21. tsc 46 exact · 109/109 suites (1440 pass) · quickbuild 189/189 · e2e recommendations 10/10. Lesson 138. Full detail: `.agents/changelog/versions-v3.41.md` §v3.41.2. |
| **v3.41.1** | 2026-09-24 | Spec 17 Decision Engine monitoring + e2e hardening (COMMITTED `a269057`) — `lib/services/decision/monitoring.ts` zero-Prisma in-memory ring buffer (500) + stats, GET /api/admin/decision/monitoring + DELETE clear, Decision Engine tab in AI Monitoring + OpenAPI + e2e decision-monitoring.spec.ts + Lesson 137 Auth.js double-submit CSRF race fix (in-context 2-attempt login retry) + 15 unit tests. tsc 46 exact · lint 0 · 108/108 suites (1416 pass). Full detail: `.agents/changelog/versions-v3.41.md` §v3.41.1. |
| v3.41.0 | 2026-09-24 | Spec 16 Decision Engine CORE + POC A/B (COMMITTED `ab6fd65`) — `lib/services/decision/` Laya-only mock engine (types/provider/gate/layaProvider/client/fusion; confidence-gated ACT/REVIEW) + DECISION_EVALUATED/DECISION_GATE audits + POC A screener scoring + POC B swing gateAutoGenerate (flag-gated, off = byte-identical) + /api/decision/evaluate + /api/admin/decision/ping + OpenAPI + admin panel. tsc 46 exact · 107/107 suites (1401 pass) · quickbuild 188/188. Full detail: `.agents/changelog/versions-v3.41.md` §v3.41.0. |
| v3.40.8 | 2026-09-23 | P0 Laya runtime spike COMPLETE — scripts/spike-laya/ scaffold + onnxruntime-node install + ~503MB int8 weights + chained encoder→head smoke; VERDICT APPROVE (SPLIT graphs, chain median 2316ms, RSS 611MB); engine P1–P6 next (user approval pending) |;
| v3.40.5 | 2026-09-22 | Laya / System-One decision-engine RESEARCH — 5 parallel subagents scraped Laya HF card + TypeSafe.JS docs + Medium; Jev-1.13.0 premise corrected (not OSS; hosted API) → `memory.md` + `docs/laya.md` + `docs/designDoc/ph22-laya-decision-engine-design.md` (docs-only, no code) |;
| v3.40.4 | 2026-09-21 | Plan 15: Swing AI auto-generate-once (seed-once) — greenfield lib/services/swingAutoSeedService.ts + SWING_AUTO_SEED_TRIGGERED/SKIPPED audit tags + route autoTriggerOnce wiring |;

> The full compact version history (v1.0.0 → latest) moved to **`.agents/changelog/versions-index.md`**
> and is no longer auto-injected into every session (context optimisation). Read it on demand.
>
> - Latest version detail: `.agents/changelog/versions-v3.46.md` (v3.46.0 Specs 22/23/24) · previous: `.agents/changelog/versions-v3.45.md`
> - Full changelog index: `.agents/CHANGELOG.md`
> - Topic → file manifest: `.agents/INDEX.md`

---

## Credentials & Testing

| Role | Email | Password |
|------|-------|----------|
| Demo | demo@tradenext6.app | demo123 |
| Admin | admin@tradenext6.app | admin123 |

- **Live site**: https://tradenext6.netlify.app/ · **Bot**: @tradenext6Bot

## Commands

```bash
npm run dev              # Dev server (port 3000)
npm run local            # Full local dev (cross-platform)
npm run build            # Migrations + Next.js build
npm run quickbuild       # Next.js build only
npm run test             # Jest — RUN ALONE, never chained with ';' (Windows quirk)
npm run test:watch       # Watch mode
npm run test:e2e         # Playwright e2e — full suite (all browsers/projects) against dev server on :3000
npm run test:e2e:ui      # Playwright UI mode (watch/filter/step) — `npx playwright test --ui`
npx playwright test --headed   # Run tests in a visible browser window (watch Playwright drive the site)
npx playwright show-report   # Open last Playwright HTML report
npx playwright show-trace test-results/<dir>/trace.zip   # View a trace
npm run lint             # ESLint
npx tsc --noEmit         # Typecheck production files
npx prisma generate      # Regenerate client after schema change
npx prisma migrate dev --name <name>   # Dev migration (safe)
npx tsx scripts/chartink-capture/capture.ts   # Capture Chartink clauses+tables → JSON configs + DB (run where browser works; --category/--id/--dry-run/--no-db)
npx tsx scripts/chartink-capture/capture.ts --category fundamental   # One category only
npx prisma db push       # Schema sync (safe)
npx prisma studio        # DB browser
git config core.hooksPath .githooks    # Enable versioned hooks (fresh clone)
```

## Key Libraries

| Category | Library |
|----------|---------|
| Framework | Next.js 16 (App Router, nodejs runtime for Prisma/auth) |
| Language | TypeScript 5.9 (strict) |
| Styling | Tailwind CSS 4.x |
| Database | Prisma 7 + PostgreSQL/TimescaleDB |
| Testing | Jest 30 + Testing Library + Playwright |
| HTTP | node-fetch, SWR |
| Validation | Zod 4.x |
| Logging | pino (via `@/lib/logger`) |

---

## Agent Documentation Files

| File | Purpose |
|------|---------|
| `.agents/RULES.md` | Master agentic operating rules — read on first session / fresh clone |
| `.agents/SOUL.md` | Agent identity & principles — how agents think, behave, communicate |
| `.agents/CHANGELOG.md` | Version-history index → detail subfiles in `.agents/changelog/` (versions-v3/v2/v1, screener, corp-actions, serverless-logging, security-workers) |
| `.agents/rules/spec-driven-development.md` | ⚠️ MANDATORY for all feature development. Spec → Plan → Implement → Verify flow. Templates: `.agents/templates/spec-template.md` + `.agents/templates/plan-template.md`. Specs saved to `.agents/specs/`, plans to `.agents/plans/` |
| `.agents/rules/session-memory-rules.md` | Session/memory/handoff maintenance + git guidelines + token efficiency |
| `.agents/rules/session-decisions-flow.md` | ⚠️ MANDATORY per-session memory: `decisions.md` (decisions + reasoning) + `flow.md` (execution path/code touched) in `.agents/sessions/<YYYY-MM-DD-<hash>>/` — write during work, before code and at every code/package change |
| `.agents/rules/checklist.md` | Engineering guardrail checklist (v1.3) — hard contract for all changes |
| `.agents/rules/README.md` | Coding standards index (TS rules, imports, naming, errors, security) |
| `@Primer.md` | Session tracking - read at start of every session |
| `@agent-memory.md` | Activity log - tracks all agent work |
| `@Lessons.md` | Rules & corrections - read before every commit |
| `@HANDOFF.md` | Root orchestration state - read at start of every session |
| `.agents/session-todos.md` | Current session todo list - maintained during session |
| `.agents/sessions/` | Archived sessions as `YYYY-MM-DD-<hash>/` folders, each with `decisions.md` + `flow.md` (see `.agents/rules/session-decisions-flow.md`) |
| `.agents/pre-commit-workflow.md` | Pre-commit checklist - run before every commit |
| `.agents/security-checklist.md` | Security checklist - run before every commit |
| `.agents/linear-history.md` | Git flow & branching strategy (warn-only main) |
| `.agents/code-hygiene.md` | Code quality rules (ponytail minimal-code style) |
| `.agents/documentation-standards.md` | Documentation standards |
| `.agents/docs/` | Subsystem deep-dives (recommendations, tasks/cron/workers, monitoring, alerts, playwright-e2e) + DB-migration ledger (what/why/decisions for every migration) — read before editing those subsystems |
| `.agents/AGENT-SKILL-MATRIX.md` | Agent ↔ Skill ↔ Command mapping matrix |
| `.agents/handoffs/active/latest.md` | Current session handoff state |
| `.agents/handoffs/flow/` | Handoff flows: session-cycle, agent-to-agent, agent-to-human, error-recovery |

**Read order at session start:** `@HANDOFF.md` → `.agents/handoffs/active/latest.md` → `@Primer.md` → `@Lessons.md` → `.agents/session-todos.md`. (See `.agents/rules/session-memory-rules.md`.)

## Agent Operating Model (gardenify pattern)

- **Spec-driven development**: ALL feature work starts with a spec (`.agents/templates/spec-template.md`) → plan (`.agents/templates/plan-template.md`) → implement → verify. Specs and plans live in `.agents/specs/` and `.agents/plans/`. Workflow: `.agents/rules/spec-driven-development.md`. **No exceptions for features.** Trivial fixes (typo, import) may skip spec but MUST document in commit message.
- **Memory layout**: `@HANDOFF.md` (orchestration) → `latest.md` (live resume) → `@Primer.md` (status) → `@Lessons.md` (corrections) → `@agent-memory.md` (activity log).
- **Handoff = files, not prose**: update `.agents/session-todos.md`, archive to `.agents/sessions/YYYY-MM-DD-<hash>.md`, update `@HANDOFF.md` + `@Primer.md`. Next agent resumes from files, never conversation memory.
- **Self-healing**: verify before claiming — `npx tsc --noEmit`, `npm run test`, `npm run lint`, `npm run quickbuild` (production build — Netlify deploys the same command, so a broken build blocks deploys) after any change. Trust the repo over memory (re-read files).
- **Anti-hallucination**: every claim traces to a commit, tracked doc, passing test, or verified live check. Never invent file paths/API shapes — grep/read first.
- **Token efficiency**: small targeted reads; index files (@AGENTS.md, `@Lessons.md`) over full dumps; read slices by offset/limit; keep session-todos short (archives absorb history).

## Git Hooks (versioned in `.githooks/`)

```bash
git config core.hooksPath .githooks
```
- `.githooks/pre-commit` — WARN on main/master; BLOCK hardcoded secrets + staged `.env`; WARN console.log, junk artifacts, tsc errors.
- `.githooks/post-commit` — checkpoint log to `.agents/handoffs/checkpoint.log` (gitignored).
- `.githooks/pre-push` — WARN on main/master.
- Never bypass with `git commit --no-verify` unless intentional.

## Plugins & MCP (how agents extend TradeNext)

`.opencode/opencode.json`: plugins `opencode-helicone-session`, `opencode-wakatime`; MCP: Context7 (library docs), Playwright (UI testing — agentic browser automation for exploratory checks; scripted regression guards live in the `playwright-e2e` skill/`e2e/` suite), gh_grep (code search), sequential-thinking, memory (knowledge graph), chrome-devtools (performance/Lighthouse/network), filesystem.

## Skills, Agents & Commands (extensible system)

TradeNext uses a layered skills/agents/commands system. Mapping matrix: `.agents/AGENT-SKILL-MATRIX.md`.

| Layer | Location | Notes |
|-------|----------|-------|
| Skills (machine) | `.opencode/skills/<name>/SKILL.md` | YAML frontmatter (`name`, `description`); auto-discovered |
| Skills (human mirror) | `.agents/skills/<name>.md` | Short version + `Source:` footer |
| Agent profiles | `.agents/agents/<name>.md` | Expertise + Workflow + Handoff Triggers |
| Commands | `.agents/commands/<name>.md` | `/command` templates |
| Wiring | `.opencode/opencode.json` | `agent:` + `command:` sections |

**Focused skills**:

| Skill | Agent | Command | Purpose |
|-------|-------|---------|---------|
| `docs-updater` | doc-writer | `/docs-update` | repo doc updates after every implementation |
| `wiki-creator` | wiki-publisher | `/wiki-publish` | publish GitHub wiki pages (GitHub-renderer-safe mermaid) |
| `bug-finder` | bug-hunter | `/find-bugs` | hunt/reproduce/verify bugs, layer contract audits |
| `ux-enhancer` | ux-designer | `/ux-audit` | UI/UX audit (states/responsive/dark-mode) + enhancement |
| `nse-integration` | — | — | NSE API integration patterns (nseFetch, caching, cookie handling) |
| `playwright-e2e` | e2e-agent | — | committed e2e suite (`e2e/`, `npm run test:e2e`): regression guards, cross-browser + mobile |
| `playwright-debug` | qa / e2e-agent / bug-hunter / ux-designer / code-reviewer / tdd | — | Playwright developer debug toolkit (Inspector `--debug`, UI Mode, Codegen, Trace Viewer, HTML report) — diagnose failing/flaky tests + generate stable role/text locators |
| `playwright-cli` | — | — | exploratory browser testing via Playwright MCP tools (not committed) |
| — | orchestrator | `/orchestrate` | decompose ≥2 independent workstreams → parallel dispatch (Tier A) or chunked-sequential (Tier B); declares tier, monitors subagent health, owns handoff |

**Adding a new skill**: create `.opencode/skills/<name>/SKILL.md` → mirror `.agents/skills/<name>.md` → profile + command → wire `opencode.json` → update matrix + this table.

**GitHub wiki gotchas** (wiki-creator skill): wiki git repo is lazy-created (create first page via web UI before cloning); GitHub's mermaid renderer is stricter — quote ALL labels with specials (`A["text<br/>more"]`, `E3["action: none|buy|sell|paper_trade"]`).

---

## ⚠️ MANDATORY: Code Hygiene & Artifact Cleanup

**Before every commit:** run `git status` and review ALL untracked/modified files. Delete junk: Playwright snapshots (`*.yaml` in root), screenshots, `dev-server.log`/`next-dev.log`. Verify `.gitignore` covers new artifact patterns. Check no secrets/tokens in diff, no dead code or `console.log`. Review diff size.

| Junk file | Source | Action |
|-----------|--------|--------|
| `*.yaml` (root) | `npx playwright-cli snapshot` w/o `--filename` | Delete or use `--filename=.playwright-cli/snapshots/` |
| `dev-server.log`, `next-dev.log` | dev server redirect | Delete |
| `screenshot-*.png` | Playwright MCP | Delete or move to `e2e-screenshots/` |
| `worker_logs/` | worker engine logging | Already gitignored |

## ⚠️ MANDATORY: Documentation Update Rule

**Documentation MUST be updated IMMEDIATELY after any implementation. If docs are not updated, the task is NOT complete.**

1. **AGENTS.md** — add compact row to version table + bullets to `.agents/CHANGELOG.md` (files changed, root cause/feature)
2. **@Primer.md** — Current Project Status + Session History
3. **@agent-memory.md** — activity log entry
4. **@Lessons.md** — new lesson if pattern/bug discovered

## Usage

1. **Start of session**: Read `@HANDOFF.md` → `latest.md` → `@Primer.md` → `@Lessons.md` → session-todos
2. **During work**: Log in `@agent-memory.md`, update `latest.md` handoff, maintain session-todos
3. **Before commit**: Read `@Lessons.md`, run pre-commit workflow + hygiene checklist
4. **End of session**: Update `@Primer.md`, archive handoff

---

## Common Patterns

### Caching
```typescript
const cacheConfig = nseCache.stockQuote(symbol);
const data = await enhancedCache.getWithCache(cacheConfig, fetchFn, pollingConfig);
```
- **Market cache** (`lib/market-cache.ts`): NodeCache in-memory front (`mc:` keys, TTL 300/3600s) → DB `market_cache` → NSE. `getOrFetchNseData()` returns `source: "cache"` on memory hit.
- **Backtest data** (`lib/services/backtestDataService.ts`): memory `historicalCache` (24h) → temp table `backtest_history` (fresh ≤24h) → `daily_prices` (read-only) → NSE live + upsert temp. Returns `dataSource: "memory"|"db"|"nse"`. **NSE-fetched bars are NEVER written to main `daily_prices`** (temp table only, pruned at 30d).

### API Fetching
```typescript
const data = await nseFetch("/api/endpoint", "?param=value");   // cookies + caching handled
```

### Background Sync (fire-and-forget, never blocks the response)
```typescript
syncService.syncFinancials(symbol, data).catch(err =>
  logger.error({ msg: "Financial sync failed", symbol, error: err })
);
```

---

## Agent Lessons Learned

### Next.js 16 Runtime
- API routes using Prisma/Node.js/crypto MUST `export const runtime = 'nodejs'`. Auth routes MUST use Node.js. Edge runtime lacks `crypto`.
- Stale build errors → delete `.next` + restart dev server.

### Prisma Best Practices
- `npx prisma generate` after schema changes; `migrate dev --name <name>` for migrations.
- **Prisma Guardrails**: AI agents CANNOT run `migrate reset --force` / `db drop` without explicit user consent (CLI blocks). Safe: `migrate dev`, `db push`, `generate`. If blocked: STOP → INFORM → EXPLAIN → VERIFY → WAIT.
- Raw SQL must use camelCase column names as Prisma maps them (e.g. `"tradeDate"`, NOT `trade_date`). `@@map` table names vs model names differ.
- `createMany()` rejects fields not on the model — only pass model fields.
- Interactive `$transaction` expires in 5s on serverless → use `runInChunks()` bounded-concurrency helper for large batches.
### Session Management
- httpOnly + secure + sameSite:strict cookies; NEVER user data in localStorage (XSS).
- `UserSession` model tracks sessions; `cookies()` from `next/headers` wrapped in try-catch.

### Testing with Playwright (required for UI changes)
1. Start dev server (`npm run local`); test login (demo credentials); verify UI renders; check responsive (375/768/1920); check console errors; **cleanup dev server** (port 3000/3001) after.
2. **Never kill port 4096 (OpenCode web UI)** or DB ports.
3. `npx playwright-cli snapshot --filename=.playwright-cli/snapshots/test.yaml` — ALWAYS use `--filename` to avoid root junk.
4. **Debugging an error/issue → run the Playwright UI**: `npm run test:e2e:ui` (`npx playwright test --ui`) to **visually verify** the fix, reproduce the flow, step/re-run specs, and **enhance the UX**. For a one-off visible run, `npx playwright test --headed`. After any run, `npx playwright show-report` opens the HTML report (traces, console + network, per-step screenshots) to diagnose failures.
5. **Committed e2e suite** (`e2e/`, `npm run test:e2e`) is the regression guard — run it after UI/UX/screener/auth changes and before merge/PR. Deep-dive: `.agents/docs/playwright-e2e.md`.
6. **Browser quirks** (all captured in the config/specs — don't regress):
   - Desktop viewport **1440×900** — Firefox's `hidden xl:flex` header nav needs ≥1280px but Firefox measures scrollbar-inclusive, so the default 1280×720 hides it.
   - **WebKit drops `fill()` on controlled `<input type="number">`** (React restores the old value) — use click → `ControlOrMeta+a` → `Delete` → `pressSequentially()` and verify with `toHaveValue`.
   - The Next dev server is **single-threaded** — heavy TradingView scans starve parallel SSR navigations. `navigation.spec.ts` is serial with `waitForURL` + `noWaitAfter`; `retries: CI ? 2 : 1`, `workers: CI ? 1 : 2`.
   - **Never assert live NSE values** (prices/marquee/indices) — `MarqueeBanner` renders `null` when the NSE marquee is slow; assert containers/contracts instead.

### Switch Case Best Practices
Always use block scope `{}` in switch cases to avoid variable hoisting:
```typescript
switch (type) {
  case "alerts": {
    const alerts = await getAnomalyAlerts(50, false);
    return NextResponse.json(alerts);
  }
  default: {
    const data = await getData();
    return NextResponse.json(data);
  }
}
```

---

## AI Safety Guardrails for Prisma

Prisma ORM detects AI agents (Claude Code, Gemini CLI, Qwen Code, Cursor, Aider, Replit) and BLOCKS destructive commands like `prisma migrate reset --force` / `db drop`. When blocked, the agent must: **STOP → INFORM → EXPLAIN (irreversible data loss) → VERIFY (explicit consent) → WAIT** for clear confirmation. Safe commands (generally allowed): `migrate dev`, `db push`, `generate`.

---

## MCP API (Machine Communication Protocol)

Unified endpoint for external NSE data: `POST /api/mcp` (JSON body) or `GET /api/mcp?function=...`. Optional auth via `x-api-key` header (`MCP_API_KEY` env). Response: `{ success, function, data, timestamp }`. Discovery: `listFunctions`, `help`, `describe`, `schema`. **29 functions** (v1.14.0: 22 + `getHistoricalData` added 2026-08-06 + `getIpoAnalysis`/`getIpoIssueDetail`/`getNseEvents` added 2026-08-12 + `getOptionChain`/`getFoExpiries` added 2026-08-13 + `getInvestmentIntelligence` added 2026-08-19). Caching: quotes 60s, market 2m, corp actions 5m, company info 1h. Full reference: `app/api/openapi/route.ts` (Swagger) + README.md.

Key functions: `getIndexData`, `getMarketIndices`, `getStockQuote`, `getStockChart`, `getHistoricalData` (symbol, from, to — uses backtest data chain, returns `source` + `ohlcv`), `getGainers`, `getLosers`, `getMostActive`, `getCorporateActions`, `getCorporateInfo`, `getMarquee`, `getDeals`, `getAnnouncements`, `getInsiderTrading`, `getEvents`, `getHeatmap`, `getSymbols`, `getTrends`, `getIpoAnalysis` (cached 12h), `getIpoIssueDetail` (cached 24h), `getNseEvents` (cached 6h).

---

## NSE Integration Notes

- Use `nseFetch(path, qs)` from `lib/nse-client.ts` (cookie + cache handled). Server-side proxy only; never call NSE from client.
- **Historical data endpoint**: `GET /api/historicalOR/generateSecurityWiseHistoricalData?from=DD-MM-YYYY&to=DD-MM-YYYY&symbol=SYMBOL&type=priceVolumeDeliverable&series=ALL` → `{ data: SecurityWiseHistoricalRow[] }` (fields: `CH_SYMBOL`, `CH_SERIES` EQ|BL, `mTIMESTAMP`/`CH_TIMESTAMP`, OHLC, `VWAP`, `CH_TOT_TRADED_QTY`, `CH_TOT_TRADED_VAL`, `CH_TOTAL_TRADES`, `COP_DELIV_QTY`, `COP_DELIV_PERC`). Fetcher + OHLCV mapper in `lib/nse-api.ts`; use `parseNseDate`.
- **Securities available for trading (Equity segment)**: machine CSV at **`https://archives.nseindia.com/content/equities/EQUITY_L.csv`** — the `www.nseindia.com/static/market-data/securities-available-for-trading` listing page is JS-guarded (curl returns a 404 HTML shell), use the archives host for this file. Full 2,570-scrip metadata (EQ/BE/BZ series) is committed as the generated constant `lib/services/nseScripList.ts` (`NSE_SCRIPS` / `NSE_SYMBOL_SET` / `NSE_SCRIP_BY_SYMBOL` + `isNseSymbol` / `getNseScrip` / `searchNseSymbols`), refreshed via `npm run fetch:scrips -- --write`. ISINs are `^IN[0-9A-Z]{10}$` — SME scrips start `IN9`, not `INE`.
- Rate limits respected; retry + backoff; cache with TTL. See `.opencode/skills/nse-integration/SKILL.md` + `.agents/skills/nse-integration.md`.

## Documentation Workflow Skill

- **`docs-workflow`** (`.opencode/skills/docs-workflow/SKILL.md` + `.agents/skills/docs-workflow.md`) — how to create feature plan files (`docs/designDoc/ph<NN>-*.md`), publish GitHub wiki pages (`TradeNext.wiki.git`), and apply the mandatory repo doc updates (AGENTS.md version table, CHANGELOG, TODO, Primer, Lessons, agent-memory, swagger/OpenAPI). Load this skill before any documentation work.

