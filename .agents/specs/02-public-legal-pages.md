# Spec Document — Public Legal Pages (Privacy Policy + Terms of Service)

> Generated 2026-09-28. Source: user request "legal pages workstream" (public Privacy Policy + Terms of Service pages, linked from the contact footer).

## 1. Overview

**What**: Add two static, public legal pages — `/privacy` (Privacy Policy) and `/terms` (Terms of Service) — plus a small legal-links strip at the bottom of the existing `/contact` page linking to both. Pages are server components with `export const metadata`, no client JS, no DB, no API routes, no auth changes.

**Why**: The app is being prepared for public launch/PR; a production-facing site needs minimal first-party privacy + terms content ("tool, not adviser"). Content must be truthful to what the app actually does with data (sessions, portfolio/holdings/watchlist/alerts, contact form, audit logs, AI analysis via OpenRouter, optional admin Google Sheets export, SQLite write-behind mirror).

**Scope**:
- IN: `app/privacy/page.tsx`, `app/terms/page.tsx` (new static pages), legal-links strip in `app/contact/page.tsx`, **Privacy + Terms links in the Header nav (desktop + mobile — user decision)**, sitemap entries (`app/sitemap.ts`), llms.txt entries (`app/llms.txt/route.ts`), Jest render tests, one small e2e spec, mandatory repo docs.
- OUT: account-deletion flows or any new API/Prisma models, cookie-banner/consent tooling (no third-party trackers exist — nothing for a banner to gate), real legal counsel review, multi-language versions.
- **User decisions (2026-09-28)**: NO effective/"Last updated" date line on either page; links in contact footer AND Header nav; AGENTS.md version row deferred (per-file budget) — detail lives in changelog/Primer/agent-memory.

**Depends on**: Nothing (static pages). Runs on `feature/google-sheets-tracking` (HEAD `aba7fa6`); new branch `feature/legal-pages` proposed.

---

## 2. Routes

No API routes. New page routes:

| Route | Type | Auth | Notes |
|-------|------|------|-------|
| `/privacy` | Page | public | Static server component |
| `/terms` | Page | public | Static server component |

---

## 3. Database Schema

None. No Prisma changes, no migration, no client regeneration.

---

## 4. Functions to Implement

None. Content-only pages. Shared small helper optional: a `LegalSection`-style local component per page is NOT needed — keep each page self-contained prose sections (repo rule: no abstractions for single-use code). A tiny shared `<LegalLinks />` strip in `app/contact/page.tsx` is a plain JSX fragment, not a component.

### Page structure (both pages, matching contact page conventions)

- `export const metadata: Metadata` — `title: "Privacy Policy - TradeNext"` / `"Terms of Service - TradeNext"` + description.
- Layout: `bg-gray-50 dark:bg-slate-950`, `max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16`, `<h1>` hero with effective/"Last updated" date line, `<h2>` sections, prose paragraphs.
- Tailwind `dark:` variants so both themes render (repo invariant).

---

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `app/privacy/page.tsx` | **Created** | Privacy Policy page |
| `app/terms/page.tsx` | **Created** | Terms of Service page |
| `app/contact/page.tsx` | Modified | Add legal-links strip (`Privacy Policy · Terms of Service`) below FAQ section |
| `app/Header.tsx` | Modified | Add `Privacy` + `Terms` links to desktop nav (adjacent to Contact) + mobile nav |
| `app/sitemap.ts` | Modified | Add `/privacy` + `/terms` (priority 0.3, `changeFrequency: "monthly"`) next to `/contact` block |
| `app/llms.txt/route.ts` | Modified | Add both pages to the public-pages list |
| `app/privacy/__tests__/page.test.tsx` | **Created** | Render assertions |
| `app/terms/__tests__/page.test.tsx` | **Created** | Render assertions |
| `e2e/privacy-terms.spec.ts` | **Created** | Public nav + content + contact-footer links |

---

## 6. Dependencies

### New Packages

| Package | Version | Reason |
|---------|---------|--------|
| None | — | — |

### Internal Dependencies

| Module | Function Used | Purpose |
|--------|---------------|---------|
| `next` | `Metadata` | Page metadata |
| `@/lib/logger` | — | None needed (static pages) |

---

## 7. API Contract

None — pages only, no request/response shapes.

---

## 8. UI/UX Requirements

### Components

No new components. The contact-page strip is inline JSX:

```tsx
{/* Legal links */}
<footer className="border-t border-gray-200 dark:border-slate-800 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex gap-6 text-sm text-gray-500 dark:text-gray-400">
  <a href="/privacy" className="hover:text-blue-600 dark:hover:text-blue-400">Privacy Policy</a>
  <a href="/terms" className="hover:text-blue-600 dark:hover:text-blue-400">Terms of Service</a>
</footer>
```

### States

- Static content — no loading/empty/error states required (server-rendered prose).
- Responsive: single column, text wraps naturally at 375px; strip stacks cleanly.
- Dark/light: explicit `dark:` classes on page + strip.

---

## 9. Rules & Guardrails

- [x] No Prisma in client components (none — server components only)
- [x] No business logic in UI (pure prose)
- [x] No undocumented API routes (none added)
- [x] No unvalidated inputs (none)
- [x] No silent failures (none possible)
- [x] Public pages added to `app/sitemap.ts` + `app/llms.txt/route.ts` (documented public-page boundary)
- [x] No `console.log`, no secrets, no client-side data

---

## 10. Expected Behavior

