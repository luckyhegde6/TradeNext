# Session, Memory & Handoff Rules — TradeNext

> Agentic operating rules: when to read state, how to maintain memory, how to hand off, and how to continue work across sessions/restarts. Load only what is needed; keep state in files.

## 1. Session Start / Work Continuation (READ order)

```
1. @HANDOFF.md                         → orchestration state (always)
2. .agents/handoffs/active/latest.md   → live resume point (always)
3. .agents/session-todos.md            → current todos / in-progress work (always)
4. .agents/sessions/<latest>/decisions.md + flow.md → if present and relevant (resume context)
5. @Primer.md                          → project status (if latest handoff is stale/incomplete)
6. @Lessons.md                         → rules & corrections (before writing code)
7. .agents/RULES.md + SOUL.md          → operating rules + identity (first session / new clone)
```

**Continuation checklist (on restart or "continue"):**
- Confirm `git status`/branch/head and do not repeat completed work already reflected in files/commits.
- Reconcile pending approvals, quotas/budgets, blocked MCP/tools, and running processes you started.
- Pick up the next unfinished todo or the handoff's `Next Steps` / `Resume from` pointers.

**Rule:** Read indexes first (@AGENTS.md, @Lessons.md, `.agents/INDEX.md`) — not full dumps. Use targeted reads (offset/limit/grep). Canonical skills live in `.agents/skills/<name>/SKILL.md` (format A).

## 2. Session During Work (maintenance cadence)

| Event | Action |
|-------|--------|
| New task accepted | Add todo to `.agents/session-todos.md` |
| Step completed | Mark `[x]` in session-todos **immediately** |
| Blocked | Keep `in_progress`, add follow-up todo describing blocker |
| Before every commit | Run pre-commit workflow (`.agents/pre-commit-workflow.md`) |
| New bug/gotcha found | Log in `@Lessons.md` at discovery time (not end-of-session) |
| Every ~5 tool calls | Quick mental check: are todos still accurate? update if drifted |

**Rule:** Exactly ONE `in_progress` todo at a time. Update in real time, never batch.

## 3. Session Memory (`.agents/sessions/`)

- **Folder per session**: `YYYY-MM-DD-<first-8-commit-hash>/` (timestamp + commit for navigation).
- Every session folder contains **two LIVE files** (written during work, not retrofitted):
  - `decisions.md` — every meaningful decision (approach/package/code change) + reasoning. Hard-rule detail: `.agents/rules/session-decisions-flow.md`.
  - `flow.md` — execution flow: entry point → call order, code changed this session, verification matrix.
- Keep archives **short & crisp** — bullets only, no prose dumps. Summarize the folder in `sessions/README.md`.
- Old flat-file format `YYYY-MM-DD-<hash>.md` (Date/Commit/Work Completed/Todos/Issues) is superseded by the folder format; when archiving legacy sessions, either keep the flat file or convert to the folder shape.
- **Only load an archive when needed** (e.g., "what did we do on X?" → read that folder's `flow.md`/`decisions.md`). Do NOT read all archives at session start.

## 4. Handoff (`.agents/handoffs/`) and work continuation

- Update `.agents/handoffs/active/latest.md` **before finishing any work block**, before risky/long operations, and whenever stopping mid-task.
- Required content (bounded): Context (task/branch/PR/plan refs), Progress, Decisions, Blockers, **Next Steps**, and **Resume from** pointers (files/commands/checks). Include `Subagent Status` + `Handoff Summary` per `.agents/handoffs/SCHEMA.md` when dispatch/orchestration was used.
- YAML frontmatter: keep schema-compliant (`handoff_version`, `session_id`, `agent`, `timestamp`, `status`, `priority`, etc.). Use `status: awaiting_human` for consent/decision gates.
- Handoff flows (`.agents/handoffs/flow/`): `session-cycle.md`, `agent-to-agent.md`, `agent-to-human.md`, `error-recovery.md`.
- On session close or major milestone: archive/update `@HANDOFF.md`, `@Primer.md`, `@agent-memory.md`, and session todos/archives as applicable.
- **Next agent resumes from files, never conversation memory.** Never auto-approve consent-required operations.

## 5. Documentation Updates (MANDATORY)

See `.agents/documentation-standards.md` for the full table. Minimum per change:

```
□ After feature/bug → @AGENTS.md version entry + @TODO.md
□ After API change  → @AGENTS.md route table + Swagger/OpenAPI + skill files if NSE-related
□ New discovery     → @Lessons.md
□ Before commit     → session-todos.md done/carry-forward
□ End of session    → archive + @Primer.md + @agent-memory.md
```

**Rule: If documentation is not updated, the task is NOT complete.**

## 6. Git Guidelines (summary — full: `.agents/linear-history.md`)

```
□ NEVER commit to main without explicit user permission — branch + PR always
□ Feature branches: feat/, fix/, docs/, ph<N> → PR (main ← branch) → squash-merge
□ NEVER force-push to main; keep history linear (rebase)
□ Commit message: type(scope): description  (feat/fix/chore/docs/style/refactor/test/perf/ci/security)
□ Never commit secrets, .env, junk artifacts (yaml snapshots, logs, screenshots)
□ Pre-push: npm run test + npx tsc --noEmit + docs updated
□ MERGE + DEPLOY are ALWAYS user actions (RULE, user directive 2026-10-09) — never merge a
  PR and never trigger a deploy, even on green CI; agent max action = commit (on request only)
```

## 7. Context & Token Efficiency

```
□ Read small slices (offset/limit), not whole files
□ Index files over full dumps (@AGENTS.md, @Lessons.md)
□ Keep session-todos short — archives absorb history
□ Memory tool: use for cross-session knowledge only (entities/relations), not session trivia
□ Query the memory graph BEFORE re-reading a large doc — see `.agents/rules/durable-memory.md`
□ Parallelize independent reads in a single message (batch tool calls)
□ Redirect large outputs to `.context/out/` then slice/grep — see `.agents/rules/tool-output-protocol.md`
```

### Injected-file budget (context-loop guard, v3.39.4)

`.opencode/opencode.json` → `instructions` injects the **full contents** of every listed file into
**every** request. A bloated injected set refills context immediately after each compaction →
compaction loop. Hard rules:

```
□ Keep the SUM of injected files ≤ ~100 KB (currently AGENTS.md + TODO.md + README.md + rules/README.md + rules/checklist.md)
□ Injected files are INDEXES/pointers — never bulk history or long tables
□ Move detail OUT (changelogs, archives, subsystem docs) and link it from `.agents/INDEX.md`
□ Read large docs on demand via `.agents/INDEX.md`, never add them to `instructions`
□ After editing an injected file, sanity-check its size (`wc -c` / `ls -l`) — growth is a regression
```

## 8. Subagent Sessions and orchestration

- Launch subagents for independent workstreams when beneficial; use the orchestrator/Tier A-B policy for multi-stream coordination (`/orchestrate`, `.agents/agents/orchestrator.md`).
- Each subagent gets self-contained context: objective, exact files/paths, constraints, relevant canonical skill(s) in `.agents/skills`, verification command(s), timeout/budget expectation, and expected return format.
- Never assign the same file to parallel streams. Record dispatch outcomes and merge results into todos/handoff.
- Subagent outputs are not user-visible — summarize outcomes, evidence, and blockers back to the user.

## 9. Interleaved / unrelated user messages

- If the user posts an unrelated request mid-session, prefer a subagent (with self-contained context) to avoid polluting main-session state/todos, unless the user explicitly asks to handle it in the main session.
- Preserve continuity: update handoff/todos before switching focus and record where to resume the prior work.
