# Handoff File Schema

> Standardized format for handoff files. ALL agents MUST follow this schema.

## File Format

Handoff files are **Markdown** with YAML frontmatter for machine-readable metadata.

## Schema

```yaml
---
handoff_version: "1.0"
session_id: "sess-YYYYMMDD-HHMMSS"
agent: "agent-type"          # claude | cursor | opencode | gemini | custom
timestamp: "2026-07-16T10:30:00Z"
status: "in_progress"        # in_progress | completed | failed | handoff_required
priority: "high"             # critical | high | medium | low
parent_session: null         # UUID of parent session if this is a sub-task
child_sessions: []           # UUIDs of spawned sub-sessions
checkpoint: null             # Checkpoint ID for recovery
---
```

## Fields

### Metadata (YAML Frontmatter)

| Field | Required | Description |
|-------|----------|-------------|
| `handoff_version` | ✅ | Schema version for compatibility |
| `session_id` | ✅ | Unique session identifier |
| `agent` | ✅ | Agent type/name that created this handoff |
| `timestamp` | ✅ | ISO8601 timestamp |
| `status` | ✅ | Current status of the task |
| `priority` | ✅ | Task priority |
| `parent_session` | - | For sub-tasks, reference to parent |
| `child_sessions` | - | Any sub-sessions spawned |
| `checkpoint` | - | Recovery checkpoint identifier |

### Body Sections

#### 1. Context
```markdown
## Context
- **Task**: Brief description of what was being done
- **Branch**: git branch name
- **Files Changed**: List of files modified
- **Dependencies**: Any dependencies installed or modified
```

#### 2. Progress
```markdown
## Progress
- [x] Completed items
- [ ] Pending items
- [ ] Blocked items (with reason)
```

#### 3. Decisions
```markdown
## Decisions
- **Decision 1**: What was decided and why (with rationale)
- **Decision 2**: Alternative considered and rejected
```

#### 4. Blockers
```markdown
## Blockers
- **Blocker 1**: Description of blocker
  - **Suggested Approach**: How to resolve
  - **Needs From**: Who/what can unblock
```

#### 5. Learnings
```markdown
## Learnings
- **What Worked**: Things that went well
- **What Didn't**: Things to avoid
- **Patterns**: New patterns discovered
```

#### 6. Next Steps
```markdown
## Next Steps
1. Step one (high priority)
2. Step two (medium priority)
3. Step three (nice to have)
```

#### 7. Data/Checkpoints (Optional)
```markdown
## Checkpoints
- **Checkpoint ID**: Description of recoverable state
- **Rollback Plan**: How to undo if needed
```

#### 8. Subagent Status (v1.1 — required when the orchestrator dispatched anything)

Bounded: **one row per dispatch, no prose, no transcripts.**

```markdown
## Subagent Status

| Dispatch | Agent | Tier | Budget | Outcome | Notes |
|----------|-------|------|--------|---------|-------|
| facts A1–A4 | explore | A | 60 s | provider-blocked | free tier — no retry (deterministic) |
| fallback fact-gathering | — | B | — | completed | .context/out/facts-digest.txt |
```

- **Outcome vocabulary is a closed set** — `provider-blocked` · `timeout` · `stalled` · `error` · `completed`
  (see `.agents/agents/orchestrator-health.md` §4). Anything else is a bug.
- `Tier` is `A` (parallel subagents) or `B` (chunked sequential inline).
- If nothing was dispatched, write the section once with a single row: `| none | — | B | — | completed | no dispatch needed |`

#### 9. Handoff Summary (v1.1 — required, bounded)

A resumable summary that fits on a screen. **≤ 15 lines. Never a transcript.**

```markdown
## Handoff Summary
- **Tier used**: B (subagents provider-blocked)
- **State**: W1–W4 committed (1f73d3c, 40181c4, db08255, f758e67, ac91571); W5+ in progress
- **Verified**: tsc 46 (= baseline) · budget 73.0 KB/100 KB · quickbuild 0 warnings, 185/185
- **Blocked**: nothing
- **Next**: W5+W6 handoff schema → W7 harness → tests → docs → verify
```

Purpose: a fresh agent resumes from **files alone** without reading the previous conversation.

## Backwards Compatibility

- **`handoff_version: "1.0"`** — original schema (sections 1–7). **Still fully valid.**
- **`handoff_version: "1.1"`** — adds sections 8 (`Subagent Status`) + 9 (`Handoff Summary`).
  Both are **optional** for a 1.0-style handoff, but **required** when the orchestrator dispatched
  subagents or when the handoff must be resumable without the conversation.
- Never delete sections 1–7 to "upgrade" — 1.1 is strictly additive, so old files keep working.

## Complete Example

```yaml
---
handoff_version: "1.0"
session_id: "sess-20260716-103000"
agent: "opencode"
timestamp: "2026-07-16T10:30:00Z"
status: "handoff_required"
priority: "high"
parent_session: null
child_sessions: []
checkpoint: "cp-feature-auth-3"
---
```

```markdown
## Context
- **Task**: Implementing Google OAuth integration
- **Branch**: feature/google-oauth
- **Files Changed**: lib/auth.ts, app/api/auth/[...nextauth]/route.ts, .env.example
- **Dependencies**: next-auth@4.24.0 (installed)

## Progress
- [x] Configure Google OAuth provider in NextAuth
- [x] Add Google sign-in button to login page
- [ ] Handle OAuth callback error states
- [x] Test with demo credentials
- [ ] Add unit tests for OAuth flow

## Decisions
- **Use NextAuth built-in Google provider**: Chose over custom OAuth because it handles token refresh, session management, and CSRF automatically. Rejected Passport.js because it's not Next.js App Router native.

## Blockers
- **Blocker 1**: Cannot test OAuth locally without HTTPS
  - **Suggested Approach**: Use ngrok or localtunnel for dev testing
  - **Needs From**: DevOps to provide ngrok URL

## Learnings
- **What Worked**: NextAuth Google provider integrates seamlessly with existing JWT session strategy
- **What Didn't**: Custom callback handlers need explicit error type narrowing for TypeScript strict mode
- **Patterns**: Always wrap OAuth callbacks in try-catch with user-friendly error messages

## Next Steps
1. Set up test HTTPS endpoint (blocked)
2. Write OAuth callback error handling tests
3. Add "Continue with Google" button styling

## Checkpoints
- **cp-feature-auth-3**: All NextAuth config done, Google provider wired, sign-in button renders.
- **Rollback**: Revert git commit abc123 and disable Google provider in auth config.
```