1. `GET /privacy` returns 200, renders `<h1>` "Privacy Policy", an effective/last-updated line, and sections matching §11 content.
2. `GET /terms` returns 200, renders `<h1>` "Terms of Service" and the promise "not financial advice" / "tool, not adviser".
3. Contact page bottom renders links "Privacy Policy" and "Terms of Service"; both `href` correctly and navigate to the new pages.
4. Header nav (desktop + mobile) renders `Privacy` and `Terms` links; both navigate to the new pages.
5. Sitemap includes `/privacy` + `/terms` (public pages only — no admin/auth leaked).
5. Both pages render identically in dark + light mode; no horizontal scroll at 375px.
6. No console errors on either page.

---

## 11. Content Outline (truthful to current app behavior)

### Privacy Policy (`/privacy`)

> No "Last updated" date line — per user decision (2026-09-28).
>
- **What we collect**:
  - Account: name, email, hashed password, role; session records (httpOnly SameSite=Strict session cookie).
  - Your data: portfolio transactions, holdings, watchlist, alerts/rules/channels, Telegram chat ID.
  - Contact form: name, email, subject, message (stored as admin notification + audit entry).
  - Server-side audit + request logs; SQLite write-behind mirror (14-day TTL) used for DB-outage resilience.
  - AI analysis: symbols/watchlists/data you submit may be sent to configured AI providers (e.g. OpenRouter) to generate analyses.
  - Optional admin Google Sheets sync: anonymous recommendation/screener/tracker rows to the operator's spreadsheet (deliberately no user PII).
- **How we use it**: operate the service, deliver alerts, respond to contact, troubleshooting, compliance.
- **Sharing**: never sold/rented; AI providers receive analysis inputs only; NSE/data-source rights remain with their owners.
- **Retention**: account data until deleted; contact messages in admin notifications; mirror TTL; logs per ops policy.
- **Your rights**: access, correction, deletion via contact email; close account anytime.
- **Security**: TLS, hashed passwords, httpOnly cookies, RBAC.
- **Changes**: page updated with new date when materially changed.
- **Contact**: luckyhegdedev+tradenext@gmail.com.

### Terms of Service (`/terms`)

> No "Last updated" date line — per user decision (2026-09-28).
>
- **Service**: NSE (India) market-data analytics platform, tools, AI-generated analyses; operator contact email.
- **Acceptance**: using the site = acceptance; must be 18+.
- **NOT financial advice**: "tool, not adviser" — informational/educational only, no personalized advice, no fiduciary relationship; recommendations are algorithmic/AI outputs with no guarantee of accuracy or profit; past performance ≠ future results; decisions are yours.
- **Data disclaimers**: NSE-sourced, may be delayed/incorrect; no warranty of accuracy/completeness/timeliness.
- **Accounts**: accurate details, keep credentials confidential, one account per person; suspension for breach.
- **Acceptable use**: no unlawful use, no circumvention/rate-limit abuse, no data resale/redistribution.
- **Intellectual property**: app content owned by operator; data feeds belong to their owners.
- **Availability**: "as is", may be interrupted (maintenance, market hours, provider outages).
- **Limitation of liability**: to the maximum extent permitted by law — no liability for losses including trading losses.
- **Termination**: operator may suspend accounts for breach; users may close accounts anytime.
- **Changes**: updated date at top when changed.
- **Governing law**: laws of India (user decision — see below).
- **Contact**: luckyhegdedev+tradenext@gmail.com.

---

## 12. Test Strategy

### Unit Tests (Jest — render assertions, `@testing-library/react`)

- `app/privacy/__tests__/page.test.tsx`:
  - [ ] Renders `<h1>` "Privacy Policy" + effective date
  - [ ] Renders contact email
  - [ ] Renders a representative section heading (e.g. "Information We Collect")
- `app/terms/__tests__/page.test.tsx`:
  - [ ] Renders `<h1>` "Terms of Service"
  - [ ] Renders "not financial advice" / "tool, not adviser" statement
  - [ ] Renders contact email

### E2E Tests (`e2e/privacy-terms.spec.ts` — public, no auth; runs across browser projects)

- [ ] `/privacy` loads (200, h1 + email visible) — no login required
- [ ] `/terms` loads (200, "not financial advice" visible)
- [ ] `/contact` shows the legal-links strip; clicking "Privacy Policy" navigates to `/privacy`

---

## 13. Performance Considerations

- Static server components — trivial payload; no client JS, no API calls, no DB queries.
- No caching requirements (Next.js handles static rendering).

---

## 14. Security Considerations

- Public pages: no sensitive data, no forms, no inputs.
- No secrets in pages (contact email is public by design).

---

## 15. Definition of Done

- [x] Both pages implemented per §11 content
- [x] Contact-page legal-links strip added and navigable
- [x] Header nav (desktop + mobile) Privacy/Terms links added and navigable
- [x] Sitemap + llms.txt updated (public-page boundary respected)
- [x] Jest render tests written and passing
- [x] e2e spec written (run via `npm run test:e2e` before merge; may be deferred to the PR run)
- [x] `npx tsc --noEmit` — 0 new errors (baseline 46 exact, prod 0)
- [x] `npm run quickbuild` passes
- [x] Responsive at 375px + dark/light verified (dev server)
- [x] Docs updated (changelog `versions-v3.44.md`, Primer, agent-memory, Lessons if a pattern found, session-todos, handoff) — AGENTS.md row subject to 32,768 B per-file budget (see plan §Risks)
- [x] 0 console errors in browser