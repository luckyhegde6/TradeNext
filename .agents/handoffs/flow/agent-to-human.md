# Agent-to-Human Handoff Flow

> How an agent hands off work to a human (developer/owner) for review, decision, or continuation. This is the **final transition** in the pipeline — the human is the orchestrator, not another agent.

## When to Hand Off to a Human

| Trigger | Example |
|---------|---------|
| Sensitive operation needs consent | DB reset, migration, env change, deploy |
| Ambiguous requirements | Multiple interpretations, unclear scope |
| Design decision with tradeoffs | Architecture choice the agent shouldn't pick alone |
| Blocked on external info | Credentials, prod data, user preference |
| Task complete — ready for review | PR created, tests green, docs updated |
| Damaged state | Failed migration, broken build, data loss risk |

## Handoff File Format (Human-Facing)

Handoffs to humans use the **same SCHEMA.md frontmatter** but the body is written for a human reader — concise, decision-ready, no agent jargon.

```yaml
---
handoff_version: "1.0"
session_id: "sess-YYYYMMDD-HHMMSS"
agent: "opencode"
timestamp: "2026-07-16T10:30:00Z"
status: "awaiting_human"     # awaiting_human | needs_decision | blocked | done
priority: "high"
parent_session: null
child_sessions: []
checkpoint: null
---

## Status
> One sentence: what state is the work in right now? (e.g. "Backtest data chain implemented + 286 tests pass; awaiting approval to run prisma db push.")

## What I Need From You
> The ONE question/decision/approval. Be explicit — the human should not have to read the whole repo.
> e.g. "Approve running `prisma db push` (non-destructive) to add the BacktestHistory temp table?"

## What Was Done (verified)
- [x] Item — with verification: tests pass (286), tsc clean (prod files), link to file
- [x] Item — with verification

## What's Blocked / Next
- **Blocker**: description
  - **Options**: A (recommended: why) / B (tradeoff) / C
- **Next step once unblocked**: description

## Risks / Warnings
- Anything the human should know before proceeding (data loss, prod impact, scope creep)

## Context (optional, only if human needs it)
- Link to latest.md / session archive / relevant files
```

## Protocol

1. **Before handing off**: run verification (tests, tsc, lint), update `.agents/session-todos.md`, update `latest.md` — the human inherits a clean, honest state.
2. **Write the handoff**: use the format above. Keep it to a screen — the "What I Need From You" line is mandatory.
3. **Signal the human**: handoff file lives at `.agents/handoffs/active/latest.md` (or a dated file under `archive/` for completed work). Set `status: awaiting_human`.
4. **Wait**: do NOT proceed past a consent-required operation without explicit human confirmation.
5. **On human reply**: act on the decision, update the handoff status to `done` or continue `in_progress`.

## Decision Escalation

If the human is unavailable and the task is blocked on consent:
- **Never** auto-approve destructive/irreversible actions.
- Leave a clear handoff with options + recommended choice + what happens if the human doesn't reply.
- Park the task as `blocked` — do not invent a workaround that changes scope.

## Best Practices

1. **One ask per handoff** — a single clear decision beats a list of options.
2. **Verification is non-negotiable** — never hand off unverified work claiming it works.
3. **Honest status** — if stuck, say "stuck on X, tried A/B, need C" not "almost done".
4. **Human-visible summary** — the final chat message must restate the handoff in plain language (the human reads the chat, not only files).
5. **Never bury a consent request** — DB/env/auth/prod changes are surfaced FIRST, not in a footnote.
