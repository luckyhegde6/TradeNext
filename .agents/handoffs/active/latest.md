---
handoff: v3.40.0-agentic-context-orchestration
session_id: 2026-09-18-v340ctx
date: 2026-09-18
branch: feat/agentic-context-orchestration (stacked on ca56a74; parent branch fix/turbopack-tracing-harness)
last_commits: ca56a74 (v3.39.4 Turbopack fix), 0430f67 (v3.39.4 docs/context slim), a7e3709 (= origin/main)
dev: local :3000 (do not kill); MCP/OpenCode 4096 do not kill; pg docker 5432 do not kill
status: awaiting_approval
commit: none for v3.40.0 — implementation has NOT started (Gate 1/2 approval pending)
---

# Handoff — v3.40.0 Agentic Context, Orchestration & Harness (spec+plan drafted, awaiting approval) ← after v3.39.4 context slim + Turbopack tracing fix (committed)

> Superseded: the previous handoff content (v3.35.0 flaky `intelligence.test.ts` CI fix, v3.34.0/3.34.1,
> v3.33.0/3.33.1) is recoverable from git history of this file.

## Context

Two workstreams, one shipped and one at the approval gate.

**v3.39.4 (done, committed)** — the injected instruction files were costing **358 KB (~90K tokens)
per request** because `.opencode/opencode.json` injected 5 whole files; after each compaction they
re-injected instantly, producing a compaction loop. Slimmed to **72.2 KB** and moved history out of
the injected path. Also silenced **33 → 0** Turbopack dynamic-filesystem tracing warnings.

**v3.40.0 (drafted, awaiting approval)** — the user directed a larger epic: tool-output chunking, a
durable memory layer, an orchestrator agent that prefers parallel subagents, subagent health
monitoring, better handoffs, and a stronger code/test/build harness.

## Progress

### Shipped (v3.39.4)

| Commit | What | Files |
|--------|------|-------|
| `0430f67` | docs/context slim 358 KB → 72.2 KB + modularized history + budget guard | 16 (+2243/−1933) |
| `ca56a74` | Turbopack tracing fix (33 → 0 warnings) + clean `netlify.toml` command | 5 (+33/−30) |

Slim detail: `AGENTS.md` 191,017 → 20,260 B; `TODO.md` 134,054 → 20,792 B; NEW
`.agents/changelog/versions-index.md` + `todo-quick-reference-archive.md`, NEW `.agents/INDEX.md`,
NEW `.agents/session-archive/` (`Primer.md` 1159 → 213, `agent-memory.md` 1092 → 373 lines), NEW
context-budget rule + `scripts/dev-checks/check-doc-sizes.mjs`.

### In flight (v3.40.0) — artifacts only, no code

- `.agents/specs/v3.40.0-agentic-context-orchestration.md` (15 sections, DRAFTED)
- `.agents/plans/v3.40.0-agentic-context-orchestration.md` (Phases 0–9, DRAFTED)
- `.agents/sessions/2026-09-18-v340ctx/decisions.md` (D1–D11) + `flow.md`
- `TODO.md` + `.agents/session-todos.md` updated with the epic

Workstreams: **W1** tool-output protocol · **W2** durable memory · **W3** compaction headroom ·
**W4** orchestrator agent · **W5** subagent health monitoring · **W6** handoff upgrade ·
**W7** harness (code/test/build).

## Decisions

See `.agents/sessions/2026-09-18-v340ctx/decisions.md` for full reasoning. Headlines:

- **D3** — **Subagents verified UNUSABLE here** (`OpenCode's free tier can only be used from within
  OpenCode`). Orchestration is capability-detected: Tier A (parallel) / Tier B (chunked-sequential).
- **D6** — Two-tier memory: `.remember/now.md` (local rolling) + memory MCP graph (cross-session).
- **D7** — The remaining compaction loop is the **transcript**, not injected docs → redirect large
  output to `.context/out/*.txt`, then grep/slice.
- **D8** — Raise `compaction.reserved` 10000 → 30000 (config change, needs permission).
- **D9** — **No orchestrator agent exists** (13 profiles, all `mode: subagent`) → create one.
- **D11** — No workstream may be blocked on Tier A.

## Blockers

| Blocker | Impact | Status |
|---------|--------|--------|
| Subagents fail (provider tier) | Tier A untestable | **Accepted** — Tier B fallback designed (D3/D11) |
| Gate 1/2 approval not yet given | Implementation cannot start (repo rule) | **Awaiting user** |
| `@netlify/plugin-emails` removal | Emails function still fails on Netlify | Needs **Netlify UI** action by user |

## Learnings

1. Shrinking *injected* files does not stop a compaction loop once the *transcript* is the leak —
   measure both before optimising either.
2. Verify a capability before designing around it: 4 planned parallel subagents all failed at the
   provider tier; assuming they worked would have derailed the epic.
3. Age-chunk only append-only logs. `Lessons.md` is a live rulebook — old entries are active rules.

## Next Steps

1. **Human approval of spec (Gate 1) + plan (Gate 2).**
2. Phase 0 baseline → Phase 1 (W1) → … → Phase 9, on `feat/agentic-context-orchestration` only.
3. Ask before Phase 3 (`compaction.reserved` edit).
4. Merge/PR only on explicit user request — never push `main`.

## Subagent Status

| Dispatch | Tier | Outcome |
|----------|------|---------|
| 4 × `explore` (facts A1–A4) | A | **FAILED** — `provider-blocked` (free tier), no retry attempted |
| Fallback fact-gathering | B | **COMPLETED** — 2 digests via `.context/out/facts-digest.txt`, `f2.txt` |

## Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | **46** = exact baseline |
| `npm run quickbuild` | **0 Turbopack warnings**, 185/185 pages |
| `check-doc-sizes.mjs` | **OK 72.2 KB / 100 KB** |
| pre-commit hook ×2 | passed |
| `npm run test` / `test:e2e` | not run this session (no `lib/`/UI change yet) |

## Checkpoints

```bash
git log --oneline -3
# ca56a74 fix(build): silence 33 Turbopack dynamic-filesystem-access tracing warnings
# 0430f67 docs(context): slim injected instruction files (358KB->72KB) + modularize history + budget guard
# a7e3709 docs: update changelog [skip ci]

git status --short
#  M .agents/session-todos.md
#  M TODO.md
# ?? .agents/plans/v3.40.0-agentic-context-orchestration.md
# ?? .agents/sessions/2026-09-18-v340ctx/
# ?? .agents/specs/v3.40.0-agentic-context-orchestration.md
```

## Session archive

Prior sessions: `.agents/sessions/` · Chunked history: `.agents/session-archive/` ·
Version history: `.agents/changelog/versions-index.md`
