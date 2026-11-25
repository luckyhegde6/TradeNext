---
name: superpowers
description: Productive working rhythm: build, verify, commit, hand off — small steps, real verification, never claim done without proof.
---

# superpowers — Productive Rhythm

Source: https://github.com/obra/superpowers — see `brainstorming/SKILL.md` + the superpowers skill set.

Rules for working:
1. **Plan small**: break work into steps, each with a verify step (`npx tsc --noEmit`, `npm run test -- <suite>`, etc.).
2. **Verify before claiming**: a claim needs evidence — run the check, read the output, then say done.
3. **Commit often**: on the feature branch; each commit passes precommit (or note why skipped).
4. **Hand off**: update `.agents/session-todos.md` + checkpoint log at the end of each step.
5. If stuck: change method/tool/assumption — never repeat an identical failing step.
