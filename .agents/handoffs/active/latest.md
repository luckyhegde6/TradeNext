---
handoff: v3.32.1-db-health-body-once-fix
session_id: v3.32.1-db-health-body-once-fix
date: 2026-09-10
branch: main (HEAD b75deb0; v3.32.0 PR #117 merge 38a27bf present; NO new branch created)
last_commits: b75deb0 (main HEAD), 38a27bf (PR #117 merge), df7959d + e74ae54 (v3.32.0 docs/feat) — v3.32.1 code+tests+docs are in the WORKING TREE, NOT committed
dev: local :3000 (dev PID 12096 — will be killed at cleanup; MCP 4096 do not kill, pg docker 5432 do not kill)
status: in_progress
commit: pending user approval
---

# Handoff — v3.32.1 — db-health POST double-`req.json()` hotfix (restore + set_time_correction 400s)

## Summary
**Fix + regression test + full doc set are DONE and VERIFIED in the working tree on `main` (COMMIT PENDING USER — no push/merge/deploy).**
v3.32.0 (Admin Time Synchronisation) MERGED to `main` via PR #117 (`38a27bf`; `e74ae54` feat · `df7959d` docs · `b75deb0` docs update). Post-merge live triage exposed: POST `/api/admin/db-health` reads `req.json()` at the top (~:238) for `action`, then `restore` (~:272) and `set_time_correction` (~:434) RE-READ the body — a Web `Request` body stream is single-use (`bodyUsed` after the first `json()`) → second read throws → both 400'd as `"Invalid restore payload"`/`"Invalid payload"` (`restore` broken since v3.21.2; `set_time_correction` inherited the pattern in v3.32.0).

## What shipped (v3.32.1 — surgical, route only)
- Hoisted the body read at the POST top: `let action = "sync_sqlite"; let requestBody = {}; try { requestBody = (await req.json()) ... }` with `// v3.32.1 fix: parse the body ONCE here and reuse requestBody`.
- `restore` reuses `requestBody as { data?: string; file?: string }` — unparseable body → `{}` → existing `400 "Missing base64 sqlite data"` path (honest error).
- `set_time_correction` reuses `requestBody as { istDateTime?: string }` — missing → zod `400 "istDateTime is required"` (was masked `"Invalid payload"`).
- NEW `lib/__tests__/dbHealthRoute.test.ts` **5/5** — real `Request` via `jsonPost` helper enforcing `bodyUsed` (restore valid/invalid, set_time_correction valid/missing-istDateTime, unknown action → `sync_sqlite` default).

## Verification
- `dbHealthRoute.test.ts` **5/5**; tsc **46 = exact baseline (0 new)**; no migration; no new packages.
- **Live-verified** (Playwright :3000 admin db-health): Save Correction → `"Correction saved: server clock is 1 min SLOW (offset 1)"` + chip + footnote `"Active offset: 1 min"`; Clear → `"No correction saved — using the raw server clock"`; 0 console errors.

## Deferred / Next
- **Deferred** (v3.32.0): live `probe_time` DB check (local Postgres not running); durable fix = correct `TZ`/`UTC` env on Netlify (header-documented).
- **Next**: cleanup (verify + kill dev PID 12096 + temp dev-server log; keep MCP 4096 + pg docker 5432) → run `/pre-commit-check` → stage the v3.32.1 file set (`M app/api/admin/db-health/route.ts`, `?? lib/__tests__/dbHealthRoute.test.ts`, AGENTS.md, `.agents/changelog/versions-v3.32.md`, TODO.md, HANDOFF.md, Primer.md, Lessons.md, agent-memory.md, `.agents/handoffs/active/latest.md`, `.agents/sessions/2026-09-10-time-correction/{flow,decisions}.md`, `.agents/session-todos.md`, `.agents/CHANGELOG.md`) → commit `fix(admin): v3.32.1 db-health POST body-parsed-once (restore + set_time_correction)` → **no push/merge/deploy without explicit approval**.

## Session archive
`.agents/sessions/2026-09-10-time-correction/` — decisions.md (D1-D6) + flow.md (v3.32.0 trace + v3.32.1 hotfix trace). Plus spec/plan `10-admin-time-correction.md` (v3.32.0) + `.agents/changelog/versions-v3.32.md` (v3.32.0 + v3.32.1 sections).