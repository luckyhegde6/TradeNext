# Session decisions — 2026-09-28 · v3.44.0 Spec 02 Public legal pages

## Decisions with reasoning

1. **No date / "Last updated" line on either legal page** (user decision). Rationale: a *suggested* date is misleading (pages describe standing practices, not a dated snapshot); a *static* date goes stale immediately; both pages are versioned in the repo instead.

2. **Link placement = contact footer + Header nav (desktop + mobile)** (user decision). Rationale: legal links belong in the footer, but header placement makes them discoverable pre-scroll; desktop `NavLink` + mobile `MobileNavLink` reuse the existing nav renderers (no new layout machinery).

3. **AGENTS.md v3.44.0 version row DEFERRED** (user decision). Rationale: AGENTS.md sits at 32,719/32,768 B (49 B headroom) — a ~2.3 KB row would breach the per-file injected-context cap (Lesson 142). The compact row is recorded in `versions-v3.44.md` + `versions-index.md`; AGENTS.md is not edited this version.

4. **Content is truthful to the product, not boilerplate.** Privacy covers what actually happens: account/sessions (NextAuth httpOnly cookies + session management), portfolio/watchlist/alerts + Telegram chat ID on subscribe, contact-form submissions, audit + server logs (SQLite mirror, 14-day window), AI-analysis inputs (OpenRouter), optional admin Google Sheets export (**anonymous rows only** — no credentials/emails). Terms: "tool, not adviser", NSE disclaimers, 18+, acceptable use, "laws of India", liability limits, contact `mailto:luckyhegdedev+tradenext@gmail.com`.

5. **Pages are static server components, no auth gating, no client JS.** `/privacy` + `/terms` are pure content → `○` static at build (198/198), zero console risk, no middleware change needed (public paths).

6. **Targeted verification scope for this change.** tsc 46 exact + lint 0 errors + quickbuild + the 6 unit tests + chromium-only `e2e/privacy-terms.spec.ts` (4/4). Full Jest + full cross-browser e2e deliberately deferred to the PR gate (this change touches only 2 new static pages + link strips).

7. **Docs completion includes a session archive** (`.agents/sessions/2026-09-28-legal-pages/`) per session-memory rules — the archive discipline applies every session, including doc-only wrap-ups.

## User decisions on record

- 2026-09-28: no date line · footer + Header links · AGENTS.md row deferral (all three applied).
- 2026-09-28: commit plan = two commits (`feat(legal): public privacy + terms pages` then `docs: legal-pages wrap-up`) — **execution pending explicit approval; no auto-push/PR/merge/deploy.**

## Not decided yet

- Push/PR/merge/deploy of v3.44.0 (blocked by P6003 hold until 2026-10-02 + explicit approval).
- v3.43.0 publish (committed `645cf85` + `aba7fa6`) — pending user.
- PR #132 (v3.41.3 Laya) — separate workstream, pending user.