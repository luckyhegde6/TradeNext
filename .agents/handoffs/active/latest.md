# Live Resume — v3.47.0 Specs 25 + 26 (scheduled-execution reliability + Google-Sheets header-label fix)

> Updated: 2026-10-09 · Snapshot of the active handoff for the current session state.

## Status

| Field | Value |
|-------|-------|
| **Task** | Two follow-up fixes after v3.46.0 (MERGED via PR #134 `c0bb972` into `main` `c8bdad1`): (25) scheduled-execution reliability — Netlify ~2h idle suspension kills node-cron ticks so due jobs were silently skipped; (26) GS console header-label fix — every healthy tab rendered "unknown" |
| **Branch** | `fix/daily-rec-swing-cron-worker` (base `main` `c8bdad1` = PR #134 MERGED) |
| **State** | Spec 25 **COMMITTED `480cd3b`** (14 files +821/−274, pre-commit green: tsc prod 0, context budget 91.8/100 KB) · Spec 26 CODE + TESTS + GATES + DOCS **DONE** — **COMMIT PENDING USER (2026-10-09, D9)** · merge/push/deploy = user actions |
| **In-flight** | None — awaiting user "Commit Now" for Spec 26 (`app/admin/google-sheets/page.tsx` + new unit test + spec/plan docs + versions-v3.47.md docs) |
| **Blocked** | (none — commit only on explicit request per D9 RULE) |
| **Side note** | ⚠️ **BUG A (follow-up, open)**: degraded executor completes but never advances mirror `next_run` → recurring job re-fires every 5-min tick while due; fix idea = advance via `calculateNextRun` (`worker-engine.ts` :729/:762). Queue IS SQLite-persisted (`_degradated_task` in `logs/sqlite-mirror.sqlite` — corrects earlier in-memory belief). |

## What's done (v3.47.0)

- **(25) Scheduled-execution reliability**: `catchUpMissedCronJobs()` (`worker-engine.ts` ~L791) with `CRON_CATCHUP_WINDOW_MS=15min` — missed ≤15min **spawned** (same guards as `checkScheduledJobs`, skip `running`), stale re-armed advance **never fired**; wired at daemon boot + 5-min resync tick; daemon defaults **UTC** (`DEFAULT_TIMEZONE="UTC"`, per-job override kept + config-drift self-heal). **Smoke-verified live**: degraded enqueue 13:49:58 → completed 13:50:43 (`stockCount 10870`); re-enqueue + mid-run kill → durable `running` row in mirror `_degradated_task`; restore verified psql + mirror dump + live boot `Recomputed ×4 changed=false` (nextRuns 2026-10-12).
- **(26) GS header-label fix**: `app/admin/google-sheets/page.tsx` declared a disjoint 6-state `HeaderState` while the server emits exactly `"matched"|"drifted"|"absent"|"unknown"` (`tabs.ts` `classifyHeader`) → every healthy tab rendered **"unknown"** (confirmed prod). Fixed: `import type { HeaderState } from "@/lib/services/googleSheets/tabs"` (type-only, erased) + **exported** 4-key `HEADER_BADGE` (`matched` "header ok" green · `drifted` "header drifted" amber · `absent` **"no header yet" blue** — was red "tab missing" · `unknown` gray); render fallback `?? HEADER_BADGE.unknown` kept; server contract + statusService untouched.
- **Tests**: NEW `googleSheetsHeaderBadge.test.ts` **5/5**; Spec 25 targeted suites **93/93**.
- **Gates**: tsc **46 exact (prod 0)** · ESLint 0 · live `/admin/google-sheets` renders all 6 tabs, zero console errors (dev reads `unknown` — no live sheet locally; the matched visual is prod-only and covered by the unit test) · quickbuild PENDING (needs dev-server kill first, Lesson 150).
- **Docs**: `.agents/changelog/versions-v3.47.md` (Specs 25+26) + AGENTS.md v3.47.0 row + CHANGELOG index + versions-index + TODO + Primer + agent-memory + session archive D14/D15 + Lessons 159.

## Not done (deliberately)

- **COMMIT Spec 26 — PENDING USER (explicit "Commit Now" only, D9)**: files = `app/admin/google-sheets/page.tsx`, `lib/__tests__/googleSheetsHeaderBadge.test.ts`, `.agents/specs/26-*.md`, `.agents/plans/26-*.md`, `.agents/changelog/versions-v3.47.md`, AGENTS.md, CHANGELOG.md, versions-index.md, TODO.md, Primer.md, agent-memory.md, session archive, HANDOFF docs, Lessons.md. Commit message style: `"Spec 26: <title> — <details>"`.
- **BUG A / BUG B**: next_run advance in degraded completion path (follow-up spec), 405 POST leave as-is.
- **quickbuild** — needs dev server (PID 14676 on :3000) killed first (Lesson 150); rerun after commit if requested.
- Merge `fix/daily-rec-swing-cron-worker` → `main`, push, deploy — **user actions (D9), never automatic.**

## Next steps

1. **Await user "Commit Now"** for Spec 26 → single commit on `fix/daily-rec-swing-cron-worker` (pre-commit hook timeout ≥ 600000 ms).
2. After commit (user-requested): quickbuild (kill dev server first, restart after) and present gates.
3. User decides merge/push/deploy. BUG A fix = next spec/plan cycle (needs user approval).

## Gotchas / lessons for this handoff

- **D9 RULE (user directive)**: MERGE + DEPLOY are ALWAYS user actions — agent max git action = COMMIT on explicit request. No auto-merge/deploy even on green CI (`.agents/RULES.md` §6).
- **Lesson 159**: a degraded/catch-up executor that completes without advancing the mirror `next_run` re-fires "due" jobs on every poll tick — dedup-only protection; advance next_run in the completion path.
- **Lesson 150**: `next build` hangs while a dev server holds `.next` — quickbuild requires killing the dev server first, then restarting it.
- Dev server PID 14676 on :3000; Chrome page 5 authed as admin; nav timeout ≥ 60000; log timestamps UTC.
- tsc baseline = **46 error lines (prod 0; all pre-existing test-file errors)** — must stay 46 exact.
- Windows cmd: no `tail` (use `Get-Content ... -Tail N | Select-String` via PowerShell); `grep` tool path-scoping unreliable — use `findstr /n` or `read`.
- AGENTS.md doc-gate cap 32,768 B (Lesson 142); AGENTS.md ~29,2xx B + v3.47.0 row — verify `check-doc-sizes.test.ts` green.
- Admin login `admin@tradenext6.app` / `admin123`; demo `demo@tradenext6.app` / `demo123`.

## Remaining-merge state of PREVIOUS workstreams

- v3.46.0 (ops-counter authority / GS tolerance / catch-up): **MERGED via PR #134 `c0bb972`** into `main` (2026-10-09).
- v3.45.0 (degraded engine): **MERGED into `main`** (2026-10-06) — pending Netlify deploy + Dependabot alert clearance.
- v3.44.0 (legal pages): committed + pushed, PR #133 MERGED 2026-10-06.
- v3.43.0 (Sheets console): committed + pushed, PR #133 MERGED 2026-10-06.
- v3.41.3 (Laya): pushed, PR #132 MERGED `4b68e30` (2026-09-25).
- v3.38.x: PR #121 OPEN, PR #118 OPEN — merge/deploy pending user.
- Full detail: `.agents/changelog/versions-index.md`.