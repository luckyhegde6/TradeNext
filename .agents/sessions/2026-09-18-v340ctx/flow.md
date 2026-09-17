# Flow — 2026-09-18 — v3.40.0 agentic context / orchestration / harness

Branch: `feat/agentic-context-orchestration` (off `ca56a74`)
Session dir: `.agents/sessions/2026-09-18-v340ctx/`

---

## Execution path (this session)

1. **Completed in-flight v3.39.4 batch** (approved earlier as 2 commits)
   - commit `0430f67` — docs/context slim (16 files, +2243/−1933)
   - commit `ca56a74` — Turbopack tracing fix (5 files, +33/−30)
   - pre-commit hook passed on both (TypeScript clean).

2. **Received new directive (mid-flow)** — >hotfix: own branch, todos, handoff, decisions,
   document + test, parallel subagents, orchestrator self-improvement, subagent health
   monitoring, harness for code/test/build.
   - Per the standing rule, `.agents/session-todos.md` + `TODO.md` were updated **before**
     continuing.

3. **Created branch + session dir**
   - `git checkout -b feat/agentic-context-orchestration`
   - `mkdir .agents/sessions/2026-09-18-v340ctx`

4. **Diagnosed the real cause of the compaction loop**
   - injected docs already 72.2 KB → loop is caused by the **conversation transcript**
     (large tool outputs + long summaries re-sent every request), not by injected files.
   - `compaction.reserved: 10000` ≈ no headroom.

5. **Resolved `.remember`** — an existing fully-gitignored local memory dir; `now.md` holds
   `## HH:MM | <slug> <summary>` entries.

6. **Attempted parallel research via 4 subagents → ALL FAILED**
   - `OpenCode's free tier can only be used from within OpenCode`
   - recorded as hard constraint **D3**; switched to Tier B (chunked-sequential).

7. **Tier B fact-gathering** (this is the new protocol in action)
   - redirected digests to `.context/out/facts-digest.txt` and `.context/out/f2.txt`, then read
     them; **no large inline reads**.
   - extracted: agent/command inventory, hook + workflow inventory, spec/plan template headings,
     decisions/flow rule headings, handoff schema headings, root configs (`jest.config.cjs`,
     `playwright.config.ts`), `.agents/docs/` inventory, `opencode.json` `agent`/`command` wiring.

## Files created this session

| Path | Purpose |
|------|---------|
| `.agents/session-todos.md` | updated mid-flow with the v3.40.0 epic section |
| `TODO.md` | live-status block for v3.39.4 → v3.40.0 |
| `.agents/sessions/2026-09-18-v340ctx/decisions.md` | D1–D11 |
| `.agents/sessions/2026-09-18-v340ctx/flow.md` | this file |
| `.context/out/facts-digest.txt` | Tier B digest #1 (gitignored scratch) |
| `.context/out/f2.txt` | Tier B digest #2 (gitignored scratch) |

## Files modified this session

| Path | Change |
|------|--------|
| `.agents/session-todos.md` | commit 1/2 + 2/2 marked done; new v3.40.0 epic block |
| `TODO.md` | in-progress line for v3.39.4 (slim + Turbopack) |
| `.context/out/*.txt` | new scratch digests (gitignored) |

## Commits on this branch (to date)

| Commit | Message | Files |
|--------|---------|-------|
| `ca56a74` | fix(build): silence 33 Turbopack dynamic-filesystem-access tracing warnings | 5 (+33/−30) |

> `0430f67` (docs/context slim) sits on the parent branch `fix/turbopack-tracing-harness`.

## Verification performed

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | 46 errors = exact pre-change baseline (no regressions) |
| `npm run quickbuild` | BUILD_OK, **0 Turbopack warnings** (was 33), 185/185 static pages |
| `node scripts/dev-checks/check-doc-sizes.mjs` | OK — injected total **72.2 KB** / 100 KB budget |
| pre-commit hook (both commits) | passed — "TypeScript: production files clean" |
| 4 × `task` subagent | **FAILED** — provider tier restriction (D3) |

## Not yet started (blocked on approval)

All implementation workstreams W1–W7 in `.agents/specs/v3.40.0-agentic-context-orchestration.md`
— no production code, config, or rule has been changed for the epic yet.

---

## Phase log (implementation)

### Phase 0 — Baseline — DONE

