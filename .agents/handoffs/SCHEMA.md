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
