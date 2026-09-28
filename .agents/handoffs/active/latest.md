# Live Resume — v3.44.0 Spec 02 Public legal pages (Privacy + Terms)

> Updated: 2026-09-28 · Snapshot of the active handoff for the current session state.

## Status

| Field | Value |
|-------|-------|
| **Task** | Public legal pages — Privacy Policy + Terms of Service (Spec 02) |
| **Branch** | `feature/google-sheets-tracking` (legal commits fast-forwarded + `feature/legal-pages` deleted; **PR #133 open** head→main) |
| **State** | CODE + TESTS + BUILDS + E2E + DOCS **DONE** · **COMMITTED** `fb29b16` + `66db159` — push pending user approval |
| **In-flight** | None — Phase 5 docs complete + status refreshed after branch move |
| **Blocked** | Push: awaiting explicit user approval (branch is 5 commits ahead of remote: 3 v3.43.0 wrap-up `9de434e`/`b8ef109`/`aba7fa6` + 2 legal) — no auto-push/PR/merge/deploy. P6003 production hold until 2026-10-02 (no prod migrations/deploy/Netlify). |
| **Side note** | v3.43.0 Google Sheets console COMMITTED `645cf85` (+ live wrap-up `aba7fa6`) — PR #133 open on this branch, push/merge pending user. PR #132 (v3.41.3 Laya) remains OPEN and unrelated. |

## What's done (v3.44.0)

- **Pages**: `app/privacy/page.tsx` + `app/terms/page.tsx` — public static server components, no auth, **no date/"Last updated" line** (user decision). Content truthful to the product (account/sessions, portfolio/watchlist/alerts/Telegram chat ID, contact form, audit + server logs SQLite 14-day mirror, AI-analysis inputs via OpenRouter, optional admin Google Sheets export = anonymous rows only — no credentials).
- **Terms flavour**: "tool, not an adviser" · NSE disclaimers · 18+ · acceptable use · "laws of India" · liability limits · contact `mailto:luckyhegdedev+tradenext@gmail.com`.
- **Wiring**: contact footer links + Header desktop (`NavLink`) + mobile (`MobileNavLink`); `app/sitemap.ts` priority 0.3 / monthly; `app/llms.txt` +2 entries.
- **Tests**: unit **6/6** (`app/privacy/__tests__/page.test.tsx` 3 + `app/terms/__tests__/page.test.tsx` 3) · NEW `e2e/privacy-terms.spec.ts` **4/4 chromium** (1.2 min, 2 workers incl. auth.setup).
- **Gates**: tsc **46 exact (0 new; prod 0)** · lint **0 errors** (0 in new files) · quickbuild **198/198** (+2 static: `/privacy` + `/terms` both `○`, 2.6 min — dev server killed first, Lesson 150) · doc budget **94.3/100 KB**.
- **Docs**: `.agents/changelog/versions-v3.44.md` + index rows + TODO/Primer/agent-memory/session-todos/HANDOFF/latest + Lessons 150 + session archive. **AGENTS.md row DEFERRED** (32,719/32,768 B cap — 49 B headroom, Lesson 142 trap); recorded in the changelog, to be filled when AGENTS.md is next slimmed.

## Not done (deliberately)

- Full Jest suite + full cross-browser e2e (targeted scope only) → PR gate.
- Push/merge/deploy — needs explicit user approval. Commits landed `fb29b16` (feat) + `66db159` (docs); branch is `feature/google-sheets-tracking` (PR #133).
- No migrations (no schema change), no new packages, no OpenAPI change.

## Next steps

1. **User decision: approve commit** of the two-commit plan above (on explicit request only).
2. After commit: remind user to rotate the Testing-mode token (~minted Sep 28 ⇒ expires ~Oct 5) before any public share/arm; never print the OAuth refresh token.
3. When the P6003 hold lifts (2026-10-02+): deploy path = push → PR → merge → Netlify; include full Jest + cross-browser e2e at the PR gate.

## Gotchas / lessons for this handoff

- **Lesson 150**: a live `next dev` holds `.next` — `next build` on top of it hangs with zero output until timeout. Diagnose first (`netstat -ano | findstr :3000`), kill the PID **you** started (`taskkill /PID <pid> /F`), never kill port 4096 (OpenCode UI) or DB ports. Only kill processes you started.
- **AGENTS.md is at cap** — do NOT edit it (49 B headroom; version row deferred by user decision).
- Windows cmd: no `tail` (use findstr/find). LSP errors in `lib/services/decision/*` are editor noise. Admin login `admin@tradenext6.app` / `admin123`.

## Remaining-merge state of PREVIOUS workstreams

- v3.43.0 (Spec 20 Google Sheets console): committed `645cf85` + `aba7fa6` — push/PR/deploy pending user.
- v3.41.3 (Spec 18 Laya real inference): pushed, PR #132 OPEN — merge/deploy pending user.
- P6003 plan-limit hold: until 2026-10-02 — transient: read fallbacks (SQLite mirror) active; write paths blocked. Full detail: `.agents/changelog/versions-index.md`.