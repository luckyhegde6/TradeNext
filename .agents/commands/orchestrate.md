# /orchestrate — Decompose, dispatch, monitor, hand off

Use the **orchestrator** agent to run work that has ≥ 2 independent workstreams.

## What it does

1. **Probes capability** — one trivial subagent dispatch decides Tier A vs Tier B for the turn.
2. **Decomposes** — lists workstreams and marks each `independent` or `depends-on:`.
3. **Dispatches** — parallel only for genuinely independent streams; each with a timeout budget.
4. **Monitors** — aborts stalls, max 1 retry, downgrades that stream to Tier B on a second failure.
5. **Hands off** — writes `## Subagent Status` + a bounded `## Handoff Summary` to
   `.agents/handoffs/active/latest.md`.

## Required output shape

```
Tier: A | B   (why)
Streams: <n>  — <name>: <agent> — <independent | depends-on: X> — <outcome>
Blockers: <none | exact question for the user>
Next: <bounded next steps>
```

## Rules

- **Declare the tier** in the response *and* the handoff.
- **Never dispatch without a timeout budget**; never wait indefinitely on a stalled stream.
- **Never block on Tier A** — every workstream needs a Tier B path.
- **Query the memory graph before re-reading a doc**; redirect large tool output to `.context/out/`.
- **Do not commit, push, or deploy** — ask permission. Sensitive ops need explicit permission.

## Full policy

`.agents/agents/orchestrator.md` · health rules: `.agents/agents/orchestrator-health.md`
