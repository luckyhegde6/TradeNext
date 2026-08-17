# Spec-Driven Development — TradeNext

> **Mandatory for all feature development.** Specs create a shared contract between human and agent before any code is written. Plans break the spec into atomic, verifiable steps. Together they prevent scope creep, missed edge cases, and undocumented behavior.

## 1. Workflow Overview

```
Human Request → Spec → Review → Plan → Implement → Verify → Commit
```

**Every feature follows this flow. No exceptions.** Trivial fixes (typo, import reorder, comment update) may skip the spec but MUST still be documented in the commit message and session memory.

---

## 2. Initial Action Steps (Every Feature)

> These steps are executed IN ORDER before any implementation begins.

### Step 1: Pull Latest Code
```bash
git pull origin main
```
Always start from the latest main. Never work on a stale branch.

### Step 2: Create Feature Branch
```bash
git checkout -b feature/<feature-name>
```
Branch naming: `feature/<short-name>`, `fix/<short-name>`, `docs/<short-name>`.

### Step 3: Create Spec Document
- Copy `.agents/templates/spec-template.md` → `.agents/specs/NN-<feature-name>.md`
- `NN` = sequential number (01, 02, 03…)
- Fill in ALL sections. Delete N/A only with written justification.
- **Spec must be reviewed by human before proceeding.**

### Step 4: Review Spec
- Human reviews the spec document
- Agent answers questions, clarifies ambiguity
- Spec is finalized (no changes during implementation unless re-reviewed)

### Step 5: Save Spec
```bash
# Spec is saved to:
.agents/specs/NN-<feature-name>.md
```

### Step 6: Enter Plan Mode
- Read the finalized spec
- Read existing code that will be modified
- Generate implementation plan from `.agents/templates/plan-template.md`
- Save to `.agents/plans/NN-<feature-name>.md`
- Plan must include: ordered steps, test strategy, verification commands, doc checklist

### Step 7: Implement the Plan
- Follow the plan steps IN ORDER
- Each step: implement → verify (run the check command) → mark done
- If a step fails: diagnose, fix, re-verify. Never skip a failing step.
- Review edits manually before moving to next step

### Step 8: Validate Against Spec
- Run EVERY verification command from the plan
- Check EVERY Definition of Done item from the spec
- Run `npm run test` + `npx tsc --noEmit` + `npm run lint`
- Live-verify on :3000 (if UI change)
- If ANY item fails → fix → re-verify

### Step 9: Iterate if Required
- If spec was incomplete: update spec, update plan, re-implement
- If implementation revealed new requirements: update spec, get human approval, continue
- Never silently change behavior from what the spec says

---

## 3. When to Create Specs

### ALWAYS Create a Spec
| Situation | Reason |
|-----------|--------|
| New feature | Full contract needed |
| New API route | Input/output/auth must be defined |
| New Prisma model | Schema changes affect all consumers |
| New UI page/component | States, responsive, accessibility |
| New cron job / background task | Schedule, idempotency, failure modes |
| New MCP function | Schema, caching, auth |
| Bug fix with behavior change | Old vs new behavior documented |
| Security-related change | Threat model, auth rules |

### MAY Skip Spec (Still Document)
| Situation | Minimum Required |
|-----------|-----------------|
| Typo fix | Commit message explains |
| Import reorder | Commit message explains |
| Comment update | Commit message explains |
| Dependency bump | Commit message + changelog |
| Config-only change | Commit message |

---

## 4. Spec Rules

### Structure
- Every spec follows `.agents/templates/spec-template.md`
- Sections may be marked N/A but must include justification
- No ambiguous language ("should", "might", "probably") — use "MUST", "will", "returns"

### Content
- **Functions**: signature, purpose, return type, error behavior
- **Routes**: method, path, auth, request/response shapes
- **Schema**: exact Prisma model (copy-pasteable)
- **Tests**: specific test cases, not "add tests"
- **Definition of Done**: checkbox items that can be verified

### Storage
- Location: `.agents/specs/NN-<feature-name>.md`
- `NN` is sequential per directory (reset per epic/branch)
- Specs are **never deleted** — they are the permanent record of intent

---

## 5. Plan Rules

### Structure
- Every plan follows `.agents/templates/plan-template.md`
- Steps are ordered (dependencies respected)
- Each step has a verification command
- Test strategy lists specific test cases from the spec

### Content
- Steps are **atomic**: each can be verified independently
- Steps include the exact file path and function name
- Verification commands are **copy-pasteable** (no ambiguity)
- Risks and tradeoffs are documented explicitly

### Storage
- Location: `.agents/plans/NN-<feature-name.md`
- Plans are **never deleted** — they are the permanent record of execution

---

## 6. Agent Responsibilities

### Before Implementation
1. Read the spec carefully — understand ALL requirements
2. Read existing code that will be modified
3. Generate the plan from the spec
4. Get human approval on the plan before coding

### During Implementation
1. Follow the plan steps IN ORDER
2. Verify each step before moving to the next
3. Never skip a failing step
4. Never silently change behavior from the spec
5. Update `session-todos.md` with current progress