| Metric | Value |
|--------|-------|
| `npx tsc --noEmit` errors | 46 (baseline; regression if > 46) |
| `npm run quickbuild` | OK — `✓ Compiled successfully in 11.0s` |
| Static pages | 185 / 185 |
| Turbopack warnings | 0 (was 33 before `ca56a74`) |
| Injected doc total | 72.8 KB / 100 KB |

Recorded in `.context/out/phase0-baseline.txt`; build log `.context/out/quickbuild-phase0.log`.
Note: doc total rose 72.2 → 72.8 KB because `TODO.md` gained the v3.40.0 status block.

### Phase 1 (W1) — Tool-output protocol — DONE

Files:
- NEW `scripts/dev-checks/chunk-output.mjs` — splits a capture into `<name>.part-NN.txt` + `<name>.index.md`;
  each part header records its **original** line range; deterministic + idempotent (stale parts pruned);
  Node built-ins only; exit 1 on missing input / bad `--lines`, exit 0 on empty input.
- NEW `.agents/rules/tool-output-protocol.md` — the redirect → slice/grep → chunk protocol,
  retention rules for `.context/`, and an anti-pattern table (incl. the `findstr /i` OR-words trap).
- NEW `lib/__tests__/chunk-output.test.ts` — **12 tests, all passing** (50.3 s). CLI-level by design
  to avoid Jest (CJS + jsdom) ↔ ESM `.mjs` transform interop; also asserts `.context/` and
  `.remember/` are git-ignored.
- MOD `.agents/INDEX.md` — registered the protocol + the chunker script.
- MOD `.agents/rules/session-memory-rules.md` §7 — cross-linked the protocol.

Verified: 9 chunks from the 179-line digest with correct ranges; `fc /b` idempotency check passed;
error paths return exit 1 with usage; empty input writes nothing.

### Phase 2 (W2) — Durable memory — DONE

- NEW `.agents/rules/durable-memory.md` — two-tier model (Tier 1 `.remember/now.md` rolling,
  gitignored; Tier 2 memory MCP graph, durable + queryable), controlled 7-value `entityType`
  vocabulary, query-before-read decision rule, anti-pattern table.
- `.agents/INDEX.md` + `session-memory-rules.md` section 7 — registered / cross-linked.
- `.remember/now.md` — normalised (fixed the Windows TIME-variable leading-space + centisecond
  quirk), added a self-documenting header.
- **Found + fixed a real defect in the rule itself**: `memory/search_nodes` is a *literal
  contiguous substring* match of the **entire** query — not tokenised or ranked. A 5-word
  natural-language query returned **0 hits against a graph that demonstrably contained the
  answer**. Left undocumented, the query-before-read rule would silently fail and send agents
  back to re-reading docs — the exact loop W2 exists to prevent. Added a "Query semantics"
  section + anti-pattern row, and recorded a `gotcha` entity in the graph.
- Commits `40181c4` (rule) + `db08255` (correction).

### Phase 3 (W3) — Compaction headroom — DONE

- `.opencode/opencode.json` `compaction.reserved` **10000 → 30000** (user-approved; sensitive op).
- Verified: `JSON.parse` OK (`reserved: 30000`); `check-doc-sizes.mjs` still parses the
  `instructions` array → **72.8 KB / 100 KB**, 5/5 `ok`.
- Revert is a one-line change. Effect is host-side, so it is observed as fewer compaction
  *occurrences* per unit of work, not as a smaller per-request cost.

### Phase 4 (W4) — Orchestrator agent — DONE

- NEW `.agents/agents/orchestrator.md` — decomposition policy (independence test → parallel vs
  sequential), capability probe, health rules, context discipline, boundaries, handoff triggers.
- NEW `.agents/commands/orchestrate.md` — `/orchestrate` template + required output shape.
- MOD `.opencode/opencode.json` — registered `orchestrator` in `agent` and `orchestrate` in `command`.
- MOD `.agents/RULES.md` section 0 — normative line: ≥2 independent workstreams → prefer parallel
  dispatch, else Tier B; always declare the tier used.
- MOD `AGENTS.md` (compact row), `.agents/AGENT-SKILL-MATRIX.md` (core matrix + command inventory),
  `.agents/INDEX.md` (section 6 rows).
- **Design decision**: `mode: "primary"`, not `subagent` — subagents cannot dispatch subagents, so
  a subagent orchestrator could never fulfil its mandate. The `tools` block is deliberately omitted
  so the agent inherits defaults (including `task` for dispatch + Write/Edit for handoffs) instead
  of inventing an unverified tool key.

