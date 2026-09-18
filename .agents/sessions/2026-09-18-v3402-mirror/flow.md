# Flow — 2026-09-18 — v3.40.2 mirror-contract fixes for BUGS 15/16/17

Branch: `fix/mirror-contract-fixes` (from `main` @ `e183a3a`)
Session dir: `.agents/sessions/2026-09-18-v3402-mirror/`

---

## Execution path

1. **Input**: the v3.40.1 live-site verification report (3 bugs, code-verified against source) +
   user directive choosing scope "**15 + 16 + high-impact 17**" and "**add auth to POST too**".
2. **Recon** — confirmed each root cause at source before changing anything:
   - bug 16: `lib/sqlite.ts getCorporateActions()` (`SELECT * FROM corporate_action`) returns raw
     snake_case; `app/api/corporate-actions/combined/route.ts` mirror branches (`:292` `sqlite_mirror`,
     `:445` `sqlite_backup`) return those rows verbatim while the Prisma path maps camelCase
     (`:353-363`) → `app/markets/calendar/page.tsx` `if (!action.exDate) return false` drops everything.
   - bug 15: `app/api/alerts/route.ts` is Prisma-only → 500 `{error}` under the P6003 hold;
     `app/alerts/page.tsx:112` calls `data.filter(...)` on it → Error Boundary.
   - bug 17: `/api/admin/workers/status` has no auth check on GET or POST and no fallback;
     `app/admin/utils/workers/page.tsx` polls every 10 s with `setInterval`;
     `lib/services/dividendCalendarService.ts` has no mirror path.
3. **Spec + plan** written to `.agents/specs/13-mirror-contract-fixes.md` +
   `.agents/plans/13-mirror-contract-fixes.md`; scope approved.
4. **Branch** `fix/mirror-contract-fixes` created from `main`.
5. **Bug 16** — NEW `lib/services/corpActionMirror.ts`; mapper applied to both mirror branches;
   `toDayKey()` added at the 3 calendar key sites.
6. **Bug 15** — `getMirrorAlerts(userId)` added (session-scoped, boolean coercion) and wired into the
   list branch + `action=count` behind `isDbUnavailableError`; page guard + `fetchError` + Retry.
7. **Bug 17-high** — `mapMirrorWorkerStatus()` + `filterWorkers()` + GET/POST admin auth in the route;
   self-scheduling backoff + `pollPaused` hint in the page; `fetchMirrorDividends()` in the service.
8. **OpenAPI** — `/api/admin/workers/status` GET+POST documented with `securityAdmin`.
9. **Tests** — 4 NEW suites (26 tests), then the full gate set.

## Files created this session

| Path | Purpose |
|------|---------|
| `lib/services/corpActionMirror.ts` | shared mirror→camelCase mapper (+ `MirrorCorporateAction`) |
| `lib/__tests__/corpActionMirror.test.ts` | 5 mapper-contract tests |
| `lib/__tests__/dividendCalendarMirror.test.ts` | 5 dividend mirror-fallback tests |
| `lib/__tests__/alertsMirrorFallback.test.ts` | 6 alerts route fallback tests |
| `lib/__tests__/workersStatusRoute.test.ts` | 10 workers/status auth + fallback tests |
| `.agents/specs/13-mirror-contract-fixes.md` | spec |
| `.agents/plans/13-mirror-contract-fixes.md` | plan |
| `.agents/sessions/2026-09-18-v3402-mirror/decisions.md` | D1–D11 |
| `.agents/sessions/2026-09-18-v3402-mirror/flow.md` | this file |

## Files modified this session

| Path | Change |
|------|--------|
| `app/api/corporate-actions/combined/route.ts` | mapper at both mirror branches |
| `app/markets/calendar/page.tsx` | `toDayKey()` at 3 key sites |
| `app/api/alerts/route.ts` | `getMirrorAlerts(userId)` + fallback on list + `action=count` |
| `app/alerts/page.tsx` | `Array.isArray` guard, `fetchError`, error state + Retry |
| `app/api/admin/workers/status/route.ts` | GET+POST admin auth, `mapMirrorWorkerStatus`, `filterWorkers`, mirror fallback |
| `app/admin/utils/workers/page.tsx` | poll backoff 10→20→40→60 s, `pollPaused` hint, `useRef` |
| `lib/services/dividendCalendarService.ts` | `fetchMirrorDividends()` fallback |
| `app/api/openapi/route.ts` | `/api/admin/workers/status` GET+POST entry (`securityAdmin`) |
| `BUGS.md` | rows 15/16 → Fixed, 17 → Partial + follow-up list |
| `Lessons.md` | 129, 130, 131 + Update Log |
| `.agents/changelog/versions-v3.40.md` | NEW §v3.40.2 |
| `.agents/changelog/versions-index.md` | v3.40.2 row |
| `Primer.md` | Last Updated + Current Project Status section |
| `agent-memory.md` | new top activity entry |
| `.agents/session-todos.md` | Current block → mirror-contract fixes; old block demoted |
| `.agents/handoffs/active/latest.md` | rewritten for this workstream |

## Verification performed

| Check | Command | Result |
|-------|---------|--------|
| unit/component | `npm run test` (run **alone**) | **97/97 suites, 1309 passed / 4 skipped / 0 failed** |
| tsc baseline | `node scripts/dev-checks/check-tsc-baseline.mjs` | **total 46 / prod 0, delta +0 → OK** (exit 0) |
| context budget | `node scripts/dev-checks/check-doc-sizes.mjs --json` | **ok — 76,669 / 102,400 B** |
| lint | `npm run lint` | **0 errors** (1,139 pre-existing warnings) |
| live `/alerts` | Playwright MCP, signed in | tabs + "No alerts configured", **0 console errors** |
| live `/markets/calendar` | `curl` SSR | **200** in 1.97 s |
| live `/admin/utils/workers` | `curl` SSR | **200** |
| day-key semantics | direct evaluation | `2026-09-22T00:00:00+05:30` → old `2026-09-21`, new `2026-09-22` |

Note: the jest run prints `FAIL: TypeScript regression (+1 total, +1 prod).` and
`FAIL: injected context over budget.` — these are the guard suites' **negative-path** output via the
`TSC_BASELINE_CMD` test seam, not real failures; running both guard scripts directly exits 0.

## Not done (deliberately deferred)

- Fixes for `/api/admin/monitoring` (5 types), `/api/admin/workers` list, `/api/admin/cron`,
  `/api/screener/saved` — tracked in `BUGS.md` row 17.
- `/api/admin/users` — **impossible** until the mirror has a `user` table.
- Commit / push / PR / deploy — **pending explicit user approval** (standing rule).
