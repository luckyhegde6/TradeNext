# Implementation Plan — Public Legal Pages (Privacy Policy + Terms of Service)

> Generated from spec: `.agents/specs/02-public-legal-pages.md`
> Save to `.agents/plans/02-public-legal-pages.md`

## Spec Reference

- **Spec**: `.agents/specs/02-public-legal-pages.md`
- **Branch**: `feature/legal-pages` (from `feature/google-sheets-tracking` HEAD `aba7fa6`)
- **Created**: 2026-09-28

---

## Implementation Steps

> Ordered steps. Each step is atomic — can be verified independently.
> Format: `[N] Step description → verify: [check command]`

### Phase 1: Pages

1. **Create `app/privacy/page.tsx`** — static server component, `export const metadata`, hero + effective date, sections per spec §11 (what we collect, use, sharing, retention, rights, security, changes, contact) with `dark:` classes → verify: `npx tsc --noEmit` (0 new)
2. **Create `app/terms/page.tsx`** — same structure; acceptance, NOT-financial-advice ("tool, not adviser"), data disclaimers, accounts, acceptable use, IP, availability, liability, termination, changes, governing law, contact → verify: `npx tsc --noEmit`
3. **Add legal-links strip to `app/contact/page.tsx`** — `<footer class="border-t …">` with `Privacy Policy` + `Terms of Service` links below the FAQ section → verify: page renders + links at 200
4. **Add `Privacy` + `Terms` links to `app/Header.tsx`** — desktop nav (adjacent to the Contact `NavLink`) + mobile menu (`MobileNavLink`); read the existing nav arrays first and match style → verify: links render + navigate at 200 (desktop ≥1280px + mobile hamburger)

### Phase 2: Discovery Files

5. **Update `app/sitemap.ts`** — add `/privacy` + `/terms` entries (priority 0.3, `changeFrequency: "monthly"`, `lastModified: now`) adjacent to `/contact` → verify: `npx tsc --noEmit`
6. **Update `app/llms.txt/route.ts`** — add both pages to the public-pages list → verify: `GET /llms.txt` includes them (dev server)

### Phase 3: Tests

7. **Write `app/privacy/__tests__/page.test.tsx`** — 3 assertions (h1, email, section heading) → verify: `npm run test` passes that file
8. **Write `app/terms/__tests__/page.test.tsx`** — 3 assertions (h1, "not financial advice", email) → verify: `npm run test` passes that file
9. **Write `e2e/privacy-terms.spec.ts`** — 3 public tests (privacy loads, terms loads, contact strip navigates to /privacy) → verify: `npm run test:e2e` (may be deferred to PR run if server/suite constraints; Jest + quickbuild must pass regardless)

### Phase 4: Verification

10. **Typecheck + build** → verify: `npx tsc --noEmit` (46 exact / prod 0) && `npm run quickbuild`
11. **Lint** → verify: `npm run lint` (no errors)
12. **Doc budget gate** → verify: `node scripts/dev-checks/check-doc-sizes.mjs` (≤ 100 KB)
13. **Dev-server UI check** — `/privacy`, `/terms`, `/contact` footer + Header links at 375px + dark/light; 0 console errors → verify: browser check (Playwright MCP or manual), then kill only the dev server you started

### Phase 5: Documentation (mandatory, before commit)

14. **`.agents/changelog/versions-v3.44.md`** — new version detail file (pages, content scope, files, tests) → verify: file exists + index updated in `.agents/CHANGELOG.md`
15. **`Primer.md`** — Current Project Status + Session History → verify: status updated
16. **`agent-memory.md`** — activity entry → verify: appended
17. **`Lessons.md`** — only if a pattern/bug discovered (e.g. static-page budget/baseline notes) → verify: entry if applicable
18. **`@HANDOFF.md` + `.agents/handoffs/active/latest.md` + `.agents/session-todos.md`** → verify: resume context current
19. **AGENTS.md version table** — DEFERRED per user decision (2026-09-28): 32,719/32,768 B per-file budget; detail in changelog/Primer/agent-memory only

