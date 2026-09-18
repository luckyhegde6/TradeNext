# Spec Document — Predeploy Mirror Preservation Guard

> Spec 14. Branch: `feature/predeploy-mirror-preserve`. Created: 2026-09-19.

## 1. Overview

**What**: A predeploy guard that runs as the **first step of the Netlify production build command** and calls a new token-authenticated admin endpoint on the **currently-live instance** to (a) force the SQLite mirror snapshot to disk + Netlify Blobs, (b) drain the SQLite→Prisma `_sync_outbox` when the plan-limit breaker is closed, or (c) write a versioned, timestamped Blobs backup when Prisma is on hold. It is accompanied by an `npm` script so it can be run locally/manually.

**Why**: Two independent data-loss windows exist today.

1. **Window A — outbox never drained.** The only automatic SQLite→Prisma drain is the probe tick at `PROBE_INTERVAL_MS = 6h` (`lib/sqlite.ts:1949`, called `:2000`), and it is skipped entirely while the plan-limit breaker is open. During the active Prisma **P6003 plan-limit hold (until 2026-10-02)** the `_sync_outbox` therefore accumulates with no drain.
2. **Window B — mirror not uploaded.** Queued rows live in the running container's memory/disk. Mirror durability is a **single** Blobs key (`sqlite-mirror.sqlite`, store `tradenext-sqlite-mirror`) refreshed on a 60s timer, and there is **no SIGTERM/beforeExit shutdown flush** anywhere in the repo. A deploy that recycles the container between uploads loses every write since the last successful upload — permanently.

A deploy is the highest-risk moment for Window B. This spec closes both windows at that moment.

**Scope**

- **IN**: a new admin route (`GET` status / `POST` preserve) with dual auth (deploy-guard token **or** admin session); a new `lib/services/mirrorBackup.ts` module for versioned Blobs backups with retention pruning; a Node-only predeploy script; wiring the script as the first step of the Netlify production build command; adding `"deploy"` to `SyncTrigger`; OpenAPI documentation; unit + route tests; docs + wiki updates.
- **OUT**: any Prisma schema change or migration (none required); any UI page (the guard is build/CLI + API only); a standalone GitHub Action (rejected — see §9); changing Netlify deploy topology or disabling auto-publish; adding a SIGTERM shutdown hook (**deferred**, listed in §13 — this spec preserves at deploy time instead); a hard-blocking (strict) failure mode (soft/warn is the agreed contract).

