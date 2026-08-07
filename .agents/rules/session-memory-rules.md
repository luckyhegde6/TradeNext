# Session, Memory & Handoff Rules — TradeNext

> Agentic operating rules: when to read state, how to maintain memory, and how to hand off. Keeps context small — load files only when required, never dump whole docs.

## 1. Session Start (READ order — in this order, nothing more)

```
1. HANDOFF.md                    → orchestration state (always)
2. .agents/handoffs/active/latest.md → live resume point (always)
3. Primer.md                      → project status (if latest.md is stale)
4. Lessons.md                     → rules & corrections (before writing code)
5. .agents/session-todos.md       → current todos (always)
6. .agents/RULES.md + SOUL.md     → operating rules + identity (first session / new clone)
```

**Rule:** Read the index first (AGENTS.md, Lessons.md) — not full dumps. Use `read` with offset/limit, never `cat` whole files.

## 2. Session During Work (maintenance cadence)

| Event | Action |
|-------|--------|
| New task accepted | Add todo to `.agents/session-todos.md` |
| Step completed | Mark `[x]` in session-todos **immediately** |
| Blocked | Keep `in_progress`, add follow-up todo describing blocker |
| Before every commit | Run pre-commit workflow (`.agents/pre-commit-workflow.md`) |
| New bug/gotcha found | Log in `Lessons.md` at discovery time (not end-of-session) |
| Every ~5 tool calls | Quick mental check: are todos still accurate? update if drifted |

**Rule:** Exactly ONE `in_progress` todo at a time. Update in real time, never batch.

## 3. Session Memory (`.agents/sessions/`)

- Filename: `YYYY-MM-DD-<first-8-commit-hash>.md` (timestamp + commit for navigation)
- Keep archives **short & crisp** — bullets only, no prose dumps
- Archive template (see `sessions/README.md`): Date, Commit, Work Completed, Todos Carried Forward, Issues/Bugs
- **Only load an archive when needed** (e.g., "what did we do on X?" → read that file). Do NOT read all archives at session start.

## 4. Handoff (`.agents/handoffs/`)

- Update `latest.md` **before finishing any work block** (not just end of session)
- Content: Context (task/branch/plan refs), Progress (x/done), Decisions, Blockers, Next Steps
- YAML frontmatter: `session_id` (timestamp-based, e.g. `sess-YYYYMMDD-<phase>`), `checkpoint` (ph<N>), `status`
- Handoff flows (`.agents/handoffs/flow/`): `session-cycle.md` (start→archive), `agent-to-agent.md` (agent↔agent, HTTP-like status codes), `agent-to-human.md` (consent/decision handoffs, `status: awaiting_human`), `error-recovery.md`
- On session close: archive handoff → update `HANDOFF.md` + `Primer.md` + `agent-memory.md`
- **Next agent resumes from files, never conversation memory.** Consent-required operations hand off to the human via `agent-to-human.md` and WAIT — never auto-approve.

## 5. Documentation Updates (MANDATORY)

See `.agents/documentation-standards.md` for the full table. Minimum per change:

```
□ After feature/bug → AGENTS.md version entry + TODO.md
□ After API change  → AGENTS.md route table + Swagger/OpenAPI + skill files if NSE-related
□ New discovery     → Lessons.md
□ Before commit     → session-todos.md done/carry-forward
□ End of session    → archive + Primer.md + agent-memory.md
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
```

## 7. Context & Token Efficiency

```
□ Read small slices (offset/limit), not whole files
□ Index files over full dumps (AGENTS.md, Lessons.md)
□ Keep session-todos short — archives absorb history
□ Memory tool: use for cross-session knowledge only (entities/relations), not session trivia
□ Parallelize independent reads in a single message (batch tool calls)
```

## 8. Subagent Sessions (parallel work)

- Launch subagents (`task` tool: explore/general/review/tdd) for independent workstreams
- Each subagent gets: self-contained context, exact files to touch, verification command, expected return
- Merge results into session-todos before committing
- Subagent outputs are not user-visible — summarize back to the user

## 9. Interleaved / Unrelated User Messages → Subagent (DO NOT pollute main session)

- If the user posts a message **unrelated to the current work**, spawn a subagent to handle it
  instead of doing it in the main session — this keeps the main agent's context, todos, and
  session state clean and focused.
- **Exception**: if the user explicitly says to handle it in the main session (e.g., "handle this
  here"), do it in the main session.
- The subagent should be given self-contained context (what to do, files, verification, expected
  return) and its output summarized back — per rule #8.
- Applies to: random questions, unrelated feature requests, side tasks arriving mid-session.
