# Session Archives

Completed sessions are archived here as folders: `YYYY-MM-DD-<commit-hash>/`.

## Format (folder per session)

```text
YYYY-MM-DD-<first-8-commit-hash>/
├── decisions.md   ← every meaningful decision + reasoning (why this approach, why this package/file changed)
└── flow.md        ← execution flow: entry point → call order, files changed, verification matrix
```

### decisions.md

```markdown
## D<N>. <Short title>
**Decision:** <what>
- *Context:* <trigger>
- *Why this approach:* <reasoning / alternatives>
- *Impact:* <files/packages added-modified-removed + why>
```

### flow.md

```markdown
## 1. Symptom
## 2. Root-cause trace          ← call chain with file:line
## 3. Code changed this session ← File | Change | Why
## 4. Verified so far
## 5. Verification matrix (DoD) ← check | command | pass
## 6. Execution order (replay)
```

## Hard rule

Writing these two files is **mandatory while coding** — see
`.agents/rules/session-decisions-flow.md`. If they don't exist, the work isn't
tracked correctly and the commit is not ready.

## Rules

1. Create the session folder + both files at session start, before writing code.
2. Folder name: `YYYY-MM-DD-<first-8-commit-hash>` (hash = start-of-session HEAD; fall back to `-<phase>` e.g. `ph19` if no commit yet).
3. Update `decisions.md` when a decision is made; update `flow.md` when code changes.
4. On session close: summarize in this README's "Existing Sessions" list; archive session-todos.
5. Never delete a session folder — they are the session history.

## Existing Sessions

- **2026-08-11-c995a10** — Prod verification of #69/#68/v3.5.2 screener fixes; root-caused stale Daily Recommendations to the AI config plumbing gap (pipeline used env-only default model; DB `ai_config` never reached `analyzeStocks`) + stale `AVAILABLE_MODELS`/`DEFAULT_MODEL` (referenced nonexistent OpenRouter models). Fix: shared `loadConfig()` in `lib/services/ai/config.ts`, wired into `dailyRecommendationService`, model list refreshed vs live catalog.
- 2026-08-06 — ph19 session (v3.4.1 prod reliability + v3.4.2 git hooks/docs port). Legacy flat-file archive: `2026-08-06-6cfe281.md`.