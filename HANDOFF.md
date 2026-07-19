# HANDOFF.md - Agent Orchestration State

> **Every agent MUST read this file at session start to understand the current orchestration state.**
> This is the central coordination point for all AI agents working on TradeNext.

---

## Current State

```yaml
status: "in_progress"              # ready | in_progress | handoff_required | recovery
current_agent: "system"          # Current agent type
next_agent: null                 # Next agent to process (if handoff_required)
handoff_version: "1.0"
last_updated: "2026-07-19T10:00:00Z"
feature: "ph18-daily-recommendations"
```

## Handoff Required?

**Yes.** Active implementation session for Daily Recommendations Engine (ph18). Documentation and planning complete, ready for code implementation.

---

## Agent Pipeline

| Step | Agent | Status | Handoff |
|------|-------|--------|---------|
| 1 | GH Helper | ⏳ Idle | - |
| 2 | Integrator | ⏳ Idle | - |
| 3 | QA | ⏳ Idle | - |
| 4 | DevOps | ⏳ Idle | - |
| * | Observability | ⏳ Idle | - |

## Active Handoff

No active handoff. See `.agents/handoffs/active/latest.md` for current session state.

---

## Quick Links

| File | Purpose | Must Read? |
|------|---------|------------|
| `.agents/handoffs/active/latest.md` | Current session handoff | ✅ Yes |
| `.agents/handoffs/SCHEMA.md` | Handoff file format | ✅ Yes |
| `Primer.md` | Project status | ✅ Yes |
| `Lessons.md` | Rules & corrections | ✅ Yes |
| `AGENTS.md` | Full development guide | 📖 Reference |
| `agent-memory.md` | Activity log | 📖 Reference |
| `.agents/learning/README.md` | Self-learning system | 📖 Reference |

---

## Orchestration Rules

1. **Start**: Read HANDOFF.md → Read latest.md → Read Primer.md → Read Lessons.md
2. **Work**: Update handoff files as you go; log in agent-memory.md
3. **Handoff**: Use `/handoff` command when switching agents or completing
4. **Complete**: Archive handoff → Update HANDOFF.md to `ready` → Update docs
5. **Recovery**: If session crashes, next agent reads latest.md and continues

---

## Version History

| Version | Date | Description |
|---------|------|-------------|
| v1.0 | 2026-07-16 | Initial handoff orchestration system |
