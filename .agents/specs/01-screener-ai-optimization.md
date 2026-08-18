# Spec Document — Screener Pipeline & AI Quota Optimization

## 1. Overview

**What**: Optimize the daily recommendation pipeline to reduce OpenRouter API consumption (from ~80-97 to ~25-35 requests/day), parallelize sequential DB reads in the screener, and add throttled Chartink fetching to prevent rate-limit bursts.

**Why**: The OpenRouter free tier (50 requests/day) is exhausted before swing analysis starts. Root cause: connection test cron consumes 28-42 requests/day alone. Secondary: screener DB reads are sequential (234 serial round-trips) and Chartink fetches fire unbounded (HTTP 419).

**Scope**:
- IN: Connection test frequency reduction, 429 early-exit, screener DB parallelization, Chartink throttling
- OUT: New AI providers, batch size changes, swing agent changes, DB schema changes

**Depends on**: Nothing (pure optimization, no new models/routes)

---

## 2. Routes

No new routes. No modified routes.

---

## 3. Database Schema

None. No migration needed.

---

## 4. Functions to Implement

### A. `lib/services/ai/connectionTestService.ts`

#### `shouldSkipConnectionTest(): Promise<boolean>`

- Check if last successful connection test was within `SKIP_WINDOW_MS` (2 hours)
- Query `ServerLog` where `source="ai"` AND `action="connection_test"` AND `status="ok"`
- Returns `true` if recent test passed (skip cron test to save requests)
- Returns `false` if no recent test or last test failed
- Used by: cron daemon before spawning `ai_connection_test` task

### B. `lib/services/ai/recommendation-agent.ts`

#### Early 429 exit in `analyzeBatch()`

- When `directPrompt()` returns HTTP 429, stop immediately
- Do NOT retry on primary model (daily quota exhausted)
- Do NOT fall back to other models (same quota)
- Log clearly: "OpenRouter daily quota exhausted — stopping batch"
- Return failed results for all stocks in batch

### C. `lib/services/ai/swing-agent.ts`

#### Early 429 exit in `analyzeBatch()`

- Same pattern as recommendation-agent
- When 429 detected, stop all remaining batches
- Log clearly: "OpenRouter daily quota exhausted — stopping swing analysis"

### D. `lib/services/chartinkUnifiedScreenerService.ts`

#### `fetchChartinkScanThrottled(templates, options)`

- Replace unbounded `Promise.all(clauseTemplates.map(...))` with chunked execution
- Chunk size: 5 templates per batch
- Delay: 500ms between chunks (respects Chartink rate limits)
- Abort on HTTP 419: if first chunk gets 419, skip remaining chunks (go straight to TV fallback)
- Saves: ~50% of Chartink HTTP calls (most fail with 419 anyway)

### E. `lib/services/chartinkUnifiedScreenerService.ts`

#### `getChartinkScreenerResultsBatch(templateIds)`

- Replace sequential `for...of` with single batched query
- ONE `findMany` on `ChartinkScreenerResult` where `screenerId IN (...)` AND `expiresAt > now()`
- Group results by `screenerId` in-memory
- Returns `Map<string, ChartinkCapturedRow[]>`
- Saves: ~234 serial queries → 1 query

### F. `lib/services/chartinkScreenerService.ts`

#### `getChartinkScreenerResultsForRun(runId, screenerIds)`

- Batch version of `getChartinkScreenerResults()`
- Fetches all results for multiple screener IDs in one query
- Used by the unified runner for Stage 1 DB reads

---

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `lib/services/ai/connectionTestService.ts` | Modified | Add `shouldSkipConnectionTest()` |
| `lib/services/ai/recommendation-agent.ts` | Modified | Add 429 early-exit in `analyzeBatch()` |
| `lib/services/ai/swing-agent.ts` | Modified | Add 429 early-exit in `analyzeBatch()` |
| `lib/services/chartinkUnifiedScreenerService.ts` | Modified | Add throttled Chartink fetch + batched DB reads |
| `lib/services/chartinkScreenerService.ts` | Modified | Add `getChartinkScreenerResultsForRun()` |
| `lib/services/worker/cron-daemon.ts` | Modified | Call `shouldSkipConnectionTest()` before spawning |
| `lib/__tests__/connectionTestSkip.test.ts` | **Created** | Tests for skip logic |
| `lib/__tests__/chartinkThrottle.test.ts` | **Created** | Tests for throttled fetch |
| `lib/__tests__/chartinkBatchDb.test.ts` | **Created** | Tests for batched DB reads |
| `lib/__tests__/ai429Exit.test.ts` | **Created** | Tests for 429 early-exit |

---

## 6. Dependencies

### New Packages

None.

### Internal Dependencies

| Module | Function Used | Purpose |
|--------|---------------|---------|
| `@/lib/prisma` | `prisma.serverLog.findFirst` | Check last connection test |
| `@/lib/prisma` | `prisma.chartinkScreenerResult.findMany` | Batch DB reads |
| `@/lib/logger` | `logger.info/warn/error` | Structured logging |

---

## 7. API Contract

No API changes. All optimizations are internal.

---

## 8. UI/UX Requirements

None. No UI changes.

---

## 9. Rules & Guardrails

- [ ] No Prisma in client components
- [ ] All DB operations use parameterized queries
- [ ] Errors return safe defaults, never expose internals
- [ ] Logging via `@/lib/logger` only
- [ ] Background sync is fire-and-forget
- [ ] 429 detection must be explicit (check HTTP status, not error message)

---

## 10. Expected Behavior

1. Connection test cron: if last test passed within 2 hours, skip the cron test
2. Daily recs AI analysis: if HTTP 429 received, stop all batches immediately
3. Swing analysis: if HTTP 429 received, stop all batches immediately
4. Screener DB reads: 117 templates fetched in 1 query (not 234 serial)
5. Chartink fetch: 5 templates at a time with 500ms delay between chunks
6. Chartink fetch: if first chunk gets 419, skip remaining chunks
7. Total API calls per day: ~25-35 (down from ~80-97)

---

## 11. Error Handling

| Scenario | Behavior | Log Level |
|----------|----------|-----------|
| 429 on AI batch | Stop immediately, return failed results | `warn` |
| Chartink 419 on first chunk | Skip remaining chunks, go to TV fallback | `warn` |
| DB batch query fails | Fall back to sequential per-template reads | `warn` |
| Last test query fails | Don't skip (run the test) | `warn` |

---

## 12. Test Strategy

### Unit Tests

- [ ] `shouldSkipConnectionTest` returns true when last test < 2h ago
- [ ] `shouldSkipConnectionTest` returns false when last test > 2h ago
- [ ] `shouldSkipConnectionTest` returns false on DB error
- [ ] 429 in recommendation-agent stops batch (no retry)
- [ ] 429 in swing-agent stops all batches
- [ ] Throttled fetch processes 5 templates at a time
- [ ] Throttled fetch skips remaining on 419
- [ ] Batched DB query returns same result as sequential

---

## 13. Performance Considerations

- **API calls**: ~80-97 → ~25-35 per day (60-65% reduction)
- **DB queries**: 234 serial → 1 batched (Stage 1)
- **Chartink HTTP**: Unbounded → 5 concurrent with 500ms delay
- **Wall time**: Screener phase ~15-25s faster (parallel DB + throttled HTTP)

---

## 14. Security Considerations

- No auth changes
- No secrets exposed
- 429 handling is explicit (not silent)

---

## 15. Definition of Done

- [ ] All functions implemented per section 4
- [ ] All files modified per section 5
- [ ] `npx tsc --noEmit` passes (0 new errors)
- [ ] `npm run test` passes (all existing + new tests)
- [ ] `npm run lint` passes
- [ ] Connection test cron skips when recent test passed
- [ ] 429 detection stops AI batches immediately
- [ ] Screener DB reads are batched
- [ ] Chartink fetch is throttled
- [ ] Documentation updated (AGENTS.md, CHANGELOG, TODO, Lessons)
