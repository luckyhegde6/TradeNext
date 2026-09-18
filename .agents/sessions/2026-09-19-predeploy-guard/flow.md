# Flow — 2026-09-19 — v3.40.3 predeploy mirror-preservation guard (Spec 14)

Branch: `feature/predeploy-mirror-preserve` (from `main` @ `27c0770` = v3.40.2 MERGED via PR #129 `38ee7da`)
Session dir: `.agents/sessions/2026-09-19-predeploy-guard/`
Spec: `.agents/specs/14-predeploy-mirror-preserve.md` · Plan: `.agents/plans/14-predeploy-mirror-preserve.md`

---

## Phase 0 — Recon (design confirmation)

- Confirmed the P6003 plan-limit hold (until 2026-10-02) ⇒ production deploy could cold-start with an
  EMPTY SQLite mirror — same served-empty class as v3.40.1 (origin: user-reported empty analytics).
- Confirmed no build-time preservation/drain step existed; outbox + snapshot + Blobs backups only
  happen at runtime (60s ops timer / 6h push engine / 30s deferred restore).
- Spec + plan written and user-approved before any code.

## Phase 1 — `lib/sqlite.ts` (durable mirror plumbing)

- `MirrorTrigger`, `SQLITE_SYNC_TRIGGERS` gained `SyncTrigger "deploy"` (new `lib/sqlite.ts` sync trigger).
- `MirrorBlobsStoreLike` exported + widened with optional `list?`/`delete?` (used by backup prune).
- `getMirrorBlobsStore()` exported (used by `lib/services/mirrorBackup.ts` upload path).

## Phase 2 — `lib/services/mirrorBackup.ts` (NEW, pure)

- `mirrorBackupKey(ts = new Date())` → `backups/sqlite-mirror-<YYYY-MM-DDTHH-MM-SS-mmmZ>.sqlite`.
- `MIRROR_BACKUP_KEEP = 5`, `MIRROR_BACKUP_MAX_BYTES = 200 MiB` constants.
- `createMirrorBackup(bytes)` → `key | null` fail-open (empty/throw → null; Lesson 132: key built with
  `String(part).padStart(2, "0")` so ISO assembly can never produce an `Invalid Date`).
  Writes Blobs via `getMirrorBlobsStore().put(key, bytes)`.
- `listMirrorBackups()` / `pruneMirrorBackups()` — error-tolerant (missing/unsupported list/delete ⇒
  no-op), keep newest `MIRROR_BACKUP_KEEP` keys.
- Tests: `lib/__tests__/mirrorBackup.test.ts` — **14/14** (key format regex, retention, fail-open on
  empty/throw, list/prune tolerance, 2-digit day regression).

## Phase 3 — `app/api/admin/predeploy/preserve/route.ts` (NEW)

- `GET` — read-only diagnostics `{success, breakerOpen, sqliteReady, pending, backups, keep}`
  (uses `isPlanLimitBreakerOpen()`, `getSqliteFallback().getOutboxPending()`, `listMirrorBackups()`).
- `POST` — ordering contract (D3): pending → snapshot (`persistMirrorSnapshot()` +
  `exportSqliteBackup()` + `uploadMirrorSnapshotToBlobs()` via `getMirrorBlobsStore()`)
  → `createMirrorBackup(bytes)` → `if (!isPlanLimitBreakerOpen())` `pushSqliteToPrisma({reason:
  "deploy", leaderGate: false})` → `createAuditLog({action:"ADMIN_DB_SYNC",
  resource:"predeploy-preserve"})`. Response modes `"pushed" | "backed_up" | "skipped"`.
- Auth (D4): `x-deploy-guard-token` via `crypto.timingSafeEqual` after length check vs
  `DEPLOY_GUARD_TOKEN` (64-hex); 503 `guard_token_not_configured` when env unset + token presented;
  fallback `authorize(req)` admin session. `runtime="nodejs"`, `dynamic="force-dynamic"`.
- Tests: `lib/__tests__/predeployPreserveRoute.test.ts` — **11/11** (GET diagnostics, POST 401,
  token 401/503, breaker-open `backed_up`, push-fail 500 `push_failed`, audit written).

## Phase 4 — `scripts/predeploy/preserve-mirror.mjs` (NEW, build guard)

- Self-gating: `CONTEXT === "production"` OR `--force`; else warn + exit 0.
- URL chain `DEPLOY_PRIME_URL` → `URL` → `NEXT_PUBLIC_BASE_URL` → `https://tradenext6.netlify.app`.
- POST with `x-deploy-guard-token` (from `DEPLOY_GUARD_TOKEN`, never logged); 20 s timeout;
  parse `{mode, pending, pushed, backup, pruned}`; ONE summary line; any error → warn + **exit 0**.

## Phase 5 — Wiring / config / docs

- `netlify.toml` — `build.command = "node scripts/predeploy/preserve-mirror.mjs && npx prisma
  generate && npm run quickbuild"`.
- `package.json` — `"predeploy:preserve": "node scripts/predeploy/preserve-mirror.mjs"`.
- `.env.example` — `# Predeploy mirror-preservation guard (server-only)` + `DEPLOY_GUARD_TOKEN=`.
- `app/api/openapi/route.ts` — `'/api/admin/predeploy/preserve'` block: GET + POST, tags
  `` `Admin - Deploy` ``, `securityAdmin`, `x-deploy-guard-token` header param (64-hex).

## Phase 6 — Netlify env var

- `DEPLOY_GUARD_TOKEN` = random 64-hex generated once; upserted via Netlify MCP `manage-env-vars`
  (upsert, production context, scopes `["builds","runtime"]`, site
  `78401e5d-b137-4b6d-94bb-ad1ec8de6b05`); temp file deleted immediately — token never echoed to
  logs/context beyond the writing step.

## Phase 7 — Verification

| Check | Result |
|-------|--------|
| `npm run test` (alone) | **99/99 suites / 1334 pass / 4 skip / 0 fail** (97/1309 baseline + 25) |
| `check-tsc-baseline.mjs` | **46/46, prod 0 → OK (exit 0)** (exact baseline, no regression) |
| `check-doc-sizes.mjs --json` | **OK, 74.9 / 100 KB** (before changelog appends) |
| `npm run lint` | **0 errors** (1139 pre-existing warnings; 4 new TS files clean) |
| `npm run quickbuild` | **185/185 COMPILED OK** |
| Netlify env | `DEPLOY_GUARD_TOKEN` present (builds+runtime, production) — verified via MCP read |

## Phase 8 — Docs (this session)

- `Lessons.md` — Lessons **132** (ISO 2-digit-day `padStart`; fail-open layer attribution) + **133**
  (deploy-time guard order / soft-fail / token rules) + Update Log entry.
- `.agents/changelog/versions-v3.40.md` — §v3.40.1 + §v3.40.2 statuses → **MERGED via PRs #128
  (`15fa0a3`) / #129 (`38ee7da`)**; full **§v3.40.3** section appended (design, ordering contract,
  auth, new files, verification, OpenAPI, legacy finding).
