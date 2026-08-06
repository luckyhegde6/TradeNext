# Handoff Command

> Create a handoff to another agent or archive current session state.

## Usage

```
/handoff [target] [status] [reason]
```

### Parameters

| Parameter | Required | Description | Values |
|-----------|----------|-------------|--------|
| `target` | ✅ | Who to hand off to | `gh-helper`, `integrator`, `qa`, `devops`, `observability`, `developer`, `human` |
| `status` | ✅ | Current completion status | `completed`, `partial`, `blocked`, `failed`, `review_needed` |
| `reason` | - | Why the handoff is needed | Free text |

### Examples

```
/handoff integrator completed "Feature implementation done, ready for merge"
/handoff qa blocked "E2E tests failing on mobile viewport"
/handoff human review_needed "Security concern with auth flow"
```

## Workflow

### 1. Generate Session ID
Create a unique session identifier:
```bash
sess-$(date +%Y%m%d-%H%M%S)
```

### 2. Create Handoff File
Write a complete handoff file following the schema in `.agents/handoffs/SCHEMA.md`:
- Set `status` to `handoff_required` or `completed`
- Fill in all context sections
- Document decisions, blockers, and next steps
- Set `target_agent` in HANDOFF.md

### 3. Archive Current State
```bash
# Move current handoff to archive
cp .agents/handoffs/active/latest.md .agents/handoffs/archive/sess-YYYYMMDD-HHMMSS.md
```

### 4. Reset Active Handoff
Create a fresh template for the next session.

### 5. Update HANDOFF.md
Update the root orchestration file with:
- New handoff_required = true (if not completed)
- Target agent
- Status summary
- Priority

### 6. Notify Target Agent
If using agent-to-agent handoff:
- Update the `next_agent` field in HANDOFF.md
- The target agent will read HANDOFF.md on start

## Handoff Quick Template

```yaml
---
handoff_version: "1.0"
session_id: "sess-YYYYMMDD-HHMMSS"
agent: "current-agent"
timestamp: "2026-07-16T10:30:00Z"
status: "handoff_required"
priority: "high"
parent_session: null
child_sessions: []
checkpoint: null
---

## Context
- **Task**: What was being done
- **Branch**: current-branch
- **Files Changed**: file1.ts, file2.ts
- **Dependencies**: None

## Progress
- [x] Completed item 1
- [ ] Pending item 2
- [!] Blocked item 3

## Decisions
- **Decision**: What was decided and why

## Blockers
- **Blocker**: Description and suggested approach

## Next Steps
1. What to do next
```

## Integration with Agents

| Handoff Target | What They Do |
|----------------|--------------|
| `gh-helper` | Review code, run type check/lint/tests, verify changes |
| `integrator` | Merge branches, resolve conflicts, run full build |
| `qa` | Run E2E tests, verify flows, check responsive design |
| `devops` | Build, deploy, check health, manage infrastructure |
| `observability` | Audit logging, metrics, security, performance |
| `developer` | Continue implementation (human or AI) |
| `human` | Needs human review or decision |
