# Implementation Plan — Predeploy Mirror Preservation Guard

> Generated from spec: `.agents/specs/14-predeploy-mirror-preserve.md`
> Save to `.agents/plans/14-predeploy-mirror-preserve.md`

## Spec Reference

- **Spec**: `.agents/specs/14-predeploy-mirror-preserve.md`
- **Branch**: `feature/predeploy-mirror-preserve`
- **Created**: 2026-09-19

---

## Implementation Steps

> Ordered. Each step is atomic — implement → verify → mark done. Never skip a failing step.

### Phase 1: SQLite primitives (foundation)

1. **Widen `SyncTrigger`** in `lib/sqlite.ts:129` → add `"deploy"` → verify: `node scripts/dev-checks/check-tsc-baseline.mjs` still `46/46`
2. **Export `getMirrorBlobsStore`** (`lib/sqlite.ts:930`: `async function` → `export async function`) → verify: grep shows the export; tsc baseline unchanged
3. **Widen `MirrorBlobsStoreLike`** (`lib/sqlite.ts:905`) with optional `list?` + `delete?` members → verify: tsc baseline unchanged (optional members keep existing doubles compiling)

### Phase 2: Backup service

4. **Create `lib/services/mirrorBackup.ts`** — `MIRROR_BACKUP_PREFIX` / `MIRROR_BACKUP_KEEP` / `MIRROR_BACKUP_MAX_BYTES`, `mirrorBackupKey`, `createMirrorBackup`, `listMirrorBackups`, `pruneMirrorBackups`, `MirrorBackupEntry` → verify: `npx tsc --noEmit` (0 new errors)
5. **Write `lib/__tests__/mirrorBackup.test.ts`** (11 cases per spec §12) → verify: `npm run test -- mirrorBackup`

### Phase 3: Endpoint

6. **Create `app/api/admin/predeploy/preserve/route.ts`** — `isGuardAuthorized` (length-check + `timingSafeEqual`, admin-session fallback), `POST` in the exact snapshot→backup→push order, `GET` read-only → verify: `npx tsc --noEmit`
7. **Write `lib/__tests__/predeployPreserveRoute.test.ts`** (9 cases per spec §12) → verify: `npm run test -- predeployPreserve`

### Phase 4: Script + wiring

8. **Create `scripts/predeploy/preserve-mirror.mjs`** — CONTEXT gate, `--force`, token-missing skip, 20s `AbortSignal.timeout`, single summary line, always `exit 0` → verify: `node scripts/predeploy/preserve-mirror.mjs` with no env exits 0 and makes no network call
9. **Add `package.json` script** `"predeploy:preserve": "node scripts/predeploy/preserve-mirror.mjs"` → verify: `npm run predeploy:preserve` runs and skips
10. **Update `netlify.toml`** build command → guard first → verify: TOML parses; `CONTEXT` gate keeps previews inert
11. **Update `.env.example`** with the `DEPLOY_GUARD_TOKEN` placeholder → verify: no real value committed

### Phase 5: API docs

12. **Document the route in `app/api/openapi/route.ts`** (GET + POST, `security: securityAdmin`) → verify: Swagger renders both operations

### Phase 6: Verification

13. **Full verification sweep** → `npx tsc --noEmit`, `node scripts/dev-checks/check-tsc-baseline.mjs`, `npm run test`, `npm run lint`, `node scripts/dev-checks/check-doc-sizes.mjs`, `npm run quickbuild`
14. **Manual live check** against the running dev server (P6003 still active → expect `mode: "backed_up"`) → verify: response shape matches spec §7
15. **Confirm no Prisma change** → `git status prisma/` clean; no migration file created

### Phase 7: Production config (operator-approved)

16. **Set `DEPLOY_GUARD_TOKEN` in Netlify** with `builds` + `runtime` scope via the Netlify MCP → verify: env var listed with the correct scopes; value never printed

### Phase 8: Documentation

17. **Update `.agents/changelog/versions-v3.40.md`** + `versions-index.md` → verify: version row added
18. **Update `BUGS.md`** if this closes a tracked item → verify: row updated
19. **Update `Primer.md`** status → verify: current status reflects the new workstream
20. **Update `agent-memory.md`** activity log → verify: entry added
21. **Update `Lessons.md`** if a reusable pattern emerged → verify: numbered lesson added
22. **Update `.agents/session-todos.md`** + `.agents/handoffs/active/latest.md` → verify: resume context accurate
23. **Correct the stale "PR #129 open" wording → MERGED `38ee7da`** across the 7 files edited in the discarded temp patch → verify: no "open" references remain
24. **Refresh the stale root `HANDOFF.md`** (still says "v3.40.1 IN PROGRESS") → verify: matches merged reality
25. **Create session memory** `.agents/sessions/2026-09-19-predeploy-guard/{decisions.md,flow.md}` → verify: both files exist with spec + plan references
26. **Publish the wiki page** for the mirror-preservation flow (via `wiki-creator`) → verify: page renders with GitHub-safe mermaid

