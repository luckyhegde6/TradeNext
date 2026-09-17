# Subagent Health Monitoring (Orchestrator)

> Companion to `.agents/agents/orchestrator.md`. Registered in `.agents/INDEX.md` — **not injected**.
>
> **The failure this prevents**: a dispatch that hangs with no timeout and no liveness check
> blocks the whole turn. The orchestrator must never wait indefinitely.

## 1. Timeout budgets (per dispatch)

Set the budget **before** dispatch and record it. Never dispatch without one.

| Stream type | Budget | Rationale |
|-------------|--------|-----------|
| Read-only exploration / search | **60 s** | Pure Glob/Grep/Read — no network, no writes |
| Single-doc read / analysis | **90 s** | One or two file reads + reasoning |
| Doc update (docs-updater) | **90 s** | Bounded set of file edits |
| Unit test run (`npm run test`) | **300 s** | Full Jest suite; run **alone** (Windows quirk) |
| Build (`npm run quickbuild`) | **600 s** | Migrations + compile |
| Full e2e suite | **900 s** | 5 Playwright projects |
| **Unsure / anything else** | **120 s** | Safe default |

**Turn budget**: do not spend more than ~50 % of the turn's remaining budget on dispatches.
If the budget is exhausted, stop dispatching and hand off — do not start new streams.

## 2. Liveness check

A dispatch must emit **some** progress before its budget expires.

| Point | Signal | Action |
|-------|--------|--------|
| ≤ 50 % of budget | No output at all | **At risk** — note it; do not add more streams |
| 100 % of budget | No completion | **`stalled`** → abort |

- **Abort is mandatory at the budget.** Waiting longer is the bug this file exists to prevent.
- Aborting means: stop consuming the stream, record the outcome, and continue on Tier B.

## 3. Retry policy

```
□ Max 1 retry per stream. Never a retry loop.
□ Retry ONLY transient outcomes: error · timeout · stalled
□ NEVER retry provider-blocked — it is deterministic (same provider, same result)
□ Second failure → downgrade THAT stream to Tier B. Do not cancel the other streams.
```

## 4. Failure taxonomy (closed set)

| Outcome | Detected by | Retry? | Action |
|---------|-------------|--------|--------|
| `provider-blocked` | Provider error (e.g. *free tier can only be used from within OpenCode*) | **No** | Whole-turn Tier B; say so once |
| `timeout` | Exceeded budget with output in progress | **Yes, once** | Retry with the same budget, else Tier B |
| `stalled` | Exceeded budget with **no** output | **Yes, once** | Retry, else Tier B |
| `error` | Non-zero exit / explicit error | **Yes, once** | Retry, else Tier B |
| `completed` | Stream produced its deliverable | — | Collect the result; verify before trusting |

Anything not in this set is a bug — map it to the closest outcome and note the raw error.

## 5. Recording (mandatory)

Every dispatch gets **one row** in the handoff's `## Subagent Status` table
(schema: `.agents/handoffs/SCHEMA.md` §8). No prose, no transcripts.

```
| Dispatch | Agent | Tier | Budget | Outcome | Notes |
|----------|-------|------|--------|---------|-------|
| facts A1–A4 | explore | A | 60 s | provider-blocked | free tier — no retry (deterministic) |
| fallback | — | B | — | completed | .context/out/facts-digest.txt |
```

Also state the **tier used** in the response and in the `## Handoff Summary`.

## 6. Why not just retry until it works

Three reasons this is banned:

1. **Deterministic failures never recover** — `provider-blocked` will fail identically every time.
2. **Budget is finite** — a retry loop starves the streams that *could* have completed.
3. **It hides the real state** — the next agent needs to know a stream was `provider-blocked`,
   not that the turn spent itself on retries.

## Related

- `.agents/agents/orchestrator.md` — decomposition + dispatch policy
- `.agents/handoffs/SCHEMA.md` §8/§9 — `Subagent Status` + `Handoff Summary`
- `.agents/handoffs/flow/agent-to-agent.md` — tier-downgrade path
- `.agents/specs/v3.40.0-agentic-context-orchestration.md` — W5
