# Session Decisions — 2026-09-10 — v3.32.0 Admin Time Synchronisation

> Decision journal for the v3.32.0 session. Format per `.agents/sessions/README.md`.

## D1. Persist a server-clock offset and apply it lazily — do NOT rewrite all stored `nextRun` rows

- **Decision**: Add `probe_db_time` + `set_time_correction` (persisted to SQLite `_backup_meta` keys `time_correction` / `time_probe_db`) and apply the offset at read/claim time via `getCorrectedNow()`/`getCronFrom()` (lazy read-through, no cache). Do not mutate existing `nextRun`/`lastRun` rows.
- **Context**: Netlify host clock treats IST wall-clock as UTC → stored cron `nextRun` skew ≈ +5.5h. A one-time row-rewrite would break again on the next deploy/cold start and cannot correct future writes.
- **Why**: The offset must survive deploys (durable in SQLite mirror), apply uniformly at every `nextRun` compute/claim site (`recommendationCronService.ts:5/:118`, `worker-engine.ts:598/631/645/657`), and stay reversible via `clear_time_correction`.
- **Impact**: Minimal diff (7 modified files +565/−10); no schema change → no migration; GET `time` block is zero-Prisma (v3.23.x read-tier rule preserved); `applyOffset(_, 0)` = identity so an uncorrected system behaves exactly as before.

## D2. Fix `parseIstDateTimeLocal` round-trip guard to compare the IST round-trip, not a UTC projection

- **Decision**: `valid = toIstIso(parsed).slice(0, 16) === input` with `epoch = Date.UTC(y, m-1, d, h, min) − offset`.
- **Context**: The pre-fix guard compared the parsed-UTC projection against the IST wall-clock input — never matches for IST inputs → genuinely valid IST strings silently rejected → corrupt epochs.
- **Why**: A round-trip guard is only meaningful when the parsed instant is rendered back **in the target zone**; IST is a fixed +5:30 offset so IANA rules are unnecessary.
- **Impact**: All four suites green including the regression the old guard masked; documented in Lessons #111.

## D3. Tests must NOT use `process.env.TZ`

- **Decision**: `timeCorrection.test.ts` uses a full manual `jest.mock("@/lib/sqlite")` (factory-closure store, `__esModule: true`, no `...actual` spread, `jest.requireMock`) instead of mutating `process.env.TZ`.
- **Context**: V8 caches `getTimezoneOffset`; `TZ` changes mid-process are unreliable on Windows and flaky in CI.
- **Why**: Deterministic zone arithmetic via explicit `toIstIso`/`Date.UTC` math keeps the suite platform-independent.
- **Impact**: 20/20 green run-to-run; no platform-specific skips.

## D4. Defer the live `probe_time` DB verification

- **Decision**: Ship the code path with the graceful PG-down branch covered by sqlite.test.ts mock; do not start Postgres/Docker for a live probe in this session.
- **Context**: Local Postgres/Docker not running; the durable root fix is correct `TZ`/`UTC` env on Netlify (documented in the method header + Lessons #111).
- **Why**: Live probe is a validation nicety, not a gate — the API contract is exercised by tests and the UI path is static rendering.
- **Impact**: Deferred item recorded in versions-v3.32.md / Primer / HANDOFF; no code gap.

## D5. No new branch — keep the working tree on `fix/sqlite-init-reserved-keyword` @ `8c67e89`

- **Decision**: Implement v3.32.0 on the existing working tree; the final branch name is the user's call at commit time.
- **Context**: v3.32.0 code+tests+docs are uncommitted; `8c67e89` is already pushed.
- **Why**: Avoids an orphan branch and a spurious push; the user decides the commit/branch narrative.
- **Impact**: `HANDOFF.md` + latest.md both record "NO push/merge/deploy without explicit approval".