Verified: `JSON.parse` OK — `agents=16 (primary=3, subagents=13)`, `commands=11`,
`orchestrate.agent=orchestrator`, template resolves; both new files present; budget
**73.0 KB / 100 KB** (AGENTS.md 19.8 → 20.0 KB, +0.2 KB).

### Phase 5 (W5+W6) — Subagent health + handoff upgrade — DONE

- NEW `.agents/agents/orchestrator-health.md` — per-stream-type timeout budget table (60 s → 900 s,
  120 s default), liveness check at 50 %/100 % of budget, max-1-retry rule, closed failure taxonomy
  (`provider-blocked` · `timeout` · `stalled` · `error` · `completed`) with retry permitted only for
  the transient three, and a "why not retry until it works" rationale.
- MOD `.agents/handoffs/SCHEMA.md` — bumped to **v1.1**: §8 `## Subagent Status` (one bounded row
  per dispatch, closed outcome vocabulary) + §9 `## Handoff Summary` (≤ 15 lines, resumable without
  the conversation) + an explicit **Backwards Compatibility** clause (1.1 is strictly additive; 1.0
  files stay valid; sections 1–7 must never be deleted to "upgrade").
- MOD `.agents/handoffs/flow/agent-to-agent.md` — rewrote the diagram with the orchestrator as the
  entry point for ≥2 independent workstreams, and added a **Tier Downgrade Path** (probe → Tier A/B;
  per-stream stalled/timeout/error → retry once → Tier B; provider error → no retry, whole-turn B).
- MOD `.agents/handoffs/active/latest.md` — rewritten under v1.1 (`status: in_progress`,
  `tier: B`), W1–W4 marked done with hashes, new Learnings (incl. the memory-search gotcha),
  refreshed Verification table, Subagent Status + Handoff Summary sections.

Verified: frontmatter well-formed; handoff contains both new sections; no section 1–7 removed.

### Phase 6 (W7) — Harness — DONE

- NEW `scripts/dev-checks/check-tsc-baseline.mjs` — runs `npx tsc --noEmit -p tsconfig.json`, counts
  `error TS…` lines, splits **total** vs **prod** (errors outside `__tests__/`, matching the hook's
  classification), compares against a committed baseline, fails on regression, `--update` re-records,
  `--json` for CI. Exit 0 ok / 1 regression / 2 tsc-never-ran.
- NEW `scripts/dev-checks/tsc-baseline.json` — `{ "total": 46, "prod": 0, "recorded": "2026-09-18" }`,
  committed so CI enforces the same number the pre-commit hook assumes.
- MOD `scripts/dev-checks/check-doc-sizes.mjs` — extracted `checkInjectedBudget()` (spec §4A signature)
  + `--json` for CI + a `.context/out/` retention warning (advisory above 5 MB; never fails the gate).
- MOD `.githooks/pre-commit` — NEW section 8: advisory context-budget line (sections 1–7 untouched).
- MOD `.github/workflows/quality-gate.yml` — NEW job `context-budget` (no `npm ci` — built-ins only, so
  it runs in seconds) + NEW job `tsc-baseline`; the old `Typecheck` step became **Build + Turbopack
  warning gate** (builds, then fails on any warning line other than `npm warn`).
- **Spec deviation (recorded)**: §4A prose says *extend* `check-doc-sizes.mjs` ("not a new one") while
  the spec's file table lists a NEW `check-context-budget.mjs`. Followed the prose + the plan: extended
  the existing script and did **not** create `check-context-budget.mjs`. Phase 7's test is therefore
  `check-doc-sizes.test.ts`, not `check-context-budget.test.ts`.
- **Two self-inflicted bugs found by running the gate before trusting it**: (1) `prod` was computed as
  `total − testLines` (the *test* count, mislabelled) → a bogus "+46 prod regression"; fixed to count
  the non-test lines. (2) the failure path called both `emit()` and `console.error()`, printing the
  block twice; the helper was split into `emitJson()`.

Verified: `check-tsc-baseline.mjs` → `total 46 / prod 0 / delta +0` → **OK, exit 0** (exactly the
Phase 0 baseline); `--json` → `{ ok:true, total:46, prod:0, delta:0, newErrors:[] }`.
`check-doc-sizes.mjs` → **73.0 KB / 100 KB**, `--json` valid (5 files; `.context/out` 27,098 B, within
threshold). `quality-gate.yml` → `js-yaml` parse OK; jobs = `context-budget, tsc-baseline, quality-gate`.
The Turbopack gate is grounded on measurement, not a guess: `findstr /i "warn"` over the 306-line
Phase 0 build log returns **0** matches.

