# Session Memory: Decisions & Flow Logs (MANDATORY)

> Every coding session MUST maintain a per-session folder with two live files:
> `decisions.md` (decisions + reasoning) and `flow.md` (execution path + code touched).
> These are written DURING the session (like session-todos), not retrofitted at the end.

## The Rule (hard contract)

**Before writing ANY code, create the session folder** and keep both files current as you work:

```
.agents/sessions/<YYYY-MM-DD>-<first-8-commit-hash>/
├── decisions.md   ← decision log
└── flow.md        ← execution flow
```

- Folder name = session date + first 8 chars of the commit hash at session start
  (or of the first commit of the session when starting before any commit exists).
  If the hash is unavailable, fall back to `<YYYY-MM-DD>-<phase>` (e.g. `2026-08-06-ph19`).
- Archive sessions are still summarized in `README.md`; the folder IS the detail store.

## 1. `decisions.md` — Decision Log

Log every MEANINGFUL decision while coding, with reasoning. Template:

```markdown
## D<N>. <Short title>

**Decision:** <what was decided>

- *Context:* <what triggered the decision>
- *Why this approach:* <reasoning — alternatives considered, tradeoffs, evidence>
- *Impact:* <files / packages added, modified, removed — and WHY each>
```

Also log, in a transparency block at the bottom:

- Accidental prod/Db mutations and their remediation (e.g., "removed a model by UI click, restored via API").
- Anything the user approved explicitly (that approval is the justification).

## 2. `flow.md` — Execution Flow

Shows where execution actually travels. Include:

1. **Symptom** — what broke / what was asked.
2. **Root-cause trace** — the exact call chain (entry point → modules → endpoints), with file:line for the defect.
3. **Code changed this session** — table: File | Change | Why.
4. **Verified so far** — facts confirmed by test/curl/UI.
5. **Verification matrix (definition of done)** — check | command/action | pass criterion.
6. **Execution order (replay)** — numbered steps for reproducing the session's work.

## 3. When (maintenance cadence)

| Event | Action |
|-------|--------|
| New decision (approach, package add/remove, workaround) | Append to `decisions.md` with reasoning |
| New file/call-path discovered | Update `flow.md` root-cause trace |
| File modified / package added or removed | Update `flow.md` "Code changed" table |
| Before commit | Both files current (pre-commit checklist item) |
| End of session | Files stay in the session folder; summarize in `sessions/README.md` |

## 4. Package changes

When you `npm install`/add/modify/remove a dependency, the `decisions.md` entry MUST state:
- the package name + version,
- WHY it was needed (problem it solves),
- alternatives considered,
- whether it is a runtime dep or devDep.

## 5. Reference

- Rule owner: `.agents/rules/session-memory-rules.md` (section 3).
- Index: `.agents/sessions/README.md`.
- Example of a live session folder: `.agents/sessions/2026-08-11-c995a10/`.