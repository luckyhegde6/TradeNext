# Tool-Output Protocol (context-loop guard, v3.40.0)

> **Not auto-injected** — registered in `.agents/INDEX.md`. Applies to every agent session.

## Why this exists

Measured 2026-09-18: the auto-injected instruction files are only **72.8 KB (~18K tokens)** per
request, yet sessions still fell into a **compaction loop** — compact, then a few tool calls,
then compact again.

Cause: **conversation transcript growth**, not injected files. Any large tool output and any long
prose summary stays in the transcript and is re-sent on **every** subsequent request. After a
compaction it is re-summarised, and the cost is immediately paid again.

The only reliable cure is to **never let a large payload enter the transcript in the first place**.

## The rule

```
□ NEVER print a potentially large tool output directly into the conversation
□ Redirect it to a file under .context/out/ , then read a slice or grep it
□ Read small slices (offset/limit), never whole large files
□ Batch independent reads into a single message
□ Prefer grep over reading — get the matching lines, not the file
```

## Redirect pattern

Any command whose output might exceed ~200 lines / 2 KB goes to a file:

```bash
# cmd.exe (Windows) — 2>&1 merges stderr, so failures are captured too
some-command > ".context\out\<name>.txt" 2>&1 & type ".context\out\<name>.txt"
```

Then, instead of `type`-ing the whole file, inspect only what you need:

```bash
# count
findstr /c:"error TS" ".context\out\<name>.txt" | find /c /v ""
# bounded sample (head-style)
findstr /n /c:"<literal>" ".context\out\<name>.txt"
```

> ⚠️ `findstr /i "a b c"` is an **OR** of words, not a phrase. Use `/c:"a b c"` for a phrase.
> Getting this wrong prints false "failures" (learned the hard way in Phase 0 of v3.40.0).

## Chunking (when you must read it in parts)

`scripts/dev-checks/chunk-output.mjs` splits a captured output into grep-able chunks + an index:

```bash
node scripts/dev-checks/chunk-output.mjs .context/out/build.log            # 400 lines/chunk
node scripts/dev-checks/chunk-output.mjs .context/out/build.log --lines 200
node scripts/dev-checks/chunk-output.mjs .context/out/build.log --out .context/out
```

It writes `<name>.part-01.txt`, `<name>.part-02.txt`, … plus `<name>.index.md`.

Each part begins with a header that records the **original** source line range:

```
# chunk 2/5 — build — original lines 401-800
<raw source lines follow>
```

Map a position `p` inside a part (1-based, counting **after** the header) back to the source:

```
original_line = A + (p - 1)        # where A is the header's start line
```

The index lists every part with its range and first line, so you can pick the part to open.

**Guarantees**: deterministic and idempotent (re-running over unchanged input produces
byte-identical files; stale parts for the same name are removed first). Node built-ins only.

## Retention

`.context/` is **gitignored scratch** (`.gitignore` → `/.context/`).

```
□ Prune .context/out/ when it grows past ~50 files or a few MB
□ Never store secrets, tokens, cookies, or user data in .context/
□ .context/ is workspace-local — never reference it from committed docs as if it ships
```

## Anti-patterns

| Anti-pattern | Why it hurts |
|---|---|
| `type big.log` / `cat big.log` | Puts the whole payload in the transcript permanently |
| Reading a 1,000-line file to find one line | Use `grep` or `findstr /n` — get the line, not the file |
| Re-reading a doc you already summarised | Query the memory graph (`.agents/rules/durable-memory.md`) first |
| Pasting a long summary of a tool result back to the user | Summarise in ≤10 lines; detail lives in the file |
| `findstr /i "phrase with spaces"` | It is an OR of words — use `/c:"…"` |

## Verification

```bash
node scripts/dev-checks/chunk-output.mjs .context/out/facts-digest.txt --lines 20
node scripts/dev-checks/check-doc-sizes.mjs   # injected budget still within 100 KB
```

## Related

- `.agents/rules/session-memory-rules.md` §7 (context & token efficiency) + §8/§9 (subagents)
- `.agents/rules/durable-memory.md` (two-tier memory — the other half of the loop fix)
- `.agents/specs/v3.40.0-agentic-context-orchestration.md` (W1)