### Phase 7 (tests) — DONE

- NEW `lib/__tests__/check-tsc-baseline.test.ts` — 9 tests. CLI-spawn style (ESM script, CJS+jsdom
  Jest). A `makeHarness()` mirrors `<root>/scripts/dev-checks/<script>` in a tmpdir and a fake
  `fake-tsc.cjs` supplies deterministic output through the script's documented test seam
  `TSC_BASELINE_CMD`, so counts are asserted without a real tsc run.
  Covers: equal-to-baseline passes; **classification guard** (3 errors = 1 prod + 2 test → `prod` is
  **1**, pinning the transposed-count bug); prod regression → exit 1 + deltas + `newErrors`; total-only
  regression → exit 1; improvement → exit 0 with negative deltas; `--update` rewrites the baseline;
  documented default fallback (46/0) when the baseline file is absent (47 → 1, 46 → 0); empty tsc
  output → exit 2. Plus a `committed tsc baseline` describe pinning the real file at 46 / 0 / ISO date.
- NEW `lib/__tests__/check-doc-sizes.test.ts` — 14 tests, two layers. Real-repo read-only assertions:
  exit 0 + human output shape; `--json` shape (`ok`, `total`, `totalBudget` 100 KB, `fileBudget`
  32 KB, `files[]`, `scratch.{path,bytes,withinThreshold}`); `files[].path` order equals
  `config.instructions` and each `bytes` equals `statSync`; within budget. Harness failure modes:
  33 KB single file → exit 1 + `OVER`; 4 × 30 KB = 120 KB total → exit 1 while every per-file `ok` is
  true; missing file → exit 1, human `NOT FOUND` + `missing: true`; malformed JSON → exit 1; no
  `instructions` array → exit 1; budget failure points at `.agents/INDEX.md`. Scratch: > 5 MB → exit 0
  + `WARN` + `withinThreshold: false`; 10 KB → no `WARN` + `true`. Plus a wiring describe asserting the
  hook references `check-doc-sizes.mjs` and CI references both scripts.

**Serious self-inflicted bug caught here — the tests were corrupting the repo.** The helper was
`run(args, cwd, tscCmd)` and hardcoded the repo `SCRIPT` path, so every "harness" test executed the
**real** script against the **real** repo instead of the temp copy `makeHarness()` had just made. Two
consequences: (1) all harness assertions failed with real-repo data (doc sizes showed `./README.md`,
tsc showed `baseline 46`); (2) the `--update` test **overwrote the committed
`scripts/dev-checks/tsc-baseline.json`** with `{ total: 2, prod: 1 }` — silently poisoning the gate that
CI and the pre-commit hook trust. Diagnosed from the symptom `baseline.total` read back as `2`.
Fix: `run(script, args, cwd, tscCmd)` takes the script path explicitly — harness tests pass
`harness.script`, real-repo tests pass `SCRIPT`. Added defence in depth so this class of mistake is
impossible to repeat silently: both suites snapshot the protected real file in module scope and assert
it byte-identical in `afterAll` (tsc → `tsc-baseline.json`, doc-sizes → `.opencode/opencode.json`).
Recovery: `git checkout -- scripts/dev-checks/tsc-baseline.json` (verified back to 46 / 0 / 2026-09-18).
Also noted: the script's `--update` writes a **UTC** date (`2026-09-17`), one day behind the IST
`2026-09-18` in the committed file — cosmetic, and the test asserts the ISO shape only.

Verified: `npm run test -- <both suites>` (run **alone**) → **23/23 passing**; real baseline re-read as
`total 46 / prod 0`; `check-doc-sizes.mjs` still **73.0 KB / 100 KB**. `git status --short` after the run
shows only the three intended entries — no stray repo writes.

### Next up

Phase 8 docs → Phase 9 verification.

Phase 8: `TODO.md` + `.agents/session-todos.md` + `Primer.md` + `agent-memory.md` + `Lessons.md`
(3 lessons: free-tier subagents unusable → verify capability before designing around it; large tool
outputs are the real context leak, not injected docs; age-chunk only append-only logs, never a live
rulebook) + `.agents/CHANGELOG.md` + `.agents/changelog/versions-index.md` + `versions-v3.40.md`.
Phase 9: full tsc baseline, `npm run test` alone, doc-size budget, final handoff under SCHEMA v1.1.