### Phase 9: Codebase review deliverable

27. **Report the `deploy.yml` finding** (legacy `nwtgck/actions-netlify` publishing `./out` vs the real SSR deploy publishing `.next`) as a documented finding → verify: recorded in the review output + session-todos; **not modified** in this workstream

---

## Test Strategy

### Unit Tests (Required)

| Test | File | What It Verifies |
|------|------|------------------|
| Key format | `mirrorBackup.test.ts` | `mirrorBackupKey` URL-safe + deterministic |
| Key ordering | `mirrorBackup.test.ts` | Lexicographic == chronological |
| Null bytes → null | `mirrorBackup.test.ts` | No upload on empty input |
| Upload + byte length | `mirrorBackup.test.ts` | One key written, size returned |
| Retention prune | `mirrorBackup.test.ts` | Oldest deleted beyond `keep` |
| Blobs down → null / `[]` | `mirrorBackup.test.ts` | Fail-open, never throws |
| Delete failure tolerated | `mirrorBackup.test.ts` | Prune continues |

### Integration Tests (API Route)

| Test | What It Verifies |
|------|------------------|
| Valid token + breaker closed → 200 `pushed` | Happy path |
| Valid token + breaker open → 200 `backed_up` | Hold path (current prod reality) |
| SQLite not ready → 200 `skipped` | Degrade path |
| Bad token, no session → 401 + zero side effects | Auth boundary |
| Token unset → 503 | Misconfiguration is explicit, never open |
| Admin session without token → 200 | Dual-auth path |
| Backup attempted before push | Ordering contract (spec §4C) |
| Push throws → 500 | Snapshot/backup already persisted |
| GET → no pushes | Read-only guarantee |

### E2E Tests

- [ ] N/A — no UI change (justified in spec §12). Manual local run instead.

---

## Verification Checklist

```bash
# Type checking (baseline 46 total / 0 production)
npx tsc --noEmit
node scripts/dev-checks/check-tsc-baseline.mjs

# Tests — RUN ALONE, never chained with ';'
npm run test

# Lint
npm run lint

# Docs budget
node scripts/dev-checks/check-doc-sizes.mjs

# Production build (0 Turbopack warnings)
npm run quickbuild

# Script smoke test (must exit 0, no network call)
node scripts/predeploy/preserve-mirror.mjs
```

---

## Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| Guard adds a hard dependency to the deploy path | Soft-fail + `exit 0` + 20s timeout + production-only gate | No |
| Guard blocks/slows the build if the site hangs | 20s `AbortSignal.timeout`, then proceed | No |
| Live site may be the very thing that is broken | Script warns and continues; the canonical snapshot upload still protects the mirror | No |
| Backup storage growth | Pruned to newest 5, 200 MB cap each | No |
| Window B gap between deploys (no shutdown flush) | Out of scope here; snapshot-first ordering narrows it at deploy time | **Yes** |
| Legacy `.github/workflows/deploy.yml` confuses future readers | Documented as a finding for a separate cleanup decision | **Yes** |
| Netlify build scope exposes the token to the build container | Token is build+runtime only, never logged, rotate-able | No |

---

## Documentation Checklist

- [ ] **AGENTS.md** — commands table entry for `predeploy:preserve`
- [ ] **CHANGELOG** — `.agents/changelog/versions-v3.40.md` detail + `versions-index.md` row
- [ ] **TODO.md** — quick-reference note
- [ ] **Primer.md** — current project status
- [ ] **agent-memory.md** — activity log entry
- [ ] **Lessons.md** — new lesson (Netlify ordering: build-step > GH Action for pre-deploy work)
- [ ] **Session memory** — `decisions.md` + `flow.md`
- [ ] **session-todos.md** — current session updated
- [ ] **handoffs/active/latest.md** — resume context
- [ ] **OpenAPI** — both operations documented, secure
- [ ] **Wiki** — mirror-preservation page published
- [ ] **Stale refs fixed** — "PR #129 open" → MERGED; root `HANDOFF.md` refreshed

---

## Pre-Commit Gate

1. `npx tsc --noEmit` — 0 new errors
2. `node scripts/dev-checks/check-tsc-baseline.mjs` — 46/46, prod 0
3. `npm run test` — all pass (`npm run test` alone, never chained)
4. `npm run lint` — 0 errors
5. `git status` — no junk artifacts, no secrets in the diff, no token anywhere
6. Documentation updated per the checklist above
7. `.agents/rules/checklist.md` validated
