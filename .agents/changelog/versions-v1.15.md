# Version History v1.15

> From TradeNext version history. Index: [../CHANGELOG.md](../CHANGELOG.md). All v1.x files: [versions-v1.md](./versions-v1.md).

- **v1.15.0** - Agent Handoff & Self-Learning System (July 16, 2026). Complete overhaul of agent collaboration infrastructure:
  - **Handoff File System**: Created `.agents/handoffs/` with standardized schema, lifecycle flows, and agent-to-agent handoff protocol. Root `HANDOFF.md` orchestrates state across sessions.
  - **Agent Definitions**: Created 6 specialized agent profiles: GH Helper (diff review, code verify, bug fix), E2E Agent (Playwright flow testing), Integrator (merge/conflict resolution), Observability Checker (logging/metrics/security audit), DevOps (Docker/Vercel/Netlify/CICD), QA (test writing and E2E execution).
  - **Self-Learning Loop**: Created `.agents/learning/` with session logs, pattern extraction, metrics tracking. Every session feeds into continuous improvement.
  - **Agent Commands**: Added `/handoff`, `/self-learn`, `/review-diff` commands for explicit orchestration.
  - **Git Hooks**: Added pre-commit (code quality, secrets detection) and post-commit (activity logging, checkpoint tracking) hooks.
  - **Documentation Update**: Expanded AGENTS.md, Primer.md, agent-memory.md, Lessons.md with handoff patterns.
  - **Files Created**: 20+ files in `.agents/` structure (handoffs, agents, learning, commands, hooks).
