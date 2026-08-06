# Agent-to-Agent Handoff Flow

> How specialized agents hand off work to each other via the handoff file system.

## Flow Diagram

```
GH Helper  ──> Integrator  ──> QA  ──> DevOps ──> Deploy
    │              │             │         │
    └────── Observability Checker ────────┘
```

## Agent Collaboration Model

Each agent writes a handoff file for the next agent in the pipeline:

### 1. GH Helper → Integrator

**GH Helper** reviews code diffs, verifies generated code, and hands off validated changes:

```
Handoff: gh-helper/handoff-{session}.md
Status: ready_for_integration | issues_found | review_needed
Attachments: review_report.md, diff_summary.md
```

### 2. Integrator → QA

**Integrator** merges changes, resolves conflicts, and hands off integrated code:

```
Handoff: integrator/handoff-{session}.md
Status: integrated | conflict_resolved | needs_review
Attachments: merge_report.md, integration_tests.md
```

### 3. QA → DevOps

**QA** runs Playwright E2E tests, verifies flows, and hands off validated builds:

```
Handoff: qa/handoff-{session}.md
Status: tests_passed | tests_failed | regressions_found
Attachments: test_report.md, screenshots/
```

### 4. DevOps → Deploy

**DevOps** builds, deploys, and monitors:

```
Handoff: devops/handoff-{session}.md
Status: deployed | build_failed | rollback_needed
Attachments: deploy_log.md, health_check.md
```

### 5. Observability Checker (Cross-Cutting)

**Observability** checks all stages for logging, metrics, and monitoring:

```
Handoff: observability/handoff-{session}.md
Status: compliant | warnings | violations
Attachments: observability_report.md
```

## Handoff Protocol

### HTTP-like Status Codes for Handoffs

| Code | Meaning | Description |
|------|---------|-------------|
| 200 | OK | Task completed successfully |
| 206 | Partial | Task partially complete, needs follow-up |
| 301 | Redirect | Task redirected to another agent |
| 400 | Bad Request | Invalid handoff data |
| 409 | Conflict | Merge conflict, needs resolution |
| 500 | Error | Agent encountered error |

### Communication Pattern

```
Agent A:
  └── Writes handoff to archive with status: 200 (OK)
  └── Sets HANDOFF.md: handoff_required → true
  └── Updates next_agent field

Agent B:
  └── Reads HANDOFF.md: handoff_required → true
  └── Reads archived handoff
  └── Processes based on status code
  └── Writes new handoff
```

## Best Practices

1. **Atomic Handoffs**: Each handoff should contain all context needed by the next agent
2. **Idempotent Processing**: Agents should handle receiving the same handoff multiple times
3. **Fail Fast**: If prerequisites aren't met, reject handoff with clear reason
4. **Audit Trail**: Every status change is logged in `agent-memory.md`
5. **Time Budget**: Each agent should estimate time needed in handoff
