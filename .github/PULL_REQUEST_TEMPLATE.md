# Pull Request — [title]

## Review Ready

- **Scope** — 1 isolated change: describe in one line.
- **Self-reviews & AI strips leftovers** — the diff was read end-to-end; no AI/exploratory leftovers, no speculative extras.
- **Documentation** — architectural "WHY" only (state the reason, not the diff restated).
- **Trade-offs & blast radius** — alternatives considered; who is affected (users / ops / deploy); rollback notes.
- **Failure paths & edge testing** — how failure is covered (tests, manual cases, degraded mode).

## Diff Owner

- **Trace** — state flow: where data comes in, what is stored, what goes out.
- **Concurrency & edge paths** — races, timeouts, duplicates, empty inputs.
- **Stripped abstractions** — anything not needed is removed.
- **Ship-only-debuggable** — every line is traceable in the repo logs.

## Context Engineered

- **Spec / Plan anchor** — linked spec + plan (or "n/a — small fix").
- **Boundaries** — data and module boundaries locked; scope of influence.
- **Conventions & non-goals** — conventions followed; non-goals called out.
- **Verification check-ups** — how verified: `npx tsc --noEmit`, `npm run test -- <suite>`, e2e, manual.

## Impact

- **Feature / change highlight** — what changed.
- **Impact** — behavior, performance, function-size, deploy effects.