### Phase 6: Commit (on explicit user request only)

20. **Commit** — 2 logical commits: `feat(legal): public privacy + terms pages` (pages + files + tests) and `docs: legal-pages wrap-up` (changelog/Primer/memory) → verify: pre-commit hook + `git status` hygiene; NO push/PR/deploy without user

---

## Test Strategy

### Unit Tests (Required)

| Test | File | What It Verifies |
|------|------|------------------|
| Privacy h1 + effective date render | `privacy/__tests__/page.test.tsx` | Page contract |
| Privacy contact email + section heading | `privacy/__tests__/page.test.tsx` | Content completeness |
| Terms h1 renders | `terms/__tests__/page.test.tsx` | Page contract |
| Terms "not financial advice" + email | `terms/__tests__/page.test.tsx` | Core promise |

### E2E Tests (UI change → committed spec)

| Test | What It Verifies |
|------|------------------|
| `/privacy` loads public without login | Public access |
| `/terms` loads public + "not financial advice" | Public access + core promise |
| `/contact` strip: "Privacy Policy" click → `/privacy` | Footer wiring |

---

## Verification Checklist

> Run these commands after implementation. All must pass.

```bash
# Type checking
npx tsc --noEmit                    # 0 new errors (baseline: 46 exact / prod 0)

# Tests
npm run test                        # All pass (new files green)
npm run lint                        # No errors

# Build + budget
npm run quickbuild                  # Production build succeeds
node scripts/dev-checks/check-doc-sizes.mjs   # ≤ 100 KB
```

---

## Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| **AGENTS.md per-file budget** — at 32,719/32,768 B (49 B headroom) | **RESOLVED by user (2026-09-28): defer the v3.44.0 row** — detail in `versions-v3.44.md` + Primer + agent-memory; revisit when budget frees | AGENTS.md row |
| Effective date + governing law | **RESOLVED by user (2026-09-28): NO date line on pages**; governing law = "laws of India" (site targets Indian market data; already published in spec §11 — flag if user prefers otherwise) | — |
| Header nav crowding (12 links already on mobile) | Place `Privacy`/`Terms` compactly adjacent to Contact in both navs; verify 375px hamburger menu still scrolls cleanly | — |
| Legal accuracy (not counsel-reviewed) | Content is minimal, truthful to actual app behavior, clearly "informational, not advice"; note in changelog | Real counsel review |
| e2e run cost (6 projects) | Jest + quickbuild always run; full `test:e2e` may run at PR/merge gate | PR run |
| Branch stacking | `feature/legal-pages` from unmerged `feature/google-sheets-tracking` follows the repo's established stacking pattern (v3.41.3 on v3.41.2) | — |

---

## Documentation Checklist

> All docs must be updated before commit.

- [ ] **AGENTS.md** — version row **DEFERRED** (user decision 2026-09-28; per-file budget) — detail in changelog/Primer/agent-memory
- [ ] **CHANGELOG** — `.agents/changelog/versions-v3.44.md` + index update
- [ ] **TODO.md** — quick-reference row (In-progress block)
- [ ] **Primer.md** — current project status
- [ ] **agent-memory.md** — activity log entry
- [ ] **Lessons.md** — new lesson (if pattern/bug discovered)
- [ ] **Session memory** — `decisions.md` + `flow.md` in `.agents/sessions/`
- [ ] **session-todos.md** — current session updated
- [ ] **handoffs/active/latest.md** — resume context

---

## Pre-Commit Gate

> Must pass before any commit.

1. `npx tsc --noEmit` — 0 new errors
2. `npm run test` — new + existing tests pass
3. `npm run lint` — no errors
4. `git status` — no junk artifacts, no secrets in diff
5. Documentation updated per checklist above
6. Engineering checklist (`.agents/rules/checklist.md`) validated