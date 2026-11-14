# /orchestrate — Decompose, dispatch, monitor, hand off

Use the **orchestrator** agent to run work that has ≥ 2 independent workstreams, or to resume/coordinate a multi-stream task safely.

## What it does

1. **Resumes from files** — reads `@HANDOFF.md`, `.agents/handoffs/active/latest.md`, `.agents/session-todos.md` (and relevant session decisions/flow) before acting.
2. **Probes capability** — one trivial subagent dispatch decides Tier A vs Tier B for the turn (no retry loop on deterministic provider block).
3. **Decomposes** — lists workstreams and marks each `independent` or `depends-on:` with file scope, verification, and budget.
4. **Dispatches** — parallel only for genuinely independent streams; each with a timeout budget.
5. **Monitors** — aborts stalls, max 1 retry for transient failures, downgrades that stream to Tier B on a second failure.
6. **Hands off** — updates `.agents/handoffs/active/latest.md` with `## Subagent Status` + bounded `## Handoff Summary` (and resume pointers).

## Required output shape

```
Tier: A | B   (why)
Streams: <n>  — <name>: <agent> — <independent | depends-on: X> — <budget> — <outcome>
Verified: <commands/checks or "not run">
Blockers: <none | exact question/approval needed>
Next: <bounded next steps>
Resume from: <handoff/todos/session files>
```

## Rules

- **Declare the tier** in the response *and* the handoff.
- **Never dispatch without a timeout budget**; never wait indefinitely on a stalled stream.
- **Never block on Tier A** — every workstream needs a Tier B path.
- **Canonical skills live in `.agents/skills/<name>/SKILL.md`**; use `skill` tool / agent mappings from `.agents/AGENT-SKILL-MATRIX.md`.
- **Persist state in files, not chat**: handoff, session todos, `decisions.md`/`flow.md` as applicable.
- **Do not commit, push, merge, or deploy** — ask permission. Sensitive ops need explicit permission.

## Full policy

`.agents/agents/orchestrator.md` · `.agents/agents/orchestrator-health.md` · `.agents/handoffs/SCHEMA.md` · `.agents/rules/session-memory-rules.md`
