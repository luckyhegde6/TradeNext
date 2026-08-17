# Session Decisions — 2026-08-17 (v3.14.0 Swing Signal Persistence + Performance Tracking + Spec-Driven Dev)

## Key Decisions

### 1. SwingSignal schema: `@@unique([jobId, symbol])`
- **Decision**: unique constraint on (jobId, symbol) with `skipDuplicates` on createMany.
- **Reasoning**: prevents duplicate signals if a job is re-processed (e.g., force refresh supersedes a pending job). `skipDuplicates` is non-fatal — idempotent.
- **Alternative considered**: no unique constraint + manual dedup query → more complex, race-prone.

### 2. Persistence at two points: creation + completion
- **Decision**: `persistSwingSignals` at job creation (snapshots posted picks), `patchSwingSignalAnalysis` at completion (patches AI levels).
- **Reasoning**: creation-time snapshot captures the pick state before analysis modifies it. Completion-time patch adds the AI analysis (direction, confidence, targets) only for stocks that were successfully analyzed.
- **Alternative considered**: persist only at completion → loses the pre-analysis pick state.

### 3. Performance evaluator: direction-aware (mirrors recommendation level evaluator)
- **Decision**: `evaluateSwingSignalStatus` handles LONG and SHORT differently (LONG target >= targetPrice, SHORT target <= targetPrice).
- **Reasoning**: mirrors the v3.6.3 `evaluateRecommendationLevels` pattern. Symmetry prevents the ITC SELL bug (BUY-style levels on a SELL).
- **Alternative considered**: direction-blind evaluator → would repeat the ITC bug.

### 4. SWING_DONE_CACHE_TTL = 24h
- **Decision**: done/files cached for 24h (until next swing run supersedes).
- **Reasoning**: swing signals are evaluated daily; caching done state for 24h avoids redundant DB queries while ensuring fresh data on next run.

### 5. staticCache.del on supersede + job create
- **Decision**: delete stale cache entries when a new job is created or a force-refresh supersedes.
- **Reasoning**: prevents stale pending/running entries from being served after a supersede. v3.12.0 had `SWING_PENDING_TTL` (10min) for this; now the cache is explicitly invalidated.

### 6. Spec-driven development: mandatory for all features
- **Decision**: created spec template, plan template, workflow rules, checklist gate.
- **Reasoning**: features were being implemented without written specs, leading to scope creep and missed edge cases. The spec captures requirements BEFORE code; the plan captures exact implementation steps.
- **Alternative considered**: optional spec (only for complex features) → still allows ad-hoc implementation for "simple" features that turn out to be complex.

### 7. Worker-logs: `cwd/worker_logs` as first candidate
- **Decision**: `resolveLogsDir()` tries `cwd/worker_logs` first, then `os.tmpdir()/tradenext-logs`, then DB fallback.
- **Reasoning**: worker logs should be persistent (not in tmpdir); `cwd/worker_logs` is gitignored and persistent on Netlify.
- **Alternative considered**: keep `.next/server_logs` as first candidate → was the old path, but `.next` is build output and may be cleaned.

### 8. Lesson #82: spec-driven development as a lesson
- **Decision**: added as a formal lesson in Lessons.md.
- **Reasoning**: this is a process pattern that should be enforced across all future sessions, not just a one-time implementation note.