- `.agents/changelog/versions-index.md` — v3.40.3 row at top; v3.40.2 + v3.40.1 rows amended to
  MERGED with merge commits.
- `.agents/CHANGELOG.md` — line-11 row: v3.40.1 "PENDING USER" → MERGED PR #128; v3.40.2 + v3.40.3
  addenda appended (anchored at "sha256 round-trip verified"). Row still ends "No migration; no new
  packages. |".
- `AGENTS.md` — pointer to `versions-v3.40.md` already correct; no edit.
- `TODO.md` — Quick Reference: stale v3.40.1 "In progress/pending user" paragraph replaced with the
  v3.40.3 in-progress paragraph (v3.40.1/v3.40.2 MERGED noted).
- `Primer.md` — Last Updated line prepended; v3.40.3 "Current Project Status" section added above
  v3.40.2.
- `agent-memory.md` — 2026-09-19 v3.40.3 activity entry at top.
- `.agents/session-todos.md` — new v3.40.3 Current section; v3.40.2 section archived as Completed
  (PR #129 MERGED).
- `.agents/handoffs/active/latest.md` — full rewrite for v3.40.3 (SCHEMA v1.1; handoff id
  `v3.40.3-predeploy-mirror-preserve`; tier B; status in-progress; PENDING USER).
- `HANDOFF.md` — Current State YAML refreshed (v3.40.3, handoff_version 1.1).
- Session archive — this `decisions.md` + `flow.md`.

## Phase 9 — Remaining (NOT done — user gate)

- **Commit / push / PR / deploy — PENDING USER APPROVAL** (never auto-commit).
- After deploy: verify production `GET /api/admin/predeploy/preserve` diagnostics + one manual
  `preserve-mirror.mjs --force` run (`mode=backed_up`, `backups/sqlite-mirror-…` Blobs key).
- Optional follow-ups: BUGS.md row-17 remainder; wiki publish; re-run doc-budget after changelog
  appends (was 74.9/100 KB before the appends); `git status` hygiene review.

## Checkpoints

```bash
git log --oneline -6
# 27c0770 docs: update changelog [skip ci]
# 38ee7da Merge pull request #129 from luckyhegde6/fix/mirror-contract-fixes
# 46b360e fix(admin): mirror-contract fixes for BUGS 15/16/17 (v3.40.2)
# e183a3a docs: update changelog [skip ci]
# 15fa0a3 Merge pull request #128 from luckyhegde6/fix/production-analytics-rec-serve
# 32c18a1 docs: v3.40.1 changelog, lessons 128, primer, handoff, session todos [skip ci]
```