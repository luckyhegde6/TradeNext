# Handoff File System

> Agent-Agnostic Session Handoff Mechanism for Multi-Agent Workflows

## Overview

The Handoff File System provides a standardized mechanism for AI agents to transfer context, state, and learnings between sessions — regardless of which agent (Claude, Cursor, OpenCode, Gemini, etc.) is operating. This ensures continuity across agent restarts, tool changes, and developer handoffs.

## Why Handoff Files?

- **Session Continuity**: If an agent session ends unexpectedly, the next session picks up where it left off
- **Multi-Agent Orchestration**: Different specialized agents can collaborate via shared handoff files
- **Self-Learning Loop**: Each session records what it learned, enabling continuous improvement
- **Accountability**: Every action is logged with context, decisions, and rationale

## File Structure

```
.agents/handoffs/
├── README.md           # This file - system overview
├── SCHEMA.md           # Handoff file schema and validation rules
├── active/             # Active session handoff (current session context)
│   └── latest.md       # The current/latest handoff state
├── archive/            # Archived handoffs from completed sessions
│   ├── 2026-07-16-feature-x.md
│   └── ...
└── flow/               # Process definitions for different handoff flows
    ├── session-cycle.md
    ├── agent-to-agent.md
    └── error-recovery.md
```

## How It Works

### 1. Session Start
Every agent session **MUST**:
1. Read `HANDOFF.md` at project root for current orchestration state
2. Read `.agents/handoffs/active/latest.md` for pending context
3. Read `Primer.md` for project status
4. Read `Lessons.md` for known rules

### 2. During Session
The agent records progress in:
- `agent-memory.md` - Activity log
- `.agents/handoffs/active/latest.md` - Current handoff state (updated in real-time)

### 3. Session End / Handoff
When a session completes or a handoff is needed:
1. Finalize `.agents/handoffs/active/latest.md`
2. Move to `.agents/handoffs/archive/` with dated filename
3. Update `HANDOFF.md` with new orchestration state
4. Update `Primer.md` with progress summary
5. Create a fresh `active/latest.md` template for next session

## Handoff Triggers

| Trigger | Action |
|---------|--------|
| Session complete | Archive handoff, update orchestration state |
| Agent switch | Write handoff, signal handoff_required |
| Error/abort | Write recovery handoff with checkpoint data |
| Feature complete | Archive handoff, update agent-memory, update versions |
| /handoff command | Explicit handoff request |

## Integration Points

- **`HANDOFF.md`** (root) - Orchestration state, read by every agent at start
- **`AGENTS.md`** - Full development guide and version history
- **`Primer.md`** - Session-level project status
- **`agent-memory.md`** - Activity log
- **`Lessons.md`** - Accumulated rules and corrections
- **`.agents/learning/`** - Self-learning loop data
