# Session Flow — 2026-09-11 — v3.35.0 Flaky intelligence.test.ts CI fix

> Execution trace for the v3.35.0 session (branch `fix/leader-watchdog-self-heal`).
> Working tree: `lib/__tests__/intelligence.test.ts` (+21 test-only) + doc files (docs phase done).
> Commit pending user approval; no push/merge/deploy of PR #118 without explicit approval.

## Objective
Kill the "documented pre-existing flake" (`intelligence.test.ts`, since v3.25.0):
the un-awaited `prisma.intelligenceCache.upsert` in `setIntelligenceCache`
(`lib/services/intelligence/cache.ts` :101-124) raced the real-Postgres `beforeEach`
`deleteMany` teardown (:73-80) -> stale row -> spurious `INTELLIGENCE_CACHE_HIT` ->
flaky failures at :187/:246/:279. Fix = full prisma mock inside the suite (zero
real-DB writes in tests); first fully-green full run.

## Execution path
1. **Root-cause read** — `lib/services/intelligence/cache.ts` :101-124 (fire-and-forget
   `upsert`, memory-first write-through) + `lib/__tests__/intelligence.test.ts` :70-95
   (real-Postgres `beforeEach` deleteMany on `intelligenceCache`) + :180-285 (flake
   points :187/:246/:279 assert cache-hit sequences after re-runs).
2. **Mock pattern precedent** — `lib/__tests__/intelligenceCache.test.ts` :13-24
   (inline `jest.mock("@/lib/prisma", () => ({ __esModule: true, default: {...} }))`).
3. **Fix** — `lib/__tests__/intelligence.test.ts` (+21, single file):
   - `// ─── Mock Prisma ───` + `jest.mock("@/lib/prisma", () => ({ __esModule: true,
     default: { intelligenceCache: { findUnique: fn→null, upsert: fn→{}, delete:
     fn→{}, deleteMany: fn→{count:0}, count: fn→0, findMany: fn→[] } } }))` inserted
     between the `beforeEach` close and `// ─── Tests ───`.
   - `jest.clearAllMocks()` keeps the impls while resetting call history per test.
   - No production code touched (D2) — `cache.ts` unawaited write is intentional.
4. **Verification**
   - Targeted: `intelligence.test.ts` **13/13 PASS**
   - Full: **86/86 suites / 1170 pass / 4 skip / 0 fail** — FIRST fully-green full
     run (no more pre-existing-flake asterisk). Benign noise: `❌ ERROR | Intelligence
     cache DB write failed` (sibling test), teardown `ReferenceError` (2 services),
     "Jest did not exit" — none affect pass/fail.
   - `npx tsc --noEmit` **46 = exact baseline (0 new)**; no migration; no new packages.
5. **Docs phase (DONE)** — AGENTS.md v3.35.0 row · CHANGELOG index row +
   `versions-v3.35.md` · TODO.md row · Primer.md (Last Updated + `### v3.35.0`
   subsection under Current Project Status) · Lessons.md **#115** + Update Log bullet ·
   agent-memory.md entry · `.agents/session-todos.md` (heading + DONE bullet + PR #118
   `+ v3.35.0`) · HANDOFF.md (:15-16 yaml, :21 consolidated bullet, :35 Next, :105
   v1.14 version-history row) · `latest.md` rewrite · session archive
   `2026-09-11-intelligence-test-fix/` (decisions.md + flow.md).

## Code touched
- `lib/__tests__/intelligence.test.ts` (+21 test-only) — the ONLY code file.
- Doc files (see docs phase list above).

## git status (working tree)
- Branch `fix/leader-watchdog-self-heal` (HEAD `05b91e8` = v3.34.1 merge; v3.33.0
  `6e22eca` + v3.33.1 `f86d9d0` + v3.34.0 `5d754b7` + v3.34.1 `d91fb01` all merged
  into PR #118 branch)
- Modified: `lib/__tests__/intelligence.test.ts` (+21) + docs (AGENTS.md, CHANGELOG,
  TODO.md, Primer.md, Lessons.md, agent-memory.md, session-todos.md, HANDOFF.md,
  latest.md)
- Untracked: `.agents/changelog/versions-v3.35.md`,
  `.agents/sessions/2026-09-11-intelligence-test-fix/` (decisions.md + flow.md)

## Next
`/pre-commit-check` (delete `.dev-otel.log` if present; verify git status) -> present
full diff (code +21 + docs) -> commit ONLY on explicit user approval ->
**no push/merge/deploy of PR #118 without explicit user approval**.