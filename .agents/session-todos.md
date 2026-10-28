# Session Todos

## Current (2026-10-28 — Fix OpenRouter credits + Accelerate + 6hr sync)
- [x] **Fix 1: OpenRouter** — Added `nvidia/nemotron-3-ultra-550b-a55b:free` to `AI_FALLBACK_MODELS` + `BUILTIN_MODELS` (removed from `AVAILABLE_MODELS`). Updated `modelChain.ts`, `config.ts`, `aiModelCatalog.test.ts`, `modelChain.test.ts`, `aiConnectionTestService.test.ts`, `recommendation-agent.test.ts`, `swing-agent.test.ts`, `adminAiConfigModelManagement.test.ts`.
- [x] **Fix 2: Accelerate** — `swingPerformanceService.checkSwingPerformance()` — wrapped `prisma.swingSignal.findMany`, both `prisma.$queryRaw` calls, and `prisma.swingSignal.update` in try/catch with `isDbUnavailableError` detection. When Accelerate is unreachable, skips gracefully instead of throwing.
- [x] **Fix 3: Netlify 6hr sync** — Reduced `PROBE_INTERVAL_MS` from 6h to 15min. Updated all related comments. Made cron-daemon outbox drain awaited with success logging (made setInterval callback async).
- [x] **Verify** — Full Jest suite: **138/138 suites, 2095 passed / 4 skipped / 0 fail**
- [ ] **Commit** — On branch `fix/openrouter-credits-accelerate-6hr-sync`, ready to commit
- [ ] **Create PR** — Pending
