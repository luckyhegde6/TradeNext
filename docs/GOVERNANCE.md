# TradeNext Governance

This repository follows explicit engineering governance rules to ensure:
- long-term maintainability
- security by default
- interview-ready architecture
- AI-safe development

---

## Decision Authority

| Area | Authority |
|---|---|
| Architecture | ADRs |
| Security | Middleware + Checklist |
| API Design | OpenAPI |
| Quality | CI Quality Gate |
| Enhancements | Checklist + PR Template |

---

## Change Categories

### Minor Changes
- UI tweaks
- Refactors
- Bug fixes

Require:
- Checklist validation
- PR self-check

### Major Changes
- New data pipelines
- Auth changes
- DB schema changes
- New integrations

Require:
- ADR
- Checklist validation
- CI green
- Reviewer approval

---

## AI Agent Rules

AI agents must:
- Load `ai/AGENT_INSTRUCTIONS.md`
- Validate against `ai/checklist.yml`
- Produce explainable, auditable changes

Non-compliant AI output must be rejected.

---

## Enforcement Mechanisms

- CI Quality Gate
- Middleware protection
- Swagger validation
- Logging requirements
- ADR history

---

## Philosophy

> We prefer **boring, explicit, observable systems**  
> over clever but fragile solutions.
