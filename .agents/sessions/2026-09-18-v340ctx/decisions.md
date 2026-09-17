# Decisions — 2026-09-18 — v3.40.0 agentic context / orchestration / harness

Branch: `feat/agentic-context-orchestration` (stacked on `fix/turbopack-tracing-harness` @ `ca56a74`)
Session dir: `.agents/sessions/2026-09-18-v340ctx/`

---

## D1. Finish the approved v3.39.4 batch on its existing branch, then branch for the epic

The v3.39.4 work (doc slim + Turbopack tracing) was already approved as a 2-commit split
(`0430f67` docs/context, `ca56a74` Turbopack + netlify.toml). It was in flight when the new
directive arrived.

**Decision**: close both commits on `fix/turbopack-tracing-harness` (done), then create a
**new** branch for the larger epic. **Why**: the user explicitly stated the new work is
"greaterr than a hotfix" and must go on a separate branch; mixing it into the in-flight
branch would make two unrelated change-sets share a review surface and a revert boundary.

## D2. Epic branch is *stacked*, not branched from main

`feat/agentic-context-orchestration` is created from `ca56a74` (i.e. on top of the v3.39.4
commits), not from `main`.

**Why**: the epic *depends on* the slim work (the doc-size budget it enforces only exists
because of the slim), and `check-doc-sizes.mjs` is already committed there. Branching from
`main` would either duplicate or drop that dependency. `main` stays untouched; the stack is
`main → fix/turbopack-tracing-harness → feat/agentic-context-orchestration`.

## D3. Subagent execution is UNAVAILABLE in this environment (hard constraint, measured)

Attempted 4 parallel `task` subagents (read-only exploration). **All 4 failed** with:

```
Error from provider (Console): OpenCode's free tier can only be used from within OpenCode
```

**Decision**: do **not** assume parallel subagents are usable. Design the orchestration policy
as **capability-detected with graceful degradation**:

- **Tier A (preferred)** — parallel subagents, when the provider allows it.
- **Tier B (fallback, current reality)** — chunked-sequential inline execution using the
  tool-output protocol (D7) so a single agent still keeps context flat.

**Why**: recording the measurement prevents future agents from burning turns re-discovering
the same wall, and a policy that *requires* subagents would be dead on arrival here.

## D4. `Lessons.md` is deliberately NOT age-chunked

Considered chunking `Lessons.md` (1,626 lines) by age like `Primer.md` / `agent-memory.md`.

**Decision**: keep it monolithic. **Why**: `Lessons.md` is a **live rulebook**, not an
append-only log — old entries (#2 middleware runtime, #7 import order, #21 mandatory docs)
are still *active normative rules*. Age-chunking would silently delete guidance from the
injected/reference path. If it ever needs modularising, the correct axis is **topic**
(`.agents/lessons/<topic>.md` + index), never age.

## D5. `.remember/` is adopted as-is, not replaced

Discovered `.remember/` is an existing, **fully gitignored** local memory dir
(`.remember/.gitignore` = `*`, `git ls-files .remember` = 0) containing `now.md`, `logs/` (28
files), `tmp/`.

**Decision**: standardize on the existing `now.md` convention
(`## HH:MM | <session-slug> <one-line summary>`) instead of inventing a parallel file.
**Why**: minimal change, the convention already works, and inventing a second memory file
would create two sources of truth.

## D6. Two-tier memory: `.remember/now.md` (local, rolling) + memory MCP (cross-session graph)

**Decision**: split responsibilities rather than using one store.

- `.remember/now.md` — local, timestamped, one line per significant event; cheap to append,
  never injected, never committed.
- memory MCP graph — durable, queryable **facts** (paths, conventions, invariants, gotchas)
  that survive across sessions and can replace re-reading large docs.

**Why**: re-reading docs is the dominant context cost; a distilled graph answers "where is X /
what is the rule for Y" without loading the source file.

## D7. Tool outputs must not land in context — redirect, then slice

**Diagnosis**: the injected docs are already down to **72.2 KB (~18K tokens)**, so the
remaining compaction loop is **not** caused by injected files. It is caused by the
**conversation transcript**: large tool outputs and long summaries are re-sent on every
request and stay resident after compaction, and `compaction.reserved: 10000` leaves almost no
headroom.

**Decision**: adopt a hard protocol — any potentially large output is redirected to
`.context/out/<name>.txt`, then inspected with `grep`/bounded slice reads. **Why**: this is
the only lever that actually reduces the resident transcript; shrinking `instructions` further
has already hit diminishing returns.

## D8. `compaction.reserved` 10,000 → higher (requires permission)

**Decision**: raise `compaction.reserved` in `.opencode/opencode.json` to give real headroom so
compaction fires earlier and less often. **Deferred to the approval gate** because it edits
agent config. **Why**: with a ~72 KB injected baseline, a 10k reserve is a fraction of a single
request's cost, which is precisely what makes the loop repeat immediately after compaction.

## D9. Create an `orchestrator` agent — none exists today

Verified `.agents/agents/` (13 profiles: bug-hunter, code-reviewer, devops, doc-writer,
e2e-agent, gh-helper, integrator, observability, qa, recommendation-agent, tdd-guide,
ux-designer, wiki-publisher) and `.opencode/opencode.json` `"agent"` (13 entries, **all**
`"mode": "subagent"`).

**Decision**: add a single orchestrator whose job is task **decomposition + dispatch + health
monitoring + handoff**, rather than making one of the existing specialists also do it.
**Why**: the user's directive ("always run an orchrestrator to monitor the subagent health so
it doesnot hang or gets stuck") requires an owner for that responsibility; bolting it onto a
specialist gives it a split mandate.

## D10. This turn stops at the approval gate

Repo rule `.agents/rules/spec-driven-development.md` mandates spec → plan → **human approval** →
implement, and section 9 defines "Gate 1: Spec Approved" / "Gate 2: Plan Approved".

**Decision**: produce the spec + plan + decisions/flow now and **stop for approval** before
writing any implementation. **Why**: the user asked for this to be done "properly", and the
directive itself is broad enough that an unapproved implementation could waste a large effort
in the wrong direction.

## D11. Degrade-not-block: every orchestration feature must work without subagents

**Decision**: no workstream may be *blocked* on subagent availability. Each gets a Tier B
fallback (D3). **Why**: guarantees the epic is deliverable in the current environment while
still being correct if the provider tier changes.
