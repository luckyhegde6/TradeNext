# Implementation Plan — SQLite Durable Mirror

> Generated from spec: `.agents/specs/12-sqlite-durable-mirror.md`
> Save to `.agents/plans/12-sqlite-durable-mirror.md`

## Spec Reference

- **Spec**: `.agents/specs/12-sqlite-durable-mirror.md`
- **Branch**: `feat/sqlite-durable-mirror`, created from the current HEAD of `fix/sqlite-upsert-worker-undefined-bind` (NOT local `main`) — the base branch carries the unreleased v3.39.x fixes this feature relies on (`2182687` toIsoVal fix, `f470e6d` set_ops_counter queryConsumption response, PR #123 `@netlify/blobs` re-add `e84fb34`, PRs #124/#125).
- **Created**: 2026-09-15
- **Approved**: 2026-09-15 (human approval included the scope addition of `@netlify/blobs` upload for cold-start durability)
- **No install**: `@netlify/blobs ^11.0.3` is ALREADY pinned at `package.json:49` (PR #123 `e84fb34`) — no `package.json`/lockfile change; verify with `npm ls @netlify/blobs`.

---

## Implementation Steps

> Ordered steps. Each step is atomic — can be verified independently.
> Format: `[N] Step description → verify: [check command]`

### Phase 1: `lib/sqlite.ts` — snapshot helpers

1. **Add module-level constants + `getMirrorSnapshotPath`** — `MIRROR_SNAPSHOT_FILENAME`, `getMirrorSnapshotPath()` (env override → globalThis test override → `path.join(resolveLogsDir(), MIRROR_SNAPSHOT_FILENAME)`; returns null when dir unresolvable), `resetMirrorSnapshotOverrides()` test hook → verify: `npx tsc --noEmit` (0 new errors)
2. **Extract `validateSqliteBytes` from `restoreSqliteBackup`** — move the magic-header check (`:695-700`) + sql.js init + required-tables check (`:711-716`) into a standalone `validateSqliteBytes(bytes): { ok: true } | { ok: false; missing: string[] }`; refactor `restoreSqliteBackup` to call it internally → verify: `npm run test -- sqlite.test.ts` (existing barrier/restore tests green — **no behavior change**)
3. **`writeMirrorSnapshotFile` (atomic)** — write bytes to a temp file in the same dir (`process.pid` + `crypto.randomUUID` suffix), `fsyncSync`, `renameSync` over the target path; returns written path or `null` on failure (never throws, `logger.warn` on write error) → verify: `npx tsc --noEmit`
4. **`persistMirrorSnapshot`** — `new Uint8Array(state.db.export())` → `writeMirrorSnapshotFile`; update `state.sqliteBytes`; returns path or `null`; null/early-return when `state.db` is null → verify: `npx tsc --noEmit`
5. **`restoreMirrorSnapshot`** — `fs.readFileSync(path)` → `validateSqliteBytes` → ok: `new SQL.Database(bytes)`; else: `logger.warn` + return null; `try/catch` → null on any file/read failure → verify: `npx tsc --noEmit`

### Phase 1.5: `lib/sqlite.ts` — Blobs layer (user-approved scope addition)

5b. **`getMirrorBlobsStore()` + constants** — `MIRROR_SNAPSHOT_BLOBS_STORE` (`"tradenext-sqlite-mirror"`) / `MIRROR_SNAPSHOT_BLOBS_KEY` (= `MIRROR_SNAPSHOT_FILENAME`); lazy-memoized store on globalThis `__sqliteMirrorBlobsStore` via dynamic `import("@netlify/blobs")` (try/catch → memoized `null` + `logger.warn`, fail-open) → verify: `npm ls @netlify/blobs` resolves `^11.0.3` (already pinned, no install); `npx tsc --noEmit` (0 new errors)
5c. **`uploadMirrorSnapshotToBlobs` (digest-gated, fire-and-forget)** — sha-256 digest via `createHash` from `node:crypto` (add import if absent — verify at top of file) vs module-level `mirrorBlobsLastDigest`; skip when unchanged; `store.set(MIRROR_SNAPSHOT_BLOBS_KEY, new Blob([bytes]))` (Node 18+ global Blob); digest updated ONLY on success; never throws → verify: `npx tsc --noEmit`
5d. **`restoreMirrorSnapshotFromBlobs`** — `store.get(MIRROR_SNAPSHOT_BLOBS_KEY, { type: "arrayBuffer" })` → `new Uint8Array(buf)` → `validateSqliteBytes` → `new SQL.Database(bytes)` | `null` (`logger.warn` on failure) → verify: `npx tsc --noEmit`
5e. **`resetMirrorBlobsOverrides()`** — clears globalThis `__sqliteMirrorBlobsStore` + module-level `mirrorBlobsLastDigest` (test hook) → verify: `npx tsc --noEmit`

### Phase 2: `lib/sqlite.ts` — boot integration + hooks

6. **Boot restore in `initSqliteBackup`** — before the existing fresh-DB creation (`:1420`), try `restoreMirrorSnapshot()` (disk) first: if non-null → set `state.db` to the restored DB; else `await restoreMirrorSnapshotFromBlobs()` (Blobs) → DB → use it; else fall through to the existing `new SQL.Database()` path. Schema replay (`:1423-1426`) + `ensure*Columns` (`:1429-1435`) then run on either source, safely upgrading an older snapshot. Post-boot sync: after the existing `syncFromPrisma({ boot })` `.then` (where counter restores happen, `:1442-1447`), add `persistMirrorSnapshot()` + fire `void uploadMirrorSnapshotToBlobs(state.sqliteBytes)` so a freshly-restored instance immediately writes back its refreshed mirror (disk + Blobs) → verify: `npm run test -- sqlite.test.ts` (existing boot tests pass; new snapshot restore tests in Phase 3)
7. **Post-sync hook in `syncFromPrisma`** — at the success exit (after rows synced, ~:3450+ `leaderGated` block completion), call `persistMirrorSnapshot()` (instance-local, NO leader gate — zero Prisma ops) + fire `void uploadMirrorSnapshotToBlobs(state.sqliteBytes)`; failures non-fatal (`try/catch` + `logger.warn`). **No hook on:** breaker-gated early return (`:2949`) or API failure paths (nothing written, nothing deleted) → verify: `npm run test -- sqlite.test.ts`
8. **60s tick piggyback in `startOpsCounterPersistence`** — inside the existing `setInterval` tick (alongside `persistOpsCounter()` + `persistOpsMonthly()`), add a third call: `persistMirrorSnapshot()` (non-fatal on failure). **Disk-only** — no Blobs upload from the tick (per-tick PUTs would spam the store; Blobs only flows from sync/persist sites). `stopOpsCounterPersistence()` (`:1733`) unchanged → verify: `npm run test -- sqlite.test.ts` (existing timer tests pass)
9. **`resetSqliteStateForTests` cleanup** — at `:1746+`, add clearing of the globalThis `__sqliteMirrorSnapshotPath` test override + call `resetMirrorBlobsOverrides()` so tests never leak a fake path/store/digest across files → verify: `npm run test -- sqlite.test.ts` (all existing tests green; no cross-test leakage)

### Phase 3: Tests

10. **New snapshot describe block** in `lib/__tests__/sqlite.test.ts` — using temp dir via `os.tmpdir()` + `path.join(os.tmpdir(), pid + "-mirror-" + randomUUID())` override:
    - Round-trip: seed recommendations → persist → restoreMirrorSnapshot → restored DB returns same rows
    - Atomic: temp file removed after persist; only `sqlite-mirror.sqlite` remains
    - Corrupt bytes → validateSqliteBytes `{ok:false}` → restoreMirrorSnapshot `null`; boot proceeds with fresh DB (no throw)
    - Valid sql.js bytes missing required table → `{ok:false, missing:[…]}`
    - `getMirrorSnapshotPath()` override order: env > globalThis > resolveLogsDir(); `resetMirrorSnapshotOverrides()` resets
    - Persist with un-writable path → `null` + no throw
    - `resetSqliteStateForTests` clears the override (leak guard)
    → verify: `npm run test -- sqlite.test.ts` (existing 83 + 7 new)

10b. **Blobs snapshot tests** in `lib/__tests__/sqlite.test.ts` — using a fake store installed via the globalThis `__sqliteMirrorBlobsStore` override (the dynamic `import("@netlify/blobs")` is never reached under jest; no jest module mock needed):
    - `uploadMirrorSnapshotToBlobs` stores bytes under `MIRROR_SNAPSHOT_BLOBS_KEY` (fake store `set` called with a `Blob`)
    - Unchanged digest → upload skipped (fake store `set` NOT called); changed bytes → uploaded (digest gate)
    - `restoreMirrorSnapshotFromBlobs` round-trip → working DB returns same rows
    - Fail-open: null store / null `get` / invalid bytes → `null`, no throw
    - `resetMirrorBlobsOverrides()` clears store + digest (leak guard)
    → verify: `npm run test -- sqlite.test.ts` (existing 83 + 7 disk + 5 Blobs)

11. **Full suite gate** → verify:
    ```bash
    npm run test          # ≥ 88/88 files, 1218 pass / 4 skip / 0 fail
    npx tsc --noEmit      # 46 = exact baseline (0 new)
    ```

### Phase 4: Live verification

12. **Live :3000 behavioral test** — start dev server, force a recommendations sync (or swing), confirm snapshot file at `logs/sqlite-mirror.sqlite`, restart dev server, confirm SQLite-served recommendations/corp-actions/screener data renders without calling Prisma (watch Network panel), 0 console errors → verify: data persists across restart
13. **`.gitignore` verify** — confirm `logs/` is already gitignored (snapshot must never be committed) → verify: `git status` shows no new untracked files outside intended scope

### Phase 5: Documentation

14. **Update AGENTS.md** — add v3.39.x row to version table → verify: row present
15. **Create `.agents/changelog/versions-v3.39.md`** — snapshot feature bullets → verify: file exists with root cause + files changed
16. **Update `.agents/CHANGELOG.md`** — index entry → verify: entry present
17. **Update `TODO.md`** — quick-reference row → verify: row present
18. **Update `Primer.md`** — current project status → verify: updated
19. **Update `agent-memory.md`** — activity entry → verify: entry added
20. **Update `Lessons.md`** — new lesson if pattern discovered (e.g., `validateSqliteBytes` extraction as a general refactor pattern for shared byte-validation)
21. **Create session memory** — `.agents/sessions/YYYY-MM-DD-hash/decisions.md` + `flow.md` → verify: files present

### Phase 6: Commit

22. **Commit + docs commit**
    ```bash
    git add lib/sqlite.ts lib/__tests__/sqlite.test.ts .gitignore
    git commit -m "feat(sqlite): snapshot-based durable mirror"
    git add .agents/ @Primer.md @agent-memory.md @Lessons.md
    git commit -m "docs: v3.39.x spec 12 — SQLite durable mirror [skip ci]"
    ```
    → verify: `git log --oneline -3` shows both commits; `git status` clean
    → **No push/merge/deploy without explicit user approval.**

---

## Test Strategy

### Unit Tests (Required)

| # | Test | File | What It Verifies |
|---|------|------|------------------|
| 1 | Round-trip persist → restore returns same rows | `sqlite.test.ts` | Snapshot correctness |
| 2 | Temp file removed; only target file exists | `sqlite.test.ts` | Atomic write |
| 3 | Corrupt bytes → restoreMirrorSnapshot `null`, fresh DB fallback | `sqlite.test.ts` | Graceful degradation |
| 4 | Valid sql.js + missing required table → `{ok:false}` listing table | `sqlite.test.ts` | validateSqliteBytes extraction |
| 5 | Override order (env > globalThis > fallback); reset clears | `sqlite.test.ts` | Test isolation |
| 6 | Persist un-writable path → `null`, no throw | `sqlite.test.ts` | Non-fatal failure |
| 7 | `resetSqliteStateForTests` clears override (leak guard) | `sqlite.test.ts` | Test infrastructure |
| 8 | Blobs upload stores bytes under `MIRROR_SNAPSHOT_BLOBS_KEY` | `sqlite.test.ts` | Blobs upload path via fake store |
| 9 | Unchanged digest skips `set`; changed bytes → uploaded | `sqlite.test.ts` | Digest gate prevents redundant PUTs |
| 10 | Blobs restore round-trip → working DB, same rows | `sqlite.test.ts` | `restoreMirrorSnapshotFromBlobs` success path |
| 11 | Fail-open: null store/get, invalid bytes → `null`, no throw | `sqlite.test.ts` | Graceful degradation when Blobs unavailable/corrupt |
| 12 | `resetMirrorBlobsOverrides()` clears store + digest | `sqlite.test.ts` | Test isolation for the Blobs layer |

### Regression (existing, no changes)

| # | Test | What It Verifies |
|---|------|------------------|
| R1 | `restoreSqliteBackup` barrier: invalid magic → 400 | Extraction does not break existing contract |
| R2 | `restoreSqliteBackup` barrier: missing required table → reject | Same |
| R3 | `restoreSqliteBackup` barrier: >MAX_RESTORE_BYTES → reject | Same |
| R4 | `restoreSqliteBackup` valid round-trip → restored DB has data | Same |

---

## Verification Checklist

> Run these commands after implementation. All must pass.

```bash
# Type checking
npx tsc --noEmit                    # 46 = exact baseline (0 new)

# Tests
npm run test                        # ≥ 88/88 files, 1218 pass / 4 skip / 0 fail

# Lint
npm run lint                        # No new warnings (pre-existing ignores)

# No Prisma changes
npx prisma validate                 # Schema unchanged (still valid)

# No new packages (Blobs already pinned via PR #123)
npm ls @netlify/blobs               # ^11.0.3 resolves; no install
```

---

## Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| Netlify cold-start: snapshot lost (ephemeral /tmp) | Blobs upload IN scope (user-approved): `tradenext-sqlite-mirror` store restores the mirror on cold starts; fail-open when Blobs env is absent; Netlify-side wiring is a REAL-config deploy-time post-check | — |
| Snapshot grows over time (daily_price_snapshot, wb tables) | retention prunes already active (14d wb, 7d intelligence, etc.); total mirror size bounded | Monitor via db-health diagnostic if needed |
| Read-only Netlify FS → persist always fails | Non-fatal: `null` + `logger.warn`, app continues; falls back to today's behavior (no regression) | — |
| Corrupt snapshot at boot | `validateSqliteBytes` rejects → fresh DB + boot sync; never crashes | — |
| 60s tick disk write on Netlify (shared /tmp) | One write per instance; no contention (FS-level); bounded bytes | — |
| Long-hold breaker / probe-backoff flap (5-min cycle) | OUT of scope: bounded, auto-recovers when Prisma returns; can be a follow-up spec | Yes (follow-up spec if user wants) |

---

## Documentation Checklist

> All docs must be updated before commit.

- [ ] **AGENTS.md** — v3.39.x version row added
- [ ] **CHANGELOG** — `.agents/changelog/versions-v3.39.md` detail + index update
- [ ] **TODO.md** — quick-reference row
- [ ] **Primer.md** — current project status updated
- [ ] **agent-memory.md** — activity log entry
- [ ] **Lessons.md** — new lesson (if pattern/bug discovered)
- [ ] **Session memory** — `decisions.md` + `flow.md` in `.agents/sessions/`
- [ ] **session-todos.md** — current session updated
- [ ] **handoffs/active/latest.md** — resume context

---

## Pre-Commit Gate

> Must pass before any commit.

1. `npx tsc --noEmit` — 0 new errors (46 exact baseline)
2. `npm run test` — all pass (≥ 1218 pass / 4 skip / 0 fail)
3. `npm run lint` — no new warnings
4. `npm ls @netlify/blobs` — resolves `^11.0.3` (already pinned; no install)
5. `git status` — no junk artifacts, no secrets in diff, no snapshot file staged
6. Documentation updated per checklist above
7. Engineering checklist (`.agents/rules/checklist.md`) validated