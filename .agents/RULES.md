# RULES — TradeNext Agentic Operating Rules

> Master rules for AI agents working in this repo. Read on first session / fresh clone, then rely on `.agents/rules/` files for details. Keep this file short — it points to the source of truth for each rule.

## 0. Order of Operations

1. **Read state** — HANDOFF.md → `.agents/handoffs/active/latest.md` → Primer.md → Lessons.md → `.agents/session-todos.md` (see `.agents/rules/session-memory-rules.md`)
2. **Plan** — convert task into verifiable goals (tests pass, tsc clean, docs updated)
3. **Implement** — minimal code, one todo at a time, update session-todos in real time
4. **Verify** — `npm run test` (alone, never chained), `npx tsc --noEmit`, `npm run lint`
5. **Document** — AGENTS.md version entry + TODO.md + Lessons.md (mandatory)
6. **Clean** — git status review, delete junk artifacts (`.agents/code-hygiene.md`)
7. **Hand off** — update latest.md, archive session, update HANDOFF.md + Primer.md

## 0. Behavioral Guidelines (Think → Simplify → Surgical → Verify)

Merged from the CLAUDE.md operating contract. Tradeoff: **caution over speed** — for trivial tasks use judgment.

1. **Think Before Coding**
   - State assumptions explicitly. If uncertain, ask — don't guess silently.
   - Multiple interpretations? Present them — don't pick silently.
   - Simpler approach exists? Say so. Push back when warranted.
   - Something unclear? STOP, name what's confusing, ask.

2. **Simplicity First**
   - Minimum code that solves the problem. Nothing speculative. (`.agents/code-hygiene.md`)
   - No features beyond what was asked. No abstractions for single-use code.
   - "Would a senior engineer say this is overcomplicated?" If yes, rewrite it.

3. **Surgical Changes**
   - Touch only what you must. Don't "improve" adjacent code or formatting.
   - Match existing style, even if you'd do it differently. Mention dead code — don't delete it.
   - Remove imports/vars/functions YOUR changes orphaned; not pre-existing dead code.
   - Test: every changed line traces directly to the user's request.

4. **Goal-Driven Execution**
   - Define success criteria; loop until verified.
   - "Add validation" → "write tests for invalid inputs, then make them pass"
   - "Fix the bug" → "write a test that reproduces it, then make it pass"
   - Multi-step tasks get a plan: `[Step] → verify: [check]` per step.
   - Strong criteria = loop independently; weak criteria = ask.

## 1. Minimal Code (Ponytail)

- Minimum code that solves the problem. Nothing speculative. (`.agents/code-hygiene.md`)
- No features beyond what was asked. No abstractions for single-use code.
- "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 2. Surgical Changes

- Touch only what the request requires. Don't "improve" adjacent code.
- Remove imports/variables/functions YOUR changes made unused. Don't delete pre-existing dead code.
- Every changed line traces to the user's request.

## 3. Verification Before Claims

- **Self-healing:** verify before claiming — run tests/tsc/lint after any change.
- **Anti-hallucination:** every claim traces to a commit, tracked doc, passing test, or verified live check. Grep/read files — never invent paths or API shapes.
- **Trust the repo over memory** — re-read files when unsure.

## 4. Session & Memory Discipline

- Exactly ONE `in_progress` todo at a time. Update `.agents/session-todos.md` in real time.
- Handoff = files, not prose. Next agent resumes from files, never conversation memory.
- Archives go to `.agents/sessions/YYYY-MM-DD-<hash>.md`. Load archives only when needed.
- Memory tool: cross-session knowledge only (entities/relations), not session trivia.

## 5. Documentation Is Not Optional

- **If documentation is not updated, the task is NOT complete.**
- Minimum: AGENTS.md version entry, TODO.md, Lessons.md (new discovery), session-todos before commit.
- API changes → route table + Swagger/OpenAPI + skill files (`.agents/documentation-standards.md`).

## 6. Git Rules (STRICT)

- **NEVER commit to main without explicit user permission** — branch + PR always (`feat/`, `fix/`, `docs/`, `ph<N>`). Solo work is NOT an exception.
- Feature branches: implement → test → commit → push → PR (main ← branch) → squash-merge on green. Full flow in `.agents/linear-history.md`.
- Never force-push, never `--no-verify` unless intentional, never commit secrets/junk.
- Commit message: `type(scope): description` (full table in `.agents/linear-history.md`).
- Pre-push: tests pass + tsc clean + docs updated.

## 7. Sensitive Operations — ALWAYS ASK

Before proceeding, ask explicit permission for:
- **Database modifications** — Prisma migrations, schema changes, data modifications
- **Environment files** — any change to `.env*`
- **Package installations** — npm install / new dependencies
- **Auth/Admin changes** — auth, authorization, admin routes
- **Production deployments** — anything affecting production
- **Process kills** — only kill processes YOU started; never kill port 4096 (OpenCode), DB, or system services

## 8. Prisma Guardrails

- Protected (require explicit consent): `migrate reset --force`, `db drop`.
- Safe: `migrate dev`, `db push`, `generate`.
- If the CLI blocks a destructive action, STOP → INFORM → EXPLAIN → VERIFY → WAIT.

## 9. Security Baseline

- No secrets in client code or `NEXT_PUBLIC_*` env. No hardcoded passwords (Netlify scans).
- Validate all external input (Zod). Parameterized queries via Prisma. Sanitize user content.
- Log with `logger` (pino), never `console.log` in production. Log start/success/error with context.

## 10. Engineering Checklist

Every change validated against `.agents/rules/checklist.md` (architecture, API design, security, performance, UI/UX, logging, maintainability). Final gate: checklist passed + swagger updated + security reviewed + logs added.