**Depends on**: spec `13-mirror-contract-fixes` (merged, PR #129) for the mirror fallback patterns; spec `12-sqlite-durable-mirror` + v3.40.1 for the Blobs store resolution and negative-TTL fix this reuses.

---

## 2. Routes

### New Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/admin/predeploy/preserve` | deploy-guard token **or** admin session | Snapshot → backup → attempt push; returns the mode used |
| `GET` | `/api/admin/predeploy/preserve` | deploy-guard token **or** admin session | Read-only status: pending outbox, breaker state, existing backups |

Both run on `runtime = "nodejs"`, `dynamic = "force-dynamic"`.

### Modified Routes

| Method | Path | Change |
|--------|------|--------|
| — | — | None. This spec does not modify any existing route. |

---

## 3. Database Schema

**N/A — no Prisma schema change.** Justification: the guard reuses existing read paths only — `getOutboxPending()` (`lib/sqlite.ts:4176`), `hasSyncHistoryTable()` (`:4164`), the existing `sync_history` recorder (`:3964`), and the existing idempotent sinks in `lib/sqlitePushSinks.ts`. No new model, no new column, no migration. `npx prisma generate` is not required.

---

## 4. Functions to Implement

### A. `lib/services/mirrorBackup.ts` (NEW)

Owns versioned backups in the **existing** mirror Blobs store (prefix `backups/`), so no new store provisioning is needed and `getMirrorBlobsStore()` (with its negative-TTL fix) is reused.

#### `mirrorBackupKey(at?: Date): string`

- Returns `backups/sqlite-mirror-<stamp>.sqlite` where `<stamp>` is the UTC instant as `YYYY-MM-DDTHH-MM-SS-mmmZ` (colons/dots replaced with `-` so the key is URL-safe and **lexicographically sortable = chronologically sortable**).
- Pure, deterministic, no I/O — unit-testable without Blobs.

#### `createMirrorBackup(bytes: Uint8Array | null, opts?: { keep?: number; now?: Date }): Promise<{ key: string; bytes: number; pruned: string[] } | null>`

- Returns `null` (never throws) when `bytes` is null/empty or exceeds the 200 MB cap, or when the Blobs store is unavailable.
- Uploads `bytes` to `mirrorBackupKey(opts.now)`, then calls `pruneMirrorBackups(opts.keep ?? MIRROR_BACKUP_KEEP)`.
- Returns the new key, its byte length, and the keys pruned.

#### `listMirrorBackups(): Promise<MirrorBackupEntry[]>`

- `store.list({ prefix: MIRROR_BACKUP_PREFIX })`, mapped to `{ key, at }` where `at` is the ISO instant parsed back out of the key (reversing `mirrorBackupKey`).
- **Sorted oldest-first** (lexicographic on the key). Returns `[]` on any failure.
- Note: `@netlify/blobs` `ListResultBlob` exposes only `{ etag, key }` — there is **no size**, so no per-blob `get` is performed (keeps the guard to 1 list + N deletes).

#### `pruneMirrorBackups(keep?: number): Promise<string[]>`

- Lists, then deletes every backup older than the newest `keep` (default `MIRROR_BACKUP_KEEP = 5`).
- Returns the deleted keys. Never throws; a failed delete is logged and skipped.

Constants: `MIRROR_BACKUP_PREFIX = "backups/"`, `MIRROR_BACKUP_KEEP = 5`, `MIRROR_BACKUP_MAX_BYTES = 200 * 1024 * 1024`.

### B. `lib/sqlite.ts` (MODIFIED — surgical)

- `:129` — widen `export type SyncTrigger = "boot" | "probe" | "admin" | "deploy";`. No consumer switches exhaustively on this union (verified — all sites are optional params or pass-through), so this is additive. The value is stored in `sync_history.trigger` as text.
- `:930` — change `async function getMirrorBlobsStore()` → `export async function getMirrorBlobsStore()` so `mirrorBackup.ts` reuses the memoized store + negative-TTL behaviour instead of duplicating it.
- `:905` — widen the `MirrorBlobsStoreLike` interface with the two members the backup module needs:
  - `list?(options: { prefix?: string }): Promise<{ blobs: { key: string; etag: string }[] }>`
  - `delete?(key: string): Promise<void>`
  - Both declared optional so the narrowed test doubles used elsewhere keep compiling.

### C. `app/api/admin/predeploy/preserve/route.ts` (NEW)

- `isGuardAuthorized(req: Request): Promise<boolean>` — returns `true` when the `x-deploy-guard-token` header matches `process.env.DEPLOY_GUARD_TOKEN` (length-checked + `crypto.timingSafeEqual`), otherwise falls back to the standard admin session check (`auth()` + `session.user.role === "admin"`, mirroring `app/api/admin/workers/status/route.ts:53-56`).
- When `DEPLOY_GUARD_TOKEN` is **unset**, token auth is unavailable and the route returns **503** `{ error: "guard_token_not_configured" }` for token-only callers (the script then warns and skips) — it never silently degrades to open access.
- `POST` executes, **in this exact order** (snapshot-before-push is deliberate: a crash mid-push still leaves a complete backup):
  1. `getOutboxPending()` → `pendingBefore` (shape `Record<string, { pending: number; lastAt?: string }>`).
  2. `persistMirrorSnapshot()` → disk; `exportSqliteBackup()` → bytes; `uploadMirrorSnapshotToBlobs(bytes)` → canonical key.
  3. `createMirrorBackup(bytes)` → versioned key.
  4. If `!isPlanLimitBreakerOpen()` → `pushSqliteToPrisma({ reason: "deploy", leaderGate: false })` (mirrors the existing admin `push_to_prisma` action at `app/api/admin/db-health/route.ts:471-506`); the readiness + breaker guards inside `pushSqliteToPrisma` remain authoritative.
  5. `createAuditLog({ action: "ADMIN_DB_SYNC", resource: "predeploy-preserve", ... })`.
- `GET` returns the read-only status; performs no writes.
- Computes `mode`: `"pushed"` when a push ran, `"backed_up"` when the breaker was open, `"skipped"` when SQLite was not ready.

### D. `scripts/predeploy/preserve-mirror.mjs` (NEW)

- Pure Node 20 — global `fetch` + `AbortSignal.timeout`, **zero new dependencies**.
- Context gate: exits `0` immediately with a skip message unless `process.env.CONTEXT === "production"`, unless `--force` is passed (local/manual runs).
- Token check: if `DEPLOY_GUARD_TOKEN` is unset → warn + exit `0` (build must never break because a secret is not yet configured).
- Target URL: `DEPLOY_PRIME_URL` → `URL` → `NEXT_PUBLIC_BASE_URL` → `https://tradenext6.netlify.app`.
- `POST`s to `${url}/api/admin/predeploy/preserve` with the `x-deploy-guard-token` header, 20s timeout.
- Prints exactly one summary line (mode, pending, synced/failed, backup key) and **never logs the token**.
- **Soft by contract**: always `process.exit(0)`; failures print a loud `⚠️` warning. This is the agreed failure mode (see §9) so a guard problem can never wedge a deploy.

### E. Wiring (MODIFIED)

- `package.json` — add `"predeploy:preserve": "node scripts/predeploy/preserve-mirror.mjs"`.
- `netlify.toml` — `[build] command` becomes
  `node scripts/predeploy/preserve-mirror.mjs && npx prisma generate && npm run quickbuild`
  (the script self-gates on `CONTEXT`, so previews/branch deploys run nothing).
- `.env.example` — add `DEPLOY_GUARD_TOKEN=` with a comment (placeholder only, never a real value).

---

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/services/mirrorBackup.ts` | **Created** | Versioned Blobs backups + pruning |
| `app/api/admin/predeploy/preserve/route.ts` | **Created** | Guard endpoint (GET status / POST preserve) |
| `scripts/predeploy/preserve-mirror.mjs` | **Created** | The predeploy script |
| `lib/sqlite.ts` | Modified | Export `getMirrorBlobsStore`; widen `MirrorBlobsStoreLike`; add `"deploy"` to `SyncTrigger` |
| `package.json` | Modified | `predeploy:preserve` script |
| `netlify.toml` | Modified | Guard as first `[build] command` step |
| `.env.example` | Modified | `DEPLOY_GUARD_TOKEN` placeholder |
| `app/api/openapi/route.ts` | Modified | Document the new route (secure) |
| `lib/__tests__/mirrorBackup.test.ts` | **Created** | Backup key/prune/retention tests |
| `lib/__tests__/predeployPreserveRoute.test.ts` | **Created** | Route auth + mode selection tests |

---

## 6. Dependencies

### New Packages

| Package | Version | Reason |
|---------|---------|--------|
| None | — | `@netlify/blobs` `^11.0.3` is already a dependency; the script uses Node built-ins only |

### Internal Dependencies

| Module | Function Used | Purpose |
|--------|---------------|---------|
| `@/lib/sqlite` | `getMirrorBlobsStore`, `persistMirrorSnapshot`, `exportSqliteBackup`, `uploadMirrorSnapshotToBlobs`, `pushSqliteToPrisma`, `getOutboxPending` | Snapshot, backup, push, status |
| `@/lib/db-utils` | `isPlanLimitBreakerOpen` | Decide push vs backup |
| `@/lib/auth` | `auth` | Admin-session fallback auth |
| `@/lib/audit` | `createAuditLog` (action `ADMIN_DB_SYNC`) | Audit trail (reuses the existing action tag) |
| `@/lib/logger` | `logger.info/warn/error` | Structured logging |
| `@/lib/netlify` | `isNetlifyRuntime` | Guard early-exit when not on a Netlify runtime |

---

## 7. API Contract

### POST /api/admin/predeploy/preserve

**Headers**: `x-deploy-guard-token: <DEPLOY_GUARD_TOKEN>` (or an admin session cookie).
**Body**: none required.

**Response (200 — pushed):**
```json
{
  "success": true,
  "mode": "pushed",
  "pendingBefore": { "nse_mirror_rows": { "pending": 412, "lastAt": "2026-09-19T04:11:02.001Z" } },
  "snapshotBytes": 184320,
  "backupKey": "backups/sqlite-mirror-2026-09-19T06-30-00-000Z.sqlite",
  "pruned": [],
  "pushed": true,
  "synced": 412,
  "failed": 0,
  "breakerOpen": false,
  "message": "Pushed 412 rows to Prisma (0 failed)"
}
```

**Response (200 — holder, Prisma on hold):**
```json
{
  "success": true,
  "mode": "backed_up",
  "pendingBefore": { "nse_mirror_rows": { "pending": 412 } },
  "snapshotBytes": 184320,
  "backupKey": "backups/sqlite-mirror-2026-09-19T06-30-00-000Z.sqlite",
  "pruned": ["backups/sqlite-mirror-2026-09-11T02-00-00-000Z.sqlite"],
  "pushed": false,
  "breakerOpen": true,
  "message": "Prisma plan-limit breaker open — mirror preserved as a versioned backup (412 rows pending)"
}
```

**Response (401)**: `{ "error": "Unauthorized" }` — no valid token and no admin session.
**Response (503)**: `{ "error": "guard_token_not_configured" }` — `DEPLOY_GUARD_TOKEN` unset and the caller supplied no admin session.

### GET /api/admin/predeploy/preserve

**Response (200):**
```json
{
  "success": true,
  "breakerOpen": false,
  "sqliteReady": true,
  "pending": { "nse_mirror_rows": { "pending": 412, "lastAt": "2026-09-19T04:11:02.001Z" } },
  "backups": [
    { "key": "backups/sqlite-mirror-2026-09-19T06-30-00-000Z.sqlite", "at": "2026-09-19T06:30:00.000Z" }
  ],
  "keep": 5
}
```

---

## 8. UI/UX Requirements

**N/A — no UI.** Justification: the guard executes inside the Netlify build and via the CLI; its output is a build-log line and a JSON API response. No page, component, route, or state renders to a user, so loading/empty/error states, responsive breakpoints, and dark mode do not apply. The existing admin DB-health page already surfaces outbox/breaker state and is unchanged by this spec.

---

## 9. Rules & Guardrails

- [ ] `runtime = "nodejs"` on the new route (Prisma + crypto + `node:fs` below it).
- [ ] No Prisma in client components (no UI added).
- [ ] No new dependency; `@netlify/blobs` reused via the existing memoized resolver.
- [ ] Never log, echo, or return `DEPLOY_GUARD_TOKEN`.
- [ ] Token comparison is length-checked + `timingSafeEqual` (no early-exit string compare).
- [ ] Guard is **soft-fail** by agreement: a preservation failure warns loudly and exits `0`; it must never block a deploy or a build.
- [ ] Guard is **production-only** (`CONTEXT === "production"`) so deploy previews/branch deploys never touch production data.
- [ ] Versioned backups are pruned to the newest 5 — bounded storage, no unbounded growth.
- [ ] The push reuses `pushSqliteToPrisma()` so the readiness + breaker guards inside it remain authoritative; `leaderGate: false` only bypasses the leader lock (same as the existing admin button).
- [ ] Sinks are idempotent — re-running the guard is safe.
- [ ] `createAuditLog` for the state-changing POST; the GET is read-only and unaudited.
- [ ] Guard skips cleanly (warn + exit 0) when `DEPLOY_GUARD_TOKEN` is not yet configured.

**Rejected alternative (recorded)**: a standalone GitHub Action on `push: main`. Netlify's Git integration builds and publishes the instant the merge lands, so a concurrent Action cannot be guaranteed to run *before* the deploy; the only ordering-guaranteed, topology-preserving placement is inside Netlify's own build command.

---

## 10. Expected Behavior

1. `mirrorBackupKey(new Date("2026-09-19T06:30:00.000Z"))` returns `backups/sqlite-mirror-2026-09-19T06-30-00-000Z.sqlite`.
2. `mirrorBackupKey` output for two increasing instants sorts ascending lexicographically (oldest → newest).
3. `createMirrorBackup(null)` returns `null` and performs no upload.
4. `createMirrorBackup(bytes)` uploads exactly one key, returns its byte length, and returns `pruned` containing any key removed beyond `keep`.
5. With 6 existing backups and `keep = 5`, `pruneMirrorBackups(5)` deletes exactly the **oldest** 1 and keeps the newest 5.
6. `listMirrorBackups()` returns entries oldest-first with a parsed `at` — and returns `[]` (no throw) when Blobs is unavailable.
7. `POST /api/admin/predeploy/preserve` with a valid token and the breaker closed → 200, `mode: "pushed"`, `pushed: true`, `synced` = drained count.
8. `POST` with a valid token and the breaker **open** → 200, `mode: "backed_up"`, `pushed: false`, `breakerOpen: true`, and a non-null `backupKey`.
9. `POST` with an invalid/absent token and no admin session → 401; no snapshot, backup, or push occurs.
10. `POST` with the token unset in the environment and no admin session → 503 `guard_token_not_configured`.
11. `GET` returns pending + backup list + breaker state and performs **no** writes or pushes.
12. The script with `CONTEXT` unset (and no `--force`) exits `0` without any network call.
13. The script with `DEPLOY_GUARD_TOKEN` unset exits `0` with a warning and no network call.
14. The script with `CONTEXT=production` and a valid token prints one summary line and exits `0` **even when the endpoint returns 500 or times out**.
15. A failed `persistMirrorSnapshot()` / unavailable Blobs does not throw out of the route — the response degrades to `snapshotBytes: null` + a warning, and the push is still attempted.

---

## 11. Error Handling

| Scenario | Behavior | Log Level |
|----------|----------|-----------|
| `DEPLOY_GUARD_TOKEN` unset | Route → 503 for token-only callers; script warns + exits 0 (no call) | `warn` |
| Invalid/absent token, no admin session | 401, no side effects | `warn` |
| Netlify Blobs unavailable | `createMirrorBackup` → `null`; `listMirrorBackups` → `[]`; response reports no `backupKey`; **push still attempted** | `warn` |
| SQLite not ready | `mode: "skipped"`, `pushed: false`; 200 (not an error) | `warn` |
| Plan-limit breaker open | `mode: "backed_up"`; versioned backup is the outcome, not a failure | `info` |
| `pushSqliteToPrisma` throws | Caught → 500 with `detail`; the snapshot + backup already exist | `error` |
| Snapshot export exceeds the 200 MB cap | Skip upload/backup, report `snapshotBytes: null` | `warn` |
| Script: endpoint 5xx / timeout / network error | Loud `⚠️` warning in the build log, `exit 0` | (build log) |
| Prune delete fails for one key | Logged + skipped; other deletions proceed | `warn` |

---

## 12. Test Strategy

### Unit Tests — `lib/__tests__/mirrorBackup.test.ts`

- [ ] `mirrorBackupKey()` formats the instant in the URL-safe, sortable form
- [ ] `mirrorBackupKey()` is lexicographically ordered across increasing instants
- [ ] `createMirrorBackup(null)` → `null`, no `set` call
- [ ] `createMirrorBackup(bytes)` → uploads one key, returns byte length
- [ ] `createMirrorBackup` with `keep = 5` and 6 existing → returns the oldest 1 in `pruned`
- [ ] `createMirrorBackup` when Blobs is unavailable → `null` (no throw)
- [ ] `pruneMirrorBackups(5)` keeps the newest 5, deletes the rest
- [ ] `pruneMirrorBackups()` with ≤ `keep` entries → deletes nothing
- [ ] `listMirrorBackups()` → oldest-first with parsed `at`
- [ ] `listMirrorBackups()` when Blobs is unavailable → `[]`
- [ ] A failing `delete` does not reject `pruneMirrorBackups`

### Route Tests — `lib/__tests__/predeployPreserveRoute.test.ts`

- [ ] `POST` valid token + breaker closed → 200 `mode: "pushed"`
- [ ] `POST` valid token + breaker open → 200 `mode: "backed_up"` + `backupKey`
- [ ] `POST` SQLite not ready → 200 `mode: "skipped"`
- [ ] `POST` invalid token, no session → 401, and `pushSqliteToPrisma` / `createMirrorBackup` are **not** called
- [ ] `POST` token unset + no session → 503 `guard_token_not_configured`
- [ ] `POST` valid admin session (no token) → 200
- [ ] `POST` ordering: backup is created **before** the push is attempted
- [ ] `POST` a throwing `pushSqliteToPrisma` → 500, snapshot/backup already attempted
- [ ] `GET` returns `pending` + `backups` + `breakerOpen` and never calls the push

### Integration / E2E Tests

- [ ] N/A — no UI change, so no Playwright spec is added. The script is exercised by its route tests plus one manual local run (`npm run predeploy:preserve -- --force`).

---

## 13. Performance Considerations

- **Cost when healthy**: 1 `list` + 1 `set` + 1 `get`-equivalent (in-memory export) + up to `keep` deletes on the backup path — all against Netlify Blobs, **zero additional Prisma ops**. The push reuses the existing bounded, idempotent sinks (`createMany` per table).
- **Upload dedup**: the canonical snapshot upload still goes through `uploadMirrorSnapshotToBlobs`, which skips when the digest is unchanged; the versioned backup is intentionally unconditional (a point-in-time artifact).
- **Build-time budget**: the build step adds one HTTPS round-trip with a hard 20s cap; it self-skips on non-production contexts.
- **Retention**: bounded to 5 objects, each ≤ 200 MB (cap enforced before upload).
- **Deferred**: a SIGTERM/`beforeExit` shutdown flush would narrow Window B between deploys too. Not in scope here — this spec preserves at deploy time; the shutdown hook is a follow-up if the 60s gap proves material.

---

## 14. Security Considerations

- **Auth**: dual — `x-deploy-guard-token` (compared with `crypto.timingSafeEqual` after a length check) **or** an admin session (`auth()` + `role === "admin"`). No unauthenticated path; an unset token yields 503, never open access.
- **Secret handling**: `DEPLOY_GUARD_TOKEN` is server-only. It MUST NOT appear in `NEXT_PUBLIC_*`, in any log line, in the API response, or in an error `detail`. The script reads it from the environment and never echoes it.
- **Least privilege**: the endpoint performs no Prisma writes of its own — it only drains an existing, already-authorized outbox through the existing guarded path.
- **Blast radius**: the guard cannot delete Prisma data and cannot drop the mirror; worst case it uploads a redundant snapshot/backup.
- **Preview safety**: gated to `CONTEXT === "production"`, so a preview build can never mutate production state.
- **Netlify secrets scanning**: `.env.example` receives only an empty placeholder; no real token is committed.
- **Production config change (approved by the operator)**: `DEPLOY_GUARD_TOKEN` is added to Netlify env with `builds` + `runtime` scope. Build scope is required for the build step to authenticate; runtime scope is required for the endpoint to verify.

---

## 15. Definition of Done

- [ ] `lib/services/mirrorBackup.ts` implemented per §4A
- [ ] `app/api/admin/predeploy/preserve/route.ts` implemented per §4C + contract in §7
- [ ] `scripts/predeploy/preserve-mirror.mjs` implemented per §4D
- [ ] `lib/sqlite.ts` changes per §4B (`getMirrorBlobsStore` exported, `MirrorBlobsStoreLike` widened, `SyncTrigger` gains `"deploy"`)
- [ ] `package.json` `predeploy:preserve` script added
- [ ] `netlify.toml` build command runs the guard first
- [ ] `.env.example` documents `DEPLOY_GUARD_TOKEN`
- [ ] Netlify env var `DEPLOY_GUARD_TOKEN` set (builds + runtime scope)
- [ ] OpenAPI documents the new route, marked secure
- [ ] Unit tests written and passing (`npm run test`)
- [ ] `node scripts/dev-checks/check-tsc-baseline.mjs` → still `46/46`, prod `0`
- [ ] `npm run lint` → 0 errors
- [ ] `node scripts/dev-checks/check-doc-sizes.mjs` → within budget
- [ ] No Prisma schema change / no migration (confirmed)
- [ ] Error handling per §11 (safe defaults, never throws internals, soft-fail script)
- [ ] Manual verification: `POST` returns `mode: "backed_up"` while P6003 is active, and a versioned key lands in Blobs
- [ ] Documentation updated (AGENTS.md, CHANGELOG, TODO, Primer, agent-memory, Lessons)
- [ ] Session memory created (`decisions.md` + `flow.md`)
- [ ] Wiki page published for the mirror-preservation flow
