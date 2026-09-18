# Decisions — 2026-09-18 — v3.40.2 mirror-contract fixes for BUGS 15/16/17

Branch: `fix/mirror-contract-fixes` (from `main` @ `e183a3a` = v3.40.0 merge)
Session dir: `.agents/sessions/2026-09-18-v3402-mirror/`
Spec: `.agents/specs/13-mirror-contract-fixes.md` · Plan: `.agents/plans/13-mirror-contract-fixes.md`

---

## D1. Scope = "15 + 16 + high-impact 17" (user-approved), not all three bugs in full

The v3.40.1 live-site verification produced 3 findings; bug 17 is a *class* (every Prisma-only
admin/user API under the P6003 hold), not a single endpoint.

**Decision**: fix bugs 15 and 16 completely, and for 17 fix only the surfaces a user actually lands
on plus the one that was publicly writable (workers status, dividend calendar). Record the rest as a
tracked follow-up in `BUGS.md` row 17. **Why**: fixing the whole 17 class in one branch mixes ~5
independent endpoint contracts into one review/revert boundary, and several of them are not real
user paths. The user explicitly selected the reduced scope.

## D2. A shared mapper instead of patching each mirror branch

The mirror returns raw SQL rows (`SELECT * FROM corporate_action` → snake_case) while the Prisma path
maps camelCase, so the two branches of one route serve two different contracts (Lesson 129).

**Decision**: NEW `lib/services/corpActionMirror.ts` with a single `mapMirrorCorporateAction()` used
by **both** mirror branches of `/api/corporate-actions/combined` *and* by the new dividend mirror
fallback. **Why**: patching each call site fixes today's bug and allows tomorrow's drift. One shared
mapper makes "the fallback renders the same shape" a property of the code, not of reviewer attention.
The mapper is tolerant + idempotent (already-camelCase rows pass through) so it is safe on SQLite
versions whose column names already match.

## D3. `toDayKey()` (local Y-M-D) instead of `toISOString().split("T")[0]`

`app/markets/calendar/page.tsx` built local-midnight dates (`new Date(y, m, d)`) and then converted
them with `toISOString()`, which reads the **previous** UTC day for IST viewers — a real off-by-one
that put an ex-date dot one square early.

**Decision**: add a module-level `toDayKey(date)` returning local Y-M-D (`""` on invalid) and use it
at the 3 key sites. **Why**: the calendar grid is inherently a local-time construct; a UTC key can
never be correct for it. Verified: `2026-09-22T00:00:00+05:30` → old `2026-09-21`, new `2026-09-22`;
UTC-midnight dates are unchanged.

## D4. Alerts: mirror fallback **and** a client-side array guard (both, not either)

Two independent defects produced the blank `/alerts` page: the API 500'd under the hold, and the
client called `.filter` on the `{error}` body (Lesson 130).

**Decision**: fix both. The API gains a session-scoped mirror fallback (`getMirrorAlerts(userId)`)
wrapped in `isDbUnavailableError` (non-hold errors still re-throw honestly), and the page gains an
`Array.isArray` guard + an error state with Retry. **Why**: either fix alone leaves the other failure
mode live — the API can still 500 for non-hold reasons, and any future caller can still assume an
array. Scoping to `row.userId === userId` is mandatory because the mirror's `getAlerts()` returns
**all users'** rows.

## D5. Workers status: auth on **both** verbs, even though the in-repo heartbeat bypasses the route

The route had no auth check on GET *or* POST, and POST is a write endpoint — publicly writable, even
though the worker engine writes via direct Prisma and no in-repo caller hits the route.

**Decision** (user-approved "add auth to POST too"): require an admin session for GET and POST (401
otherwise). **Why**: the absence of an in-repo caller does not make a public write endpoint safe; a
third party can still POST to it. GET is included because it exposes worker/task internals and
because leaving GET open while locking POST is an incoherent contract.

## D6. Workers status GET falls back to the mirror; POST does not

**Decision**: only GET gets the SQLite fallback (`getWorkerStatuses()` via `mapMirrorWorkerStatus()`
+ `filterWorkers()`); POST stays Prisma-only. **Why**: the mirror is a read-shaped snapshot, and a
write acknowledged only into the mirror would silently diverge from Prisma. Reads degrade, writes
stay honest.

## D7. Fix the client poll too — backoff, not just the endpoint

Live observation: the Workers tab on a fixed 10 s `setInterval` produced 186+ console errors per
visit while both endpoints 500'd — a fixed interval has no memory of failure, so it retries at full
rate forever against an already-refusing database (Lesson 131).

**Decision**: replace `setInterval` with a self-scheduling `tick` (10 s healthy → 20 → 40 → 60 s cap,
reset on success) driven by `fetchData()` returning `Promise<boolean>` (`tasksRes.ok || workersRes.ok`
= "API reachable"), plus a `pollPaused` amber hint at ≥3 failures. **Why**: fixing only the endpoint
still storms any other hard-failing dependency; fixing only the client leaves the outage invisible in
the logs. Both are needed.

## D8. `/api/admin/users` is left unfixed because the mirror **cannot** support it

The mirror has no `user` table at all.

**Decision**: do not build a fake user list and do not special-case it — record it in `BUGS.md`
row 17 as impossible-until-the-mirror-has-a-user-table. **Why**: fabricating a user list to make an
admin page "work" would be dishonest (and a security-shaped footgun). Naming the constraint is the
correct outcome.

## D9. Out-of-scope endpoints are tracked, not silently dropped

`/api/admin/monitoring` (5 types), `/api/admin/workers` list, `/api/admin/cron`, `/api/screener/saved`
are explicitly listed under bug 17's follow-up with their failure mode. **Why**: a partial fix that
does not name the remainder reads as "17 is done" to the next session.

## D10. OpenAPI updated in the same change as the new auth requirement

Making workers/status admin-only is a **breaking API contract change**. `app/api/openapi/route.ts`
gained a `/api/admin/workers/status` GET+POST entry with `security: securityAdmin`. **Why**: the
checklist requires documented routes with the secure marker for admin routes; shipping the auth
change without it would leave the published contract wrong.

## D11. Stop before commit; never auto-commit

**Decision**: complete code + tests + docs, run all gates, then **stop and await explicit user
approval** for commit/push/PR/deploy. **Why**: standing repo rule.
