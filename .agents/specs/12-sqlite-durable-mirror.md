# Spec 12 — SQLite Durable Mirror (v3.39.x)

> **Status:** Approved 2026-09-15 — implementation started. Human approval included the scope addition of `@netlify/blobs` upload (cold-start durability).
> **Branch:** `feat/sqlite-durable-mirror`, created from the current HEAD of `fix/sqlite-upsert-worker-undefined-bind` (NOT local `main`) — the base branch carries the unreleased v3.39.x fixes this feature relies on (`2182687` toIsoVal fix, `f470e6d` set_ops_counter queryConsumption response, PR #123 `@netlify/blobs` re-add `e84fb34`, PRs #124/#125).
> **Problem:** Prisma plan-limit hold is active until **2026-10-02** (user-stated). The SQLite mirror (`lib/sqlite.ts`, in-memory sql.js DB) is rebuilt FRESH from `SCHEMA_SQL` on every boot, and the boot `syncFromPrisma()` is breaker-gated — so ANY restart during the hold wipes the mirror and the app's hot routes (recommendations / screener / corp-actions / swing) lose their SQLite-served data until Prisma returns.

---

## 1. Overview & Goals

### What

Persist the entire in-memory sql.js mirror to disk as a single SQLite snapshot file, restore it at boot, and keep it refreshed at a bounded cadence — so the mirror (and the data it serves while Prisma is held) **survives warm/instance restarts** with **zero additional Prisma ops**.

- Snapshot source: `state.db.export()` — the SAME byte stream the existing public `exportSqliteBackup()` (`lib/sqlite.ts:672-680`) already produces for admin backup.
- Snapshot target (disk): `path.join(resolveLogsDir(), "sqlite-mirror.sqlite")` — `logs/` is gitignored, never `public/` (the file contains portfolio transaction mirrors — must never be web-served).
- Snapshot upload (Blobs, user-approved scope): best-effort upload of the SAME bytes to a `@netlify/blobs` store (`name: "tradenext-sqlite-mirror"`, `key: MIRROR_SNAPSHOT_BLOBS_KEY = "sqlite-mirror.sqlite"`) so the mirror also survives Netlify cold starts where the FS is ephemeral/read-only. Fail-open: adapter unavailable / no env → no-op (never throws, never blocks boot).
- Cadence (no new timers):
  1. **Eager** — immediately after each successful `syncFromPrisma()` completion (boot + 6h periodic + manual).
  2. **60s tick** — piggyback a `persistMirrorSnapshot()` call onto the EXISTING `OPS_PERSIST_INTERVAL_MS` timer inside `startOpsCounterPersistence()` (`lib/sqlite.ts:1723`) — this covers **non-leader** instances so every instance keeps its own fresh mirror.
- Boot restore (order): in `initSqliteBackup()` (`lib/sqlite.ts:1414`), load snapshot bytes **disk first → Blobs second → else fresh DB** (disk is freshest on warm-reboot hosts; Blobs covers Netlify cold starts). Then the existing schema replay (`SCHEMA_SQL`, all `CREATE TABLE IF NOT EXISTS`) + `ensureControlColumns`/`ensureNseColumns`/`ensureRecommendationColumns` run on top, so an older snapshot is safely upgraded to the current layout. Everything downstream (ready flag, `createFallback`, counter restores, boot sync, recovery probe) is unchanged. After the boot sync completes, persist the refreshed snapshot to disk AND fire the Blobs upload.

### Why

Today the mirror is RAM-only. During the 2026-09-15 → 2026-10-02 hold window, a deploy/restart empties it, and the read-first hot paths fall straight through to a held Prisma account. A DURABLE snapshot (disk + Blobs) gives the app the same restart-survival the `_backup_meta` counters already have — but for **all** mirrored tables — on warm reboots (disk) AND Netlify cold starts (Blobs).

### Scope

**IN:**
- `lib/sqlite.ts` only: snapshot write/read/validate helpers (disk) + `@netlify/blobs` upload/download helpers + boot-restore (disk → Blobs → fresh) + post-sync hook + 60s tick piggyback + test-override hooks + `resetSqliteStateForTests` cleanup.
- Blobs adapter: dynamic `import("@netlify/blobs")` inside the helpers (no static import), `getStore` memoized on globalThis (`__sqliteMirrorBlobsStore`, test-overridable), digest-gated fire-and-forget upload, `store.get(key, { type: "arrayBuffer" })` download. `@netlify/blobs ^11.0.3` is ALREADY pinned at `package.json:49` (PR #123, `e84fb34`) — **no install**, no `package.json` change.
- Tests in `lib/__tests__/sqlite.test.ts` (existing `MockDatabase` + real temp-dir files; Blobs tests via the globalThis store override — no jest module mock).
- Live-verify on :3000: restart dev server → mirror data still served.

**OUT:**
- **No long-hold breaker/probe-backoff change** (`PLAN_LIMIT_COOLDOWN_MS` stays 5 min; current flap is bounded and auto-recovers). Could be follow-up spec if user wants.
- **No Blobs integration beyond the mirror snapshot** — no Blob-backed logging/serverless branches return (v3.11.3 purge stays for logging).
- No schema change, no migration, no Prisma ops added, no new routes, no `package.json` change (pin `^11.0.3` already present), no UI changes.
- No change to admin backup/restore flow (`app/api/admin/db-health` POST `backup`/`restore`) — only shared byte-validation extracted.

### Depends on

- v3.31.0 SQLite-first mirror tables + `_sync_outbox` + `pushSqliteToPrisma` (snapshot content = what the mirror holds today).
- v3.21.1 `resolveLogsDir()` (logs dir resolution) + counter persistence patterns (`_backup_meta` KV restore at init).
- v3.22.0 `startOpsCounterPersistence` / `stopOpsCounterPersistence` timer pair (piggyback target).
- `@netlify/blobs ^11.0.3` — ALREADY a dependency (`package.json:49`, re-added by PR #123 commit `e84fb34`); no install. Runtime API used: `getStore({ name })`, `store.set(key, Blob)`, `store.get(key, { type: "arrayBuffer" })`.
- Nothing new from other specs.

---

## 2. Routes / API Changes

### New routes

None.

### Modified endpoints

None.

> **Justification for N/A:** this is a persistence-layer change inside `lib/sqlite.ts`. The admin backup/restore route already exists and is untouched (only its internal byte validation is extracted into a shared helper). An informational `mirrorSnapshot` field on GET `/api/admin/db-health` is a possible follow-up but deliberately OUT of scope to keep the change minimal.

---

## 3. Database Schema

**No Prisma schema change → no migration.**

- Tables touched: none (Prisma side).
- The sql.js `SCHEMA_SQL` replay is unchanged — every statement is `CREATE TABLE IF NOT EXISTS`, which is exactly what makes restoring an **older snapshot** safe: replay + `ensure*Columns` upgrade it in place.

---

## 4. Functions to Implement

### A. `lib/sqlite.ts` — mirror snapshot helpers (new module-level exports)

```typescript
export const MIRROR_SNAPSHOT_FILENAME = "sqlite-mirror.sqlite";

/** Resolved snapshot path: env QUERY_MIRROR_SNAPSHOT_PATH → globalThis __sqliteMirrorSnapshotPath (test override) → path.join(resolveLogsDir(), MIRROR_SNAPSHOT_FILENAME). Returns null when no writable dir is resolvable. */
export function getMirrorSnapshotPath(): string | null;

/** Extracted from restoreSqliteBackup: magic-header check + sql.js reload + required-tables check. Shared by admin restore + boot restore. */
export function validateSqliteBytes(
  bytes: Uint8Array,
): { ok: true } | { ok: false; missing: string[] };

/** Atomic write: temp file (pid+random suffix) in the same dir → fsync → rename over target. Returns written path or null (never throws). */
export function writeMirrorSnapshotFile(bytes: Uint8Array): string | null;

/** state.db.export() → writeMirrorSnapshotFile. Updates state.sqliteBytes. Non-fatal (logger.warn) on any failure → null. */
export function persistMirrorSnapshot(): string | null;

/** readFile → validateSqliteBytes → ok ? new SQL.Database(bytes) : null (logger.warn when invalid). Returns null on any failure. */
export function restoreMirrorSnapshot(): Database | null;

/** Test hook: clears the globalThis path override so the next resolve falls back to resolveLogsDir(). */
export function resetMirrorSnapshotOverrides(): void;
```

### A2. `lib/sqlite.ts` — Blobs upload/download helpers (user-approved scope addition)

```typescript
export const MIRROR_SNAPSHOT_BLOBS_STORE = "tradenext-sqlite-mirror";
export const MIRROR_SNAPSHOT_BLOBS_KEY = MIRROR_SNAPSHOT_FILENAME; // "sqlite-mirror.sqlite"

/** Lazy-memoized @netlify/blobs store on globalThis __sqliteMirrorBlobsStore (test override point). Dynamic import, try/catch → null (fail-open). */
export function getMirrorBlobsStore(): Promise<{ get(key: string, opts: { type: "arrayBuffer" }): Promise<ArrayBuffer | null>; set(key: string, value: Blob): Promise<void> } | null>;

/** Digest-gated fire-and-forget upload of mirror bytes. Skips when bytes unchanged since last successful upload (module-level lastDigest). Never throws. */
export function uploadMirrorSnapshotToBlobs(bytes: Uint8Array): Promise<void>;

/** Blobs → validateSqliteBytes → SQL.Database, else null (logger.warn). Used at boot AFTER disk restore fails. */
export function restoreMirrorSnapshotFromBlobs(): Promise<Database | null>;

/** Test hook: clears __sqliteMirrorBlobsStore + the module-level upload digest. */
export function resetMirrorBlobsOverrides(): void;
```

Design notes:
- `getMirrorBlobsStore()`: if `globalThis.__sqliteMirrorBlobsStore !== undefined` return it; else `const { getStore } = await import("@netlify/blobs")` in try/catch → `getStore({ name: MIRROR_SNAPSHOT_BLOBS_STORE })` → memoize → return. Any throw → memoize `null` + `logger.warn` → null.
- Upload: `const store = await getMirrorBlobsStore()`; null → return; compute sha-256 digest of bytes (`createHash` from `node:crypto` — add the import if absent; module is node-only via sql.js) — skip if equal to module-level `mirrorBlobsLastDigest`; else `await store.set(MIRROR_SNAPSHOT_BLOBS_KEY, new Blob([bytes]))` (Node 18+ global Blob) in try/catch → update `mirrorBlobsLastDigest` only on success; non-fatal.
- Multi-instance: NOT leader-gated — accept N instances PUTting the same bytes per sync (idempotent last-writer-wins; digest gate bounds chattiness to ~1 upload/instance/sync cycle). Documented tradeoff in section 13.
- Tests inject a fake store via `globalThis.__sqliteMirrorBlobsStore` — the dynamic import is never reached under jest.

### B. `initSqliteBackup()` boot integration (existing :1414-1457)

Current order is preserved; the ONLY insertions:

1. After the existing fresh-DB/schema-init path decides `state.db`, FIRST try `restoreMirrorSnapshot()` (disk — before `new SQL.Database()` fresh init): if it returns a DB, use it as `state.db`; else `await restoreMirrorSnapshotFromBlobs()` (Blobs) → DB → use it; else fall through to the existing fresh init. Schema replay + `ensure*Columns` then run on whichever source won (upgrades old snapshots from disk OR Blobs).
2. After the boot `syncFromPrisma({ reason: "boot", skipReconcile: true, leaderBypass: true })` completes (the existing `.then` where counters are persisted): add `persistMirrorSnapshot()` + fire `void uploadMirrorSnapshotToBlobs(state.sqliteBytes)` so a freshly-restored instance immediately writes back its refreshed mirror (disk + Blobs).

### C. `syncFromPrisma()` post-sync hook (existing :2912)

- **Success exit path**: after the sync completes (rows synced), call `persistMirrorSnapshot()` (instance-local, NO leader gate — each instance persists its own mirror; zero Prisma ops) and fire `void uploadMirrorSnapshotToBlobs(state.sqliteBytes)`. Failures are non-fatal.
- **Breaker-gated early return** (`:2949`) and **API-level failures**: do NOT trigger a snapshot write (nothing changed) — and critically, do NOT delete an existing snapshot file or Blob.

### D. 60s tick piggyback (existing `startOpsCounterPersistence()` :1723)

- Inside the existing `setInterval` tick (alongside `persistOpsCounter()` / `persistOpsMonthly()`), add a third call: `persistMirrorSnapshot()` — non-fatal on failure. **Disk-only** — no Blobs upload from the tick (per-tick PUTs would spam the store; Blobs only flows from sync/persist sites). This keeps NON-leader instances' mirrors fresh without any new timer; `stopOpsCounterPersistence()` (:1733) is unchanged.

### E. `resetSqliteStateForTests()` cleanup (existing :1746+)

- Clear the snapshot path override (`__sqliteMirrorSnapshotPath`) so tests never leak a fake path across files.
- Call `resetMirrorBlobsOverrides()` so the Blobs store/digest never leaks across files.

---

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/sqlite.ts` | Modified | Add `MIRROR_SNAPSHOT_FILENAME`, `getMirrorSnapshotPath`, `validateSqliteBytes` (extracted from `restoreSqliteBackup` :695-716), `writeMirrorSnapshotFile`, `persistMirrorSnapshot`, `restoreMirrorSnapshot`, `resetMirrorSnapshotOverrides` + Blobs helpers `MIRROR_SNAPSHOT_BLOBS_STORE`, `MIRROR_SNAPSHOT_BLOBS_KEY`, `getMirrorBlobsStore`, `uploadMirrorSnapshotToBlobs`, `restoreMirrorSnapshotFromBlobs`, `resetMirrorBlobsOverrides`; boot-restore (disk → Blobs → fresh) in `initSqliteBackup` (:1414); post-sync hook in `syncFromPrisma` (:2912); 60s tick piggyback in `startOpsCounterPersistence` (:1723); `resetSqliteStateForTests` (:1746+) cleanup. |
| `lib/__tests__/sqlite.test.ts` | Modified | New snapshot describe (disk 7) + Blobs describe (5) (see section 12). Existing barrier/restore tests MUST keep passing (extraction refactor). |
| `.agents/plans/12-sqlite-durable-mirror.md` | **Created** | Plan companion. |
| `.gitignore` | Modified (verify only) | Confirm `logs/` already covered (snapshot lives there on dev). |
| `package.json` | **Verified — NO change** | `@netlify/blobs` `^11.0.3` already pinned at :49 (PR #123 `e84fb34`); no install, lockfile untouched. |

---

## 6. Dependencies

### New Packages

| Package | Version | Reason |
|---------|---------|--------|
| None | — | — |

### Internal Dependencies

| Module | Function Used | Purpose |
|--------|---------------|---------|
| `@/lib/logger` | `resolveLogsDir`, `logger.warn` | Snapshot dir resolution + non-fatal failure logging |
| `sql.js` (already dep) | `SQL.Database` | Snapshot byte reload/validation |

---

## 7. API Contract

No new or modified route contracts.

> **Justification for N/A:** the snapshot is a server-side persistence detail; no request/response shape changes. (Optional future: db-health GET `mirrorSnapshot` diagnostic field — deferred.)

---

## 8. UI/UX Requirements

None — no UI changes.

> **Justification for N/A:** no user-facing surface changes. Live-verify is behavioral (restart server, data still served).

---

## 9. Rules & Guardrails

- [x] No Prisma in client components (no client impact at all)
- [x] Zero new Prisma ops — snapshot is disk + Blobs only, no leader gate, no DB reads/writes
- [x] All writes non-blocking-to-HTTP: disk writes synchronous but bounded (< ~20 MB typical mirror) and fire from background ticks/sync completion, never inline in a request path; Blobs uploads fire-and-forget (`void`)
- [x] Never throw from persistence helpers — non-fatal `logger.warn` + `null` on failure (mirror degradation must never crash boot or the 60s tick)
- [x] Atomic file write (tmp + rename) — a crash mid-write can never corrupt the live snapshot
- [x] Snapshot file never lands in `public/` or the repo root — only `logs/` (gitignored) or the override path
- [x] Blobs upload uses the ALREADY-pinned `@netlify/blobs ^11.0.3` (no install); getStore failures → memoized `null` + silent skip (fail-open, config/credentials only exist on Netlify); digest gate prevents redundant PUTs
- [x] Logging via `@/lib/logger` only (no new `console.log`)
- [x] `@netlify/blobs` pin `^11.0.3` stays untouched
- [x] Operating constraints: lowercase `type(scope)` commits, never push `main`, kill only agent-started processes, don't print `.env`

---

## 10. Expected Behavior

1. After a successful `syncFromPrisma()` completes, `logs/sqlite-mirror.sqlite` appears immediately (post-sync hook) containing the full mirror (recommendations + screener + corp-actions + swing + `_backup_meta` + outbox …); a Blobs upload is fired (digest-gated), so the cloud copy tracks the refreshed mirror too.
2. Every 60s the existing ops-persist tick also refreshes the DISK snapshot — including on non-leader instances (Blobs NOT uploaded per-tick).
3. On a warm restart of the same host, `initSqliteBackup` restores mirror rows from the disk snapshot BEFORE the boot sync — hot reads work even while the breaker is open / Prisma held.
4. On a cold start with an empty/writable-dir FS (e.g. Netlify redeploy), disk restore finds nothing → Blobs restore kicks in: if `getStore` resolves (Netlify env) it fetches `sqlite-mirror.sqlite`, validates, and restores it the same way — otherwise falls through to fresh mirror + boot sync (fail-open, no error surfaced).
5. A boot with NO snapshot anywhere (fresh clone / no prior upload) behaves EXACTLY as today (fresh mirror + boot sync when Prisma available) — no regression.
6. Corrupt/truncated/missing-table snapshot (disk or Blobs) → `logger.warn` + fall back to fresh DB + boot sync — **never** crashes boot.
7. Attempting to persist when the dir is read-only/absent → `logger.warn` + `null` (app continues; `state.sqliteBytes` unchanged semantics).
8. Zero Prisma ops added; no schema change; no new packages; no new routes; mirror path overridable for tests.

**Verification gate:** full jest suite green (target ≥ baseline **88/88 files, 1218 pass / 4 skip / 0 fail**); `npx tsc --noEmit` = **46 exact baseline (0 new)**; `npm ls @netlify/blobs` resolves (`^11.0.3`, no install).

**Durability honesty (flag to user):** the DISK snapshot survives warm/instance churn on the SAME warm instance but NOT cold starts / redeploys (Netlify FS is read-only except ephemeral /tmp). The **Blobs snapshot closes that gap**: uploaded bytes are stored in the Netlify-hosted `tradenext-sqlite-mirror` store and restored at boot on any instance, so a cold start no longer resets to a fresh mirror. Both layers are best-effort and fail-open — if either is unavailable the boot still succeeds via the remaining tiers (disk → Blobs → fresh + Prisma sync when reachable). Netlify-side Blobs wiring is REAL-config territory (env/config must exist on the deploy; not testable in local dev) — verified at deploy-time as a post-check.

---

## 11. Error Handling

| Scenario | Behavior | Log Level |
|----------|----------|-----------|
| Snapshot file missing at boot | Fresh DB init (today's path) | (silent) |
| Snapshot corrupt/invalid magic | `logger.warn` + fresh DB + boot sync | `warn` |
| Snapshot reloads but missing a required table | `validateSqliteBytes` → `{ok:false, missing:[…]}` → fresh DB | `warn` |
| Snapshot dir read-only / disk full | `persistMirrorSnapshot` → `null`, app continues | `warn` |
| Crash mid-write | Atomic tmp+rename → old snapshot intact | `error` (next boot) |
| `state.db` null (not initialized) | `persistMirrorSnapshot` → `null`, no throw | (silent) |
| Blobs store unavailable (no Netlify env / getStore throws) | `getMirrorBlobsStore` → memoized `null` + `logger.warn` once; upload/download silently skip; boot proceeds via disk-fresh path | `warn` |
| Blobs `set` fails (network/credentials) | digest NOT updated → retried on next sync; non-fatal | `warn` |
| Blobs `get` fails / key absent | `restoreMirrorSnapshotFromBlobs` → `null`; boot proceeds via fresh + sync | `warn` |
| Blobs bytes invalid (magic/required tables) | `validateSqliteBytes` → `{ok:false}` → `null`; fresh DB | `warn` |
| Test override path set + reset missed | `resetSqliteStateForTests` clears it (disk + blobs overrides) | (test) |

---

## 12. Test Strategy

### Unit Tests (`lib/__tests__/sqlite.test.ts`, node env, temp-dir override)

- [ ] `persistMirrorSnapshot()` writes a REAL file at the override path; `restoreMirrorSnapshot()` reloads it and the restored DB returns the same rows (recommendations mirror round-trip).
- [ ] Atomic write: temp file removed, only `sqlite-mirror.sqlite` remains after success.
- [ ] Corrupt bytes (garbage) → `validateSqliteBytes` `{ok:false}` → `restoreMirrorSnapshot` `null` → boot proceeds with fresh DB (no throw).
- [ ] Valid sql.js bytes but missing a required table → `{ok:false, missing:[…]}` listing the table.
- [ ] `getMirrorSnapshotPath()` order: env override > globalThis test override > `resolveLogsDir()` fallback; `resetMirrorSnapshotOverrides()` resets so fallback is used again.
- [ ] Persist with un-writable path → `null` + no throw (`logger.warn` stub).
- [ ] `resetSqliteStateForTests()` clears the override (leak guard).
- [ ] REGRESSION: existing `restoreSqliteBackup` barrier tests (invalid magic → 400, missing required table → reject, > `MAX_RESTORE_BYTES` → reject, valid round-trip) still green after the `validateSqliteBytes` extraction.

### Blobs tests (via `globalThis.__sqliteMirrorBlobsStore` fake store — dynamic import never reached)

- [ ] `uploadMirrorSnapshotToBlobs` stores bytes under `MIRROR_SNAPSHOT_BLOBS_KEY` on the fake store; unchanged bytes (same digest) → `set` NOT called again (digest gate).
- [ ] `restoreMirrorSnapshotFromBlobs` returns a working `Database` for valid stored bytes (round-trip rows match).
- [ ] Blobs `get` returns null / store null → `null`, no throw (boot falls through to fresh).
- [ ] Blobs bytes invalid → `validateSqliteBytes` rejects → `null`, no throw.
- [ ] `resetMirrorBlobsOverrides()` clears store + digest (leak guard).

### Full-suite gate

- `npm run test` — target `sqlite.test.ts` green (existing 83 + new); full suite ≥ **88/88 files, 1218 pass / 4 skip / 0 fail** (baseline).
- `npx tsc --noEmit` — **46 = exact baseline (0 new)**.
- Live :3000: run `force=1` recommendations (or any sync), restart dev server, confirm SQLite-served data still renders without Prisma; 0 console errors.

---

## 13. Performance Considerations

- **Snapshot bytes** = mirror export (tracked today as `state.sqliteBytes`). Typical well under 20 MB even with 6h of accumulated rows; retention prunes keep it bounded.
- **Write cost**: one synchronous export+write per successful sync (rare: boot + 6h + manual) + once per 60s tick. Export of an in-memory sql.js DB is milliseconds-to-tens-of-ms; the 60s disk write is trivial for dev/FAT/SSD.
- **Blobs upload cost**: one PUT per successful sync (digest-gated, so only when mirror bytes changed since the last successful upload — normally ~once per 6h cycle, not per boot-sync with identical bytes). Upload is fire-and-forget (`void`), never awaited by boot or sync; payload = the ≤20 MB snapshot. Multi-instance tradeoff: NOT leader-gated, so N instances may each PUT the same bytes per sync cycle — idempotent last-writer-wins in the store and the digest gate bounds chattiness to ~1 upload/instance/sync, which is acceptable (Netlify Blobs charges are per store/read/op, and a 6h cadence × few instances is negligible).
- **Zero Prisma impact**: no queries, no ops counter changes, no leader-gate involvement.
- **Read cost**: boot `restoreMirrorSnapshot` = one synchronous file read + sql.js `SQL.Database(bytes)`; Blobs restore (disk miss only) = one async `store.get` + validation. Single one-time cost at init, far cheaper than the existing boot sync.
- **Netlify /tmp**: bounded by the 256 MB/512 MB ephemeral volume; mirror far below that.

---

## 14. Security Considerations

- **Data at rest**: the snapshot mirrors portfolio **transactions**, alerts, announcements + `_backup_meta` (ops counters, time correction — no credentials/secrets). Therefore:
  - The file MUST live only in `logs/` (gitignored) or the override path — **never `public/` or repo root** (adds a hard guard comment + plan check).
  - Default filesystem perms are fine (no world-readable dirs on the targets; Netlify /tmp is instance-private).
  - **Blobs at rest**: the same byte stream is uploaded to the Netlify-hosted `tradenext-sqlite-mirror` store (`sqlite-mirror.sqlite` key). Netlify Blobs are stored server-side in the account's region and are NOT public — access requires the site's `NETLIFY` env context / deploy credentials that resolve `getStore`. No secrets are in the snapshot (see below), and the store name/key are non-sensitive. Fail-open: on any non-Netlify env the adapter resolves `null` and nothing is uploaded.
- **Auth/RBAC**: no routes touched; no admin surface changes.
- **Inputs**: no external input; `validateSqliteBytes` guards against malformed file contents (magic + required tables).
- **Secrets**: none written to the snapshot (a grep check in the plan confirms `_backup_meta` keys carry no secrets).
- **Integrity**: atomic tmp+rename prevents torn files; a torn/corrupt snapshot fails validation and is discarded (never boot-crashes).

---

## 15. Definition of Done

- [ ] Helpers implemented per section 4 (A): `MIRROR_SNAPSHOT_FILENAME`, `getMirrorSnapshotPath`, `validateSqliteBytes`, `writeMirrorSnapshotFile`, `persistMirrorSnapshot`, `restoreMirrorSnapshot`, `resetMirrorSnapshotOverrides`
- [ ] Blobs helpers implemented per section 4 (A2): `MIRROR_SNAPSHOT_BLOBS_STORE`, `MIRROR_SNAPSHOT_BLOBS_KEY`, `getMirrorBlobsStore` (memoized, fail-open), `uploadMirrorSnapshotToBlobs` (digest-gated, fire-and-forget), `restoreMirrorSnapshotFromBlobs`, `resetMirrorBlobsOverrides`
- [ ] Boot-restore integrated in `initSqliteBackup` (**disk → Blobs → fresh** → schema replay → upgrade → boot sync → persist disk + fire Blobs upload)
- [ ] Post-sync hook in `syncFromPrisma` success path (instance-local, non-fatal) — persists disk + fires Blobs upload; breaker-gated early return / API failure writes nothing and deletes nothing
- [ ] 60s tick piggyback in `startOpsCounterPersistence` (non-leader instances covered; `stopOpsCounterPersistence` unchanged; **disk-only** — no per-tick Blobs upload)
- [ ] `resetSqliteStateForTests` clears the path override + `resetMirrorBlobsOverrides()`; both `resetMirrorSnapshotOverrides` and `resetMirrorBlobsOverrides` exported
- [ ] No schema change → no migration; **no new packages** (`@netlify/blobs ^11.0.3` ALREADY pinned at `package.json:49`; no install, no lockfile change); no new routes; `@netlify/blobs` pin untouched
- [ ] Tests: new snapshot describe (**7 disk**) + Blobs describe (**5**) + existing sqlite barrier tests green; full suite ≥ 88/88 files, 1218 pass / 4 skip / 0 fail
- [ ] `npx tsc --noEmit` = 46 exact baseline (0 new); `npm ls @netlify/blobs` resolves `^11.0.3` (no install)
- [ ] `.gitignore` confirmed to cover `logs/` (snapshot never committed)
- [ ] Live-verified on :3000 (sync → restart server → SQLite-served data still renders; 0 console errors)
- [ ] Documentation updated (AGENTS.md row, CHANGELOG `versions-v3.39.md`, TODO, Primer, agent-memory, Lessons)
- [ ] Session memory (`decisions.md` + `flow.md`) written
- [ ] Human-approved spec + plan; commit/push/deploy ONLY on explicit user approval