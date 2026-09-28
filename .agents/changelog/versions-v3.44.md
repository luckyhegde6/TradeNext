# TradeNext v3.44.0 — Spec 02 Public legal pages (Privacy + Terms)

> **Status:** CODE + TESTS + BUILDS + E2E + DOCS **DONE** · **COMMITTED** `fb29b16` + `66db159` (now on `feature/google-sheets-tracking`, PR #133) — push pending user approval · merge/deploy not yet.
> **Branch:** `feature/google-sheets-tracking` (legal commits fast-forwarded off `aba7fa6` = v3.43.0 live-verification wrap-up on the `645cf85` chain; the temporary `feature/legal-pages` branch was deleted after the move).
> **Spec / plan:** `.agents/specs/02-public-legal-pages.md` + `.agents/plans/02-public-legal-pages.md` — user-approved 2026-09-28 with all three decisions: **(1)** no date/"Last updated" line on either page, **(2)** links in the contact footer + Header nav (desktop + mobile), **(3)** AGENTS.md v3.44.0 row **deferred** (per-file cap).
> **Supersedes:** nothing — independent of the v3.43.0 Google Sheets console (committed `645cf85`; PR #133 now open from this branch — push/merge pending user).

## What it does

NEW public static pages `/privacy` (Privacy Policy) and `/terms` (Terms of Service) — no auth required, server components, **no date/effective line** (user decision). Both are truthful to the product:

**Privacy disclosures** (page-by-page reality, not boilerplate):
- account + sessions (NextAuth httpOnly cookies, session management/invalidation),
- portfolio / watchlist / alerts + Telegram chat ID when a user subscribes to the bot,
- contact-form submissions,
- audit + server logs (SQLite mirror with the 14-day retention window),
- AI-analysis inputs (OpenRouter provider),
- optional admin Google Sheets export — **anonymous rows only, no credentials/emails exported**.

**Terms** (liability-shaped, honest): "tool, not an adviser"; NSE data disclaimers; 18+ usage; acceptable-use list; governing law "of India"; liability limits; contact `mailto:luckyhegdedev+tradenext@gmail.com`.

## Workstreams

1. **Pages** — `app/privacy/page.tsx` + `app/terms/page.tsx` (static server components, metadata titles/descriptions, dark-mode friendly; no auth).
2. **Wiring** — contact-footer link blocks + Header desktop (`NavLink`) + mobile (`MobileNavLink`) entries; `app/sitemap.ts` priority 0.3 / monthly; `app/llms.txt` route +2 entries.
3. **Tests** — unit **6/6** (`app/privacy/__tests__/page.test.tsx` 3 + `app/terms/__tests__/page.test.tsx` 3: public render, no date line, expected sections/links) · NEW `e2e/privacy-terms.spec.ts`: `/privacy` public, `/terms` public, contact legal-links strip → **4/4 chromium** (1.2 min, 2 workers incl. auth.setup). Full Jest suite + cross-browser e2e **deferred to the PR gate** (targeted scope only).
4. **Gates** — tsc **46 exact (0 new; prod 0)** · lint **0 errors** (0 in new files; pre-existing warnings unchanged) · quickbuild **198/198** (+2 static: `/privacy` + `/terms` both `○`, 2.6 min — dev server killed first, **Lesson 150**) · doc budget **94.3/100 KB**.

## Documentation & bookkeeping

- **AGENTS.md v3.44.0 row is DEFERRED** — `AGENTS.md` sits at **32,719 B / 32,768 B cap (49 B headroom)**, so the ~2.3 KB version row would breach the per-file budget (Lesson 142 trap). The compact row is recorded here and in `versions-index.md` and will be filled when AGENTS.md is next slimmed. **No edit was made to AGENTS.md in this version.**
- Lessons **150** (a running `next dev` holds `.next` → `next build` hangs with zero output until timeout; kill the dev-server PID you started before building).
- No schema change → no migration; no new packages; no API/route change; no OpenAPI change.
- Not done (deliberately): full Jest + full cross-browser e2e deferred to the PR gate; no push/PR/merge/deploy.
- Commit plan (on explicit user approval, 2 commits): `feat(legal): public privacy + terms pages` then `docs: legal-pages wrap-up`.