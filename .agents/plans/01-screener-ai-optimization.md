# Implementation Plan — Screener Pipeline & AI Quota Optimization

## Spec Reference

- **Spec**: `.agents/specs/01-screener-ai-optimization.md`
- **Branch**: `fix/screener-ai-optimization`
- **Created**: 2026-08-19

---

## Implementation Steps

### Phase 1: 429 Early-Exit (Highest Impact — Stops Quota Waste)

1. **Add 429 detection in `recommendation-agent.ts` `analyzeBatch()`** → verify: `npx tsc --noEmit`
   - After `directPrompt()` returns, check if response contains "429" or "Rate limit"
   - If 429: log warning, return failed results for all stocks in batch, do NOT retry
   - If other error: existing retry logic unchanged

2. **Add 429 detection in `swing-agent.ts` `analyzeBatch()`** → verify: `npx tsc --noEmit`
   - Same pattern as recommendation-agent
   - Add `stopAllBatches` flag (shared across workers) to abort remaining batches on 429

3. **Write tests for 429 early-exit** → verify: `npm run test`
   - Test: 429 on first attempt returns failed results (no retry)
   - Test: 429 in swing-agent stops remaining batches
   - Test: non-429 errors still retry normally

### Phase 2: Connection Test Skip (Saves ~20-30 req/day)

4. **Add `shouldSkipConnectionTest()` in `connectionTestService.ts`** → verify: `npx tsc --noEmit`
   - Query `ServerLog` for last successful test (source="ai", action="connection_test", status="ok")
   - If found within 2 hours: return `true` (skip)
   - If not found or older: return `false` (run test)
   - Never throw — on DB error, return `false` (run test)

5. **Wire skip logic into cron daemon** → verify: `npx tsc --noEmit`
   - In `spawnDueCronJob()` or task execution, check `shouldSkipConnectionTest()` before spawning
   - If skip: log info, advance nextRun, do NOT create WorkerTask
   - If run: proceed as normal

6. **Write tests for skip logic** → verify: `npm run test`
   - Test: recent test < 2h → skip
   - Test: no recent test → run
   - Test: last test failed → run
   - Test: DB error → run (safe default)

### Phase 3: Screener DB Batch (Saves ~15-25s wall time)

7. **Add `getChartinkScreenerResultsForRun()` in `chartinkScreenerService.ts`** → verify: `npx tsc --noEmit`
   - Single `findMany` with `screenerId IN (...)` and `expiresAt > now()`
   - Group results by `screenerId` in-memory
   - Return `Map<string, ChartinkCapturedRow[]>`

8. **Replace sequential DB reads in `chartinkUnifiedScreenerService.ts`** → verify: `npx tsc --noEmit`
   - Stage 1: replace `for...of` loop with single batch call
   - Get all fresh IDs first, then batch-fetch all results
   - Keep fallback: if batch fails, log warning and continue with empty results

9. **Write tests for batched DB reads** → verify: `npm run test`
   - Test: batch returns same results as sequential
   - Test: partial failure (some IDs missing) returns available results
   - Test: DB error returns empty map (safe default)

### Phase 4: Chartink Throttling (Prevents HTTP 419 Bursts)

10. **Add throttled Chartink fetch in `chartinkUnifiedScreenerService.ts`** → verify: `npx tsc --noEmit`
    - Replace `Promise.all(clauseTemplates.map(...))` with chunked execution
    - Chunk size: 5 templates per batch
    - Delay: 500ms between chunks
    - Abort on 419: if any template returns 419, stop remaining chunks
    - Log: "Chartink rate-limited, falling back to TradingView for N templates"

11. **Write tests for throttled fetch** → verify: `npm run test`
    - Test: processes 5 templates at a time
    - Test: 419 on first chunk skips remaining
    - Test: all chunks complete when no 419

### Phase 5: Documentation

12. **Update AGENTS.md** → verify: version row added
    - Add v3.18.0 row: "Screener pipeline optimization + AI quota management"

13. **Update CHANGELOG** → verify: `.agents/changelog/versions-v3.18.md` created
    - Detail: 5 optimization areas, request count reduction, wall time improvement

14. **Update Lessons.md** → verify: new lesson added
    - Lesson: "OpenRouter free tier is 50 requests/day — connection tests alone can exhaust it"
    - Lesson: "Always detect 429 explicitly — don't retry on exhausted quota"

15. **Update TODO.md** → verify: row added

16. **Create session memory** → verify: `decisions.md` + `flow.md` in `.agents/sessions/`

---

## Test Strategy

### Unit Tests (Required)

| Test | File | What It Verifies |
|------|------|------------------|
| 429 stops recommendation batch | `ai429Exit.test.ts` | No retry on quota exhausted |
| 429 stops swing batches | `ai429Exit.test.ts` | Shared stop flag works |
| Skip test when recent passed | `connectionTestSkip.test.ts` | 2-hour window works |
| Run test when no recent | `connectionTestSkip.test.ts` | Safe default |
| Batch DB matches sequential | `chartinkBatchDb.test.ts` | Same results |
| Throttled fetch chunks | `chartinkThrottle.test.ts` | 5-at-a-time processing |
| 419 stops remaining chunks | `chartinkThrottle.test.ts` | Early abort |

---

## Verification Checklist

```bash
# Type checking
npx tsc --noEmit                    # 0 new errors (baseline: 46)

# Tests
npm run test                        # All pass (baseline: 800 pass / 4 skip)
npm run lint                        # No warnings

# Build
npm run quickbuild                  # Production build succeeds
```

---

## Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| Skip test could miss model failure | 2-hour window is conservative; pre-flight at 10 AM IST still runs | No |
| Throttled fetch adds ~2s delay | Only affects fresh DB misses; most hits are cached | No |
| Batch DB query could be slower for small sets | Fallback to sequential on error | No |
| 429 detection could false-positive | Check both status code AND error message | No |

---

## Documentation Checklist

- [ ] **AGENTS.md** — version row v3.18.0
- [ ] **CHANGELOG** — `.agents/changelog/versions-v3.18.md`
- [ ] **TODO.md** — optimization row
- [ ] **Lessons.md** — 2 new lessons (quota budget, 429 detection)
- [ ] **Primer.md** — current status
- [ ] **agent-memory.md** — activity entry
- [ ] **Session memory** — `decisions.md` + `flow.md`

---

## Pre-Commit Gate

1. `npx tsc --noEmit` — 0 new errors
2. `npm run test` — all pass
3. `npm run lint` — no warnings
4. `git status` — no junk artifacts, no secrets in diff
5. Documentation updated per checklist above
6. Engineering checklist (`.agents/rules/checklist.md`) validated
