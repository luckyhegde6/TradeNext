# Durable Memory — Two-Tier Protocol (context-loop guard, v3.40.0)

> **Not auto-injected** — registered in `.agents/INDEX.md`.

## Why this exists

Agents repeatedly re-read the same large docs (`AGENTS.md`, subsystem deep-dives, rules,
`Primer.md`) to recover facts they already knew in a previous session. That is the single
largest avoidable context cost: a 20 KB doc read costs ~5K tokens **every time it happens**,
and the content then stays in the transcript and is re-sent on every later request.

The fix is to write facts down **once**, in a store that is cheap to query and never injected.

## The two tiers

| Tier | Store | Scope | Lifetime | Committed? |
|------|-------|-------|----------|------------|
| **Local rolling** | `.remember/now.md` | This machine / this workspace | Append-only log | **No** — gitignored |
| **Durable graph** | memory MCP | Cross-session, queryable | Until superseded | No (MCP server state) |

Use **both**, for different jobs. Do not duplicate one into the other.

### Tier 1 — `.remember/now.md` (rolling, human-readable)

One line per *significant event*. Chronological. Cheap to append, cheap to skim.

Format (strict):

```
## HH:MM | <session-slug> <one-line summary>
```

- `HH:MM` — 24-hour, zero-padded (e.g. `04:13`, `00:37`).
- `<session-slug>` — the session id, e.g. `v340ctx` (matches `.agents/sessions/…`).
- Summary — one line, no newlines. What changed and why it matters.

Rules:

```
□ Append only — never rewrite history (if a fact changed, append a new line)
□ NEVER store secrets, tokens, cookies, credentials, or user data
□ Keep it to events (shipped/decided/blocked), not code
□ Do NOT paste multi-line evidence — that belongs in the commit or a doc
```

> ⚠️ **Windows `%TIME%` trap**: `echo ## %TIME% | ...` yields ` 4:13:42.00` — a leading space
> plus centiseconds. Normalise to `HH:MM` by hand. (This happened in v3.40.0 and had to be
> cleaned up.)

### Tier 2 — memory MCP graph (durable, queryable)

For facts a *future* session needs in order to avoid reading a file. Query this **before**
opening a large doc.

**Controlled `entityType` vocabulary** — stick to these so the graph stays searchable:

| entityType | Use for |
|------------|---------|
| `project-epic` | A multi-phase body of work with a spec/plan |
| `convention` | A rule, budget, or format agents must follow |
| `environment-constraint` | A hard limitation of the tooling/provider/runtime |
| `bug-fix` | A non-obvious fix worth not re-discovering |
| `verification-baseline` | A recorded expected value (error counts, budgets, page counts) |
| `subsystem` | A major component + its entry-point files |
| `gotcha` | A trap that has already caused a mistake |

Naming: use the **topic**, not the date — `Injected context budget`, not `budget 2026-09-18`.

Observations should be **self-contained facts**, each useful on its own:

```
✅ "npx tsc --noEmit reports 46 errors at the v3.40.0 branch point — this is the baseline, not zero"
❌ "ran tsc, got 46, then did some other stuff"
```

Relations should be in active voice and meaningful without extra context:

```
✅ epic --is constrained by--> constraint
✅ epic --adopts--> convention
❌ epic --related to--> everything
```

## Decision rule: query-before-read

```
1. Need a fact (a path, a rule, a convention, a baseline)?
   → Search the memory graph FIRST.
2. Found it? Use it. Do not open the doc.
3. Not found? Read the smallest slice that answers the question
   (grep / offset+limit), then WRITE the distilled fact to the graph.
4. Never bulk-read a doc "to get oriented" — use `.agents/INDEX.md` to pick the one doc.
```

## Anti-patterns

| Anti-pattern | Why it hurts |
|---|---|
| Putting session trivia in the graph ("ran tests") | Pollutes recall; the graph is for durable facts |
| Copying a whole doc into the graph | The graph should answer questions, not duplicate sources |
| Using `.remember/` for cross-session knowledge | It is local-only; a fresh clone won't have it |
| Using the graph for secrets | Never — it is not a secrets store |
| Rewriting `now.md` history | Loses the audit trail; append instead |
| Re-reading a doc because "it's easier" | That is exactly the loop this rule exists to break |

## Verification

```bash
# Tier 1 shape check (each entry must be "## HH:MM | slug ...")
findstr /n /b "##" ".remember\now.md"

# Tier 2 — confirm the graph answers; search for a known fact
# (memory MCP: search_nodes "Injected context budget" → expect the 72.8 KB convention)
```

## Related

- `.agents/rules/tool-output-protocol.md` — the other half of the loop fix (payloads)
- `.agents/rules/session-memory-rules.md` §7 — context & token efficiency
- `.agents/INDEX.md` — read-on-demand manifest (replaces bulk reading)
- `.agents/specs/v3.40.0-agentic-context-orchestration.md` (W2)
