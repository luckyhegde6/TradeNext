# Decisions — 2026-09-19 — v3.40.3 predeploy mirror-preservation guard (Spec 14)

Branch: `feature/predeploy-mirror-preserve` (from `main` @ `27c0770` = v3.40.2 MERGED via PR #129 `38ee7da`)
Session dir: `.agents/sessions/2026-09-19-predeploy-guard/`
Spec: `.agents/specs/14-predeploy-mirror-preserve.md` · Plan: `.agents/plans/14-predeploy-mirror-preserve.md`

---

## D1. The preservation step runs as a Netlify BUILD-time guard that calls the LIVE app

A deploy replaces the running instance; only the build step (which runs before the new code serves
traffic) can reach the OLD live instance's SQLite mirror and outbox. Options were (a) a runtime-only
"restore from Blobs" path — already exists but cannot recover rows that were never persisted to
Blobs, and (b) a manual admin-triggered backup — depends on a human remembering before every deploy.

**Decision**: `netlify.toml` build command becomes `node scripts/predeploy/preserve-mirror.mjs &&
npx prisma generate && npm run quickbuild`. The script issues `POST /api/admin/predeploy/preserve`
against the live production URL (chain `DEPLOY_PRIME_URL` → `URL` → `NEXT_PUBLIC_BASE_URL` →
`https://tradenext6.netlify.app`) to snapshot + backup + drain before the new build starts. **Why**:
the trigger is the deploy itself — zero human steps, zero chance of a cold-start-empty mirror (the
v3.40.1 class of failure).

## D2. Soft-fail: the guard ALWAYS exits 0 — the deploy is never blocked by preservation

`npm run quickbuild` is the real gate; the preservation step is an optimization over it.

**Decision**: any error path (skip path, timeout, network, 4xx/5xx, script throw) → structured warn
log + **exit 0**. Self-gating: run only when `CONTEXT === "production"` (or `--force`), otherwise
warn + exit 0. **Why**: a broken deploy is worse than a best-effort backup; the guard must be
invisible on non-production builds and never holds a production deploy hostage.

## D3. Mutation order is explicit and the push is breaker-gated

Preserving the mirror has a write (SQLite→Prisma drain) that the P6003 plan-limit hold forbids.

**Decision**: the route runs `getOutboxPending()` → snapshot (`persistMirrorSnapshot()` +
`exportSqliteBackup()` + `uploadMirrorSnapshotToBlobs()`) → `createMirrorBackup(bytes)` →
**only if `!isPlanLimitBreakerOpen()`** `pushSqliteToPrisma({reason:"deploy", leaderGate:false})` →
`createAuditLog({action:"ADMIN_DB_SYNC", resource:"predeploy-preserve"})`. Modes
`"pushed" | "backed_up" | "skipped"`: on the hold the breaker is OPEN ⇒ deliberately `backed_up`
(backup written, no push — the outbox rows stay pending for the next 6h engine or post-hold deploy).
Push throw → 500 `{success:false, error:"push_failed", detail, mode:"skipped", snapshotBytes,
backupKey, pendingBefore}` so the caller can see exactly what did/didn't land. **Why**: the ordering
makes every mode observable and the fallback explicit, not accidental.

## D4. Dedicated deploy token + admin-session fallback; the token is NEVER logged

A build-time unauthenticated call would open an admin-shaped endpoint to anyone who can POST to the
app URL.

**Decision**: `x-deploy-guard-token` header compared against `DEPLOY_GUARD_TOKEN` with
`crypto.timingSafeEqual` AFTER a length check (64-hex); 503 `guard_token_not_configured` when the env
is unset but a token is presented; fallback to the NextAuth admin session (`authorize(req)`). The
build script accepts the token from its own (never-logged) env (`DEPLOY_GUARD_TOKEN`) and emits ONE
summary line (`mode=… pending=… pushed=… backup=… pruned=…`). **Why**: the token is a deploy secret,
not a user credential — constant-time compare + no logging + length check (avoid `timingSafeEqual`
throw on unequal lengths) are the minimum safe contract.

## D5. Versioned backups with retention; Blobs capabilities are optional

Repeated deploys must not pile up unbounded backup blobs, and the Blobs store API differs by
environment.

**Decision**: keys `backups/sqlite-mirror-<YYYY-MM-DDTHH-MM-SS-mmmZ>.sqlite`,
`MIRROR_BACKUP_KEEP = 5`, `MIRROR_BACKUP_MAX_BYTES = 200 MiB`; `createMirrorBackup(bytes)` returns
`key | null` fail-open; `listMirrorBackups()`/`pruneMirrorBackups()` treat a missing/unsupported
`list`/`delete` as "nothing to do" (error-tolerant). **Why**: a restore point must survive multiple
deploys, but a Blobs API drift must never break the guard.

## D6. Legacy finding — record only, do not modify

`.github/workflows/deploy.yml` publishes `./out` via `nwtgck/actions-netlify@v3.0` — a legacy GitHub
Action path that is NOT how the site actually deploys (netlify.toml → quickbuild → `.next`).

**Decision**: record the finding in §v3.40.3 + CHANGELOG + Primer/handoff; **do not touch**
`deploy.yml` in this branch. **Why**: surgical-change rule — it is unrelated dead config and any
change to deploy wiring belongs in a separate reviewed change.

## D7. Correct stale doc state — v3.40.1/v3.40.2 are MERGED

Several docs still described v3.40.1/v3.40.2 as "IN PROGRESS" / "PENDING USER" / "PR #129 open".

**Decision**: amend every row to the verified git state — v3.40.1 MERGED via PR #128 (`15fa0a3`),
v3.40.2 MERGED via PR #129 (`38ee7da`), `main` tip `27c0770`. **Why**: anti-hallucination — a
handoff that claims an open PR that is actually merged misdirects the next session.

## D8. v3.40.2 archive flow.md is a point-in-time record — leave as-is

The only possibly-stale line (`Commit / push / PR / deploy — pending explicit user approval`) is the
generic standing rule, not a claim about PR #129.

**Decision**: no edit to `.agents/sessions/2026-09-18-v3402-mirror/flow.md`. **Why**: session
archives document what was true during that session; the v3.40.2 merge state is captured in the
current changelog/handoff layer instead.