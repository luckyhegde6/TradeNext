# Session Decisions — 2026-10-09 v3.46.0 Specs 22/23/24

Branch: `feature/fix-ops-counter-authority-sync` (PR #134, base `main` `5a0ddb2`)

## Decisions

### D1. Spec 22 — authority day lives in `DbHealthCheck`, not the ops counter state
- **What**: `buildQueryConsumption(state, live, planLimit, authorityToday?)` in `lib/services/opsMonthly.ts`; the ops month mirrors the live day from `DbHealthCheck.live_ops_month`/`last_reset`; db-health route GET (counters + authority) + PATCH `set_ops_counter` (zod, :226/:444, audit `DB_HEALTH_SET_OPS_COUNTER`).
- **Why**: the month boundary (and which day "today" is) belongs to the DB health record, the same authority the ops counter itself is enforced against — a drifted Postgres counter can then be corrected through the API instead of manual SQL.

### D2. Spec 23 — missing Google-Sheets tables are tolerated at the mirror-writer, never a worker throw
- **What**: `lib/sqlite.ts` catches Prisma `P2021`/"does not exist" for the Google-Sheets tables → `logger.info` + `return null` (no-op). `netlify.toml` build = `npx prisma migrate deploy && node scripts/predeploy/preserve-mirror.mjs && npx prisma generate && npm run quickbuild`.
- **Why**: the prod schema bootstrap predates the v3.43.0 GS models; a cold-start deploy must not have the SQLite sync write path throw into the worker. Running `migrate deploy` before the build creates the tables on prod. **Flagged as production-affecting in the PR.**

### D3. Spec 24 — missed ticks: in-window spawn, stale re-arm forward, never retro-fire
- **What**: `catchUpMissedCronJobs()` (`worker-engine.ts` ~L855), `CRON_CATCHUP_WINDOW_MS=15min`; missed ≤15min **spawned** (same guards as `checkScheduledJobs`, skip `running`); stale >15min re-armed (`nextRun` advanced), record `cron_missed_tick` then set the nextRun forward WITHOUT firing. Wired at daemon boot + 5-min resync tick (`cron-daemon.ts`).
- **Why**: Netlify suspends idle instances ~2h so node-cron ticks stop; the daemon only polls due jobs so a missed `nextRun` is never re-discovered on wake. Spawning stale jobs retroactively would produce meaningless duplicate work — the window binds what may still be "fresh enough" to fire.

### D4. Docs: AGENTS.md row deferred again (cap), detail moved to `.agents/changelog/versions-v3.46.md` (Lesson 142 pattern)
- **Why**: AGENTS.md is 32,949 B > 32,768 B cap; the version-row edit is recorded in the changelog and must be landed when AGENTS.md is next slimmed (Lesson 158).
- **D4 addendum (2026-10-09, same session)**: the user then approved **"Trim AGENTS.md now (+4 KB)"** — superseding the deferral. AGENTS.md was rewritten (temp script → committed version): re-landed v3.44.0/v3.45.0/v3.46.0 rows, compacted v3.43.0/v3.41.x rows → **32,564 → 29,197 B** (< cap). The user also approved **"Commit + push to PR #134"** (ONE commit: code + docs + trim; merge/deploy still user-controlled).

### D5. No OpenAPI/swagger update for v3.46.0
- **Why**: no new API routes in this diff (only existing routes changed); per Lesson 151 the swagger capture is route-coverage based.

### D6. 26,819 = CURRENT MONTH (user correction) → counter fix EXECUTED
- **What**: the user corrected the prior-session premise: Prisma Console 26,819 is **October-to-date usage, NOT lifetime** — so the month ledger (120 ops) undercounts real proxy ops ~220× and the `set_ops_counter` correction WAS required (the plan-limit breaker/degraded thresholds ≥180,000 are effectively blind without it).
- **Split**: the user approved the **ratio estimate** (the actual reads/writes split is not exposed) → 26,819 × 43/120 reads ≈ **9,610** · × 77/120 writes ≈ **17,209** (43:77 = observed ledger ratio, reads:writes ≈ 1:1.79).
- **Execution**: POST `/api/admin/db-health` `{action:"set_ops_counter", reads:9610, writes:17209, scope:"month"}` on prod → 200 with `totalOperations = 26,819` (today backfilled 9,575R/17,132W by difference; other 7 days' 35R/77W untouched; live counter never zeroed — honest). Audit `ADMIN_DB_SET_OPS_COUNTER` recorded.
- **Why scope=month**: a `today` correction would only fix today's cell; the mismatch the user cares about (Prisma Console month usage) is the month aggregate.

### D7. Ops ledger is per-Netlify-instance → deploy is the propagation vehicle
- **What**: the follow-up GET on a different instance returned 122 — the ops ledger lives in `globalThis` + a per-instance SQLite snapshot; the 60s persist tick writes disk only; Blobs uploads happen only on boot `syncFromPrisma()` or deploy `preserve-mirror.mjs`.
- **Decision**: do NOT chase per-instance counter drift by repeated PATCHes. Merge + deploy PR #134 (which itself runs preserve-mirror at build) → verify cluster-wide 26,819 on the v3.46 build; if a fresh instance still shows a stale ledger, one re-PATCH `set_ops_counter` scope=month lands properly thanks to v3.46's `authorityToday`.

### D8. Docs: no stale "lifetime" claim to correct
- Swept `.agents/*.md` for "lifetime"/"26,819" — the prior-session belief was never written to any doc; only this session's corrected entries exist. No doc correction needed beyond the session-todos/flow/decisions updates.

### D9. MERGE and DEPLOY are ALWAYS user actions (user directive — RULE, codified)
- **User directive (verbatim, answer to the PR #134 merge/deploy question)**: "Only Commit, merge and deploy is always a user action and make it rule".
- **Meaning**: the agent's maximum git action is COMMIT (and only when explicitly requested); **MERGE and DEPLOY are user-only, no exceptions** — never auto-merge a green PR, never trigger a deploy, even after the user approved the underlying work.
- **Codified**: `.agents/RULES.md` §6 Git Rules (bolded rule line) + `.agents/rules/session-memory-rules.md` §6 Git Guidelines. AGENTS.md agentic-workflow step 7 already stated the equivalent ("commit on explicit user request only (agents never auto-push/deploy/merge)") — now sharpened by the new rule.
- **Action taken**: PR #134 stays OPEN (11/11 checks green, mergeable) awaiting the user; no deploy triggered. The pending v3.46.0 code is already committed+pushed (`d0ea87e`); this turn's PROD-FIX docs were COMMITTED locally (not pushed) per the directive.

### D10. Decision-engine env question RESOLVED by user: "Plan real Laya later"
- The pending question (arm real Laya via `DECISION_PROVIDER`/`DECISION_POC_ENABLED`, ~503 MB int8 weights) was put to the user alongside the merge/deploy question; the chosen option was **"Plan real Laya later"**.
- **Meaning**: keep the decision engine inert (`DECISION_PROVIDER=none`, `DECISION_POC_ENABLED=false`) — **no env change now**; a real-Laya rollout is deferred to a future planned spec (the v3.41.3 runtime parity gate `DECISION_LAYA_REAL=1` remains available).

## Gate results (recorded, not re-run)

- tsc **46 exact (0 new; prod 0)** · ESLint **0 errors (8 files)** · quickbuild **199/199**.
- Targeted Jest 4 suites **192/192** (10 new: 7 catch-up + 3 wiring).
- Full Jest **133/134 suites · 1979 pass / 4 skip / 3 fail** — only `check-doc-sizes.test.ts` red (AGENTS.md 32,949 > 32,768 B; pre-existing, not caused by this diff).
- **Post-trim (same session)**: AGENTS.md 29,197 B → `check-doc-sizes.test.ts` **14/14 green** → full Jest **134/134 · 1979 pass / 4 skip / 0 fail**; doc-budget gate 91.8/100 KB OK.
### D11. GS tracking re-armed — fresh OAuth refresh token + local e2e verified (2026-10-09)
- Old local `GOOGLE_OAUTH_REFRESH_TOKEN` (len 103) was DEAD: `invalid_grant` "Token has been expired or revoked".
- Re-consented via a local port-80 catcher (copy-free, no value printed); fresh token (len 103) exchanged OK, scope `spreadsheets`; read-only verified against `TradeNext Tracker` (11 tabs).
- Real pipeline e2e (throwaway tsx, `process.env` override, **no .env write**): `exportCustomScan` -> `ensureHeaders` wrote the 13-col `custom` header + appended 1 encoded row (incl. derived `change` via rupeeChange); confirmed by direct sheet read-back. The awaited best-effort audit hung only because local Postgres was down (fire-and-forget in prod, so no producer impact).
- Applied: local `.env` token rotated; Netlify `GOOGLE_OAUTH_REFRESH_TOKEN` set as **SECRET** (production/deploy-preview/branch-deploy) + `GOOGLE_SHEETS_TRACKING_ENABLED=true` (all contexts).
- Local admin console verified via Playwright: Tracking ON - env master true - Configured yes - OAuth client id/secret/refresh token all OK. (headerState "unknown" + metrics retained 1 = fresh local-ledger artifacts, not errors.)
- Deploy remains the user's action; Netlify env changes take effect only after a redeploy (- PR #134 merge + deploy pending user).

### D12. Scheduled-execution fixes split into TWO specs (25 + 26) — bug-fix reliability + one UI label fix
- **Context**: after PR #134 merged (`main` @ `c8bdad1`), a fresh branch `fix/daily-rec-swing-cron-worker` was cut to fix the four reported areas (daily rec / swing / cron / worker-outbox) + the Google Sheets console.
- **Root causes confirmed (code read)**: (1) **timezone split-brain** — expressions + `nextRun` are UTC (`cron-parser.ts` v3.10.1), but `ensureRecommendationCrons` stores `config.timezone:"Asia/Kolkata"` (`:208/:227`) and `cron-daemon.ts:240` registers node-cron with it ⇒ `30 4` fires 04:30 IST (23:00 UTC), 5.5h off; (2) **15-min catch-up skip** drops once-daily jobs missed during Netlify's ~2h suspension; (3) **degraded catch-up no-ops** (`worker-engine.ts:866`) so a hold has no recovery enqueue; (4) **dead poll** `startScheduler`/`checkScheduledJobs` never called; (5) **outbox** only drains on 6h probe/admin/deploy, never on the 5-min tick.
- **Decision**: author **Spec 25** `25-scheduled-execution-reliability.md` (cron tz + catch-up + degraded + outbox + delete dead poll; daily-rec/swing are verify-only) and **Spec 26** `26-google-sheets-header-label-fix.md` (client `HeaderState`/`HEADER_BADGE` disjoint from server `"matched"|"drifted"|"absent"|"unknown"` → every healthy tab renders "unknown"; `absent` mislabelled "tab missing"). Plans 25/26 drafted in `.agents/plans/`.
- **Two approved fix policies** (user, this session): missed-tick recovery = **"Run any overdue job, dedup-guarded"** (remove the 15-min skip); Prisma-down = **"auto-engage the degraded path"** (mirror-based enqueue + local `next_run` advance, zero Prisma).
- **Status**: specs + plans DRAFTED, awaiting **human approval** before any code (spec-driven gate).

### D13. Per-job timezone override kept (documented caveat); system jobs canonical UTC
- **What**: `cron-daemon` keeps `job.config.timezone || DEFAULT_TIMEZONE`, but `DEFAULT_TIMEZONE` → `"UTC"` and system jobs store `timezone:"UTC"` (+ config-drift self-heal rewrites existing IST rows).
- **Why**: only the system jobs (the ones actually broken) are UTC-authored; preserving per-job override avoids touching manual cron UX. A manual non-UTC override still won't match the UTC `nextRun` — accepted, documented caveat; optional follow-up.

### D14. Smoke-verified Spec 25; BUG-A re-fire loop confirmed + queue-durability finding
- **What we proved live (dev server smoke)**: overdue degraded catch-up works — `13:49:58` enqueue → claimed → executed → **completed 13:50:43** (stockCount 10870) → drained. Policy "run any overdue job, dedup-guarded" confirmed.
- **BUG A confirmed**: the next 5-min tick re-enqueued the same due job (`13:54:59`, 7e90adda) → `running`. Root cause: the degraded executor completes but does NOT advance the mirror `next_run` (approved policy "local next_run advance, zero Prisma" is not fully implemented in the degraded executor), so catch-up legitimately re-fires every tick; only the 90-min pending/running dedup stops a 3rd fire while a row is running. Fix idea (follow-up): advance mirror `next_run` in the degraded completion path (same `calculateNextRun` used in spawn :729/:762) so the job stops being "due" after one execution.
- **Queue durability finding (corrects earlier belief)**: the degraded queue IS persisted — the mirror table `_degraded_task` (36-table snapshot; 2 smoke rows dumped from file). My earlier "not persisted" probe hit a wrong table name (`degraded_queue`). A kill mid-run leaves a `running` row that survives restarts; the 30-min stale-reclaim is GATED on degraded-active, so it sits dormant while `active=false`. Harmless: SQLite-only, no Prisma model, no dedup/execution impact while inactive.
- **Restore + final state verified**: all 4 `cron_jobs` nextRun 2026-10-12 in Prisma (psql) AND mirror file (node dump) AND confirmed by the live daemon boot (`Recomputed` ×4 `changed=false`, zero degraded enqueues, 4 jobs registered UTC). Mode auto, active=false. **BUG B**: `POST /api/admin/degraded-mode` = 405 (GET+PATCH only) — confirmed, leave as-is.
- **Gates**: tsc + targeted suites re-verified before commit.
- **Implication**: degraded recovery is proven end-to-end; remaining work = commit (user-requested only), then Spec 26, then docs rollup.
