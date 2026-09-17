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

### Next up

Phase 6 (W7) harness → Phase 7 tests → Phase 8 docs → Phase 9 verification.