### After Implementation
1. Run ALL verification commands from the plan
2. Check ALL Definition of Done items from the spec
3. Update documentation (AGENTS.md, CHANGELOG, TODO, Primer, agent-memory, Lessons)
4. Create session memory (`decisions.md` + `flow.md`)
5. Ask human before committing

---

## 7. Human Responsibilities

### Before Implementation
1. Review the spec document
2. Ask questions, clarify requirements
3. Approve the spec (explicit approval required)

### During Implementation
1. Available for questions (agent asks via `question` tool)
2. Review implementation at key milestones (after each phase)

### After Implementation
1. Review the diff
2. Approve commit
3. Decide on merge/deploy timing

---

## 8. Hook Integration

### Pre-Commit Hook
The existing `.githooks/pre-commit` hook is extended to check:
- Spec file exists in `.agents/specs/` for the current branch
- Plan file exists in `.agents/plans/` for the current branch
- If missing: WARN (not block) with message "No spec/plan found for this feature. Consider creating one."

### Session Memory
The session memory (`decisions.md`) MUST include:
- Spec reference (file path)
- Plan reference (file path)
- Any deviations from the plan (with reasoning)

### Documentation
Every feature MUST update:
- AGENTS.md version table row
- CHANGELOG detail file
- TODO.md quick-reference row
- Primer.md status
- agent-memory.md activity log
- Lessons.md (if new pattern discovered)
- Session memory (decisions.md + flow.md)

---

## 9. Quality Gates

> These gates MUST pass before the feature is considered complete.

### Gate 1: Spec Approved
- [ ] Spec follows template
- [ ] All sections filled (N/A justified)
- [ ] Human approved the spec

### Gate 2: Plan Approved
- [ ] Plan follows template
- [ ] Steps are ordered and atomic
- [ ] Each step has a verification command
- [ ] Test strategy covers spec requirements
- [ ] Human approved the plan

### Gate 3: Implementation Complete
- [ ] All plan steps done
- [ ] All verification commands pass
- [ ] `npx tsc --noEmit` — 0 new errors
- [ ] `npm run test` — all pass
- [ ] `npm run lint` — no warnings

### Gate 4: Documentation Complete
- [ ] AGENTS.md updated
- [ ] CHANGELOG updated
- [ ] TODO.md updated
- [ ] Primer.md updated
- [ ] agent-memory.md updated
- [ ] Lessons.md updated (if applicable)
- [ ] Session memory created

### Gate 5: Verification Complete
- [ ] All spec Definition of Done items checked
- [ ] Live-verified on :3000 (if UI change)
- [ ] 0 console errors
- [ ] Responsive at 375px, 768px, 1440px (if UI change)

---

## 10. Exceptions & Escalations

### If Spec is Incomplete
- STOP implementation
- Document what's missing
- Update spec, get human approval
- Continue

### If Implementation Reveals New Requirements
- STOP implementation
- Document the new requirement
- Update spec + plan, get human approval
- Continue

### If Verification Fails
- Diagnose the failure
- Fix the issue
- Re-verify
- Never skip or ignore a failing check

### If Human is Unavailable
- Document the blocker in session-todos
- Update handoff with `status: blocked`
- Wait for human response
- Never auto-approve or auto-merge

---

## 11. Example Workflow

```
1. git pull origin main
2. git checkout -b feature/swing-performance-tracker
3. cp .agents/templates/spec-template.md .agents/specs/01-swing-performance-tracker.md
4. [Fill in spec sections 1-15]
5. Human reviews and approves
6. [Generate plan from spec → .agents/plans/01-swing-performance-tracker.md]
7. Human approves plan
8. Implement Phase 1: Database → npx prisma validate → ✅
9. Implement Phase 2: Service → npx tsc --noEmit → ✅
10. Implement Phase 3: API → curl test → ✅
11. Implement Phase 4: UI → responsive check → ✅
12. Implement Phase 5: Tests → npm run test → ✅
13. Implement Phase 6: Docs → all updated → ✅
14. Validate against spec: all DoD items checked → ✅
15. git add . && git commit → human approves
```

---

## 12. Templates

| Template | Location | Purpose |
|----------|----------|---------|
| Spec | `.agents/templates/spec-template.md` | Feature specification |
| Plan | `.agents/templates/plan-template.md` | Implementation plan |

---

## 13. Directory Structure

```
.agents/
├── templates/
│   ├── spec-template.md          # Spec template
│   └── plan-template.md          # Plan template
├── specs/
│   ├── 01-feature-name.md        # Feature spec
│   └── 02-another-feature.md     # Another feature spec
├── plans/
│   ├── 01-feature-name.md        # Implementation plan
│   └── 02-another-feature.md     # Another implementation plan
├── rules/
│   └── spec-driven-development.md # This file (workflow rules)
└── sessions/
    └── YYYY-MM-DD-<hash>/
        ├── decisions.md           # Includes spec + plan references
        └── flow.md                # Includes spec + plan references
```
