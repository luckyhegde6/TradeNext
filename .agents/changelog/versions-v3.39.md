# v3.39.0 — SQLite Durable Mirror — disk snapshot + Netlify Blobs upload (restart survival, Spec 12)

- **Date**: Sep 15 2026
- **Branch**: `feat/sqlite-durable-mirror` (created from HEAD of `fix/sqlite-upsert-worker-undefined-bind` — carries the unreleased v3.39.x base fixes `2182687` toIsoVal, `f470e6d` set_ops_counter queryConsumption response, PR #123 `@netlify/blobs` re-add `e84fb34`, PRs #124/#125)
- **Commit**: `e4623a3` (feat — durable mirror) + `e9db4a7` (docs — Spec 12 [skip ci]) + `d0e792e` (docs — e2e headed-Chrome user preference [skip ci]) + `309deac` (v3.39.1 UI batch — see v3.39.1 section below) — all committed on `feat/sqlite-durable-mirror`; no push/merge/deploy
- **Status**: Code + tests VERIFIED — full suite green (89/89, 1234 passed); **committed** `e4623a3`/`e9db4a7`/`d0e792e`/`309deac`; **push/PR/deploy PENDING USER**
- **Plan**: Spec + Plan `.agents/specs/12-sqlite-durable-mirror.md` / `.agents/plans/12-sqlite-durable-mirror.md` (Approved 2026-09-15 — human approval included the scope addition of `@netlify/blobs` upload for cold-start durability)

## User directive
The Prisma plan-limit hold is active until **2026-10-02** (user-stated). The SQLite mirror in
`lib/sqlite.ts` is an in-memory sql.js database rebuilt FRESH from `SCHEMA_SQL` on every boot, and
the boot `syncFromPrisma()` is breaker-gated — so ANY restart during the hold wiped the mirror and
the app's hot routes (recommendations / screener / corp-actions / swing) lost their SQLite-served
data until Prisma returned. Requirement: the mirror must survive warm/instance restarts and
Netlify cold starts with **zero additional Prisma ops**.

## Changes (3 tracked files +531/−14 + 1 new untracked test file)
1. **`lib/sqlite.ts` (+288/−14, 302 changed)** — the durable-mirror implementation:
   - **Snapshot source**: `state.db.export()` — the SAME byte stream the existing public
     `exportSqliteBackup()` (672-680) already produces for admin backup.
   - **Disk target**: `path.join(resolveLogsDir(), "sqlite-mirror.sqlite")` — `logs/` is
     gitignored, never `public/`; NEW `getMirrorSnapshotPath()` (762) with an `os.tmpdir()`
     fallback when `resolveLogsDir()` returns `''`. **Root-cause fix for a stray artifact**:
     `lib/logger.ts:5` `isServer = typeof window === "undefined"` made jsdom test suites resolve
     the logs dir to `''` → a repo-root `sqlite-mirror.sqlite` appeared during the first test
     run; the fallback pins mirror writes to a temp dir in that case (prod unaffected).
   - **Boot restore order** in `initSqliteBackup()` (1653): snapshot bytes **disk first → Blobs
     second → else fresh DB**, then the existing schema replay (`SCHEMA_SQL` +
     `ensureControlColumns`/`ensureNseColumns`/`ensureRecommendationColumns`) runs on top so an
     older snapshot is safely upgraded to the current layout. Everything downstream (ready flag,
     `createFallback`, counter restores, boot sync, recovery probe) is unchanged.
   - **Cadence (no new timers)**: (1) eager — immediately after each successful
     `syncFromPrisma()` (boot tail 1719-1722 + periodic/manual 3709-3710); (2) 60s —
     `persistMirrorSnapshot()` piggybacked onto the EXISTING `OPS_PERSIST_INTERVAL_MS` timer in
     `startOpsCounterPersistence()` (1979, 1987) so **non-leader** instances keep their own fresh
     mirror.
   - **Blobs upload** (user-approved scope): NEW `uploadMirrorSnapshotToBlobs(bytes)` (936) /
     `downloadMirrorSnapshotFromBlobs()` (957) — dynamic `import("@netlify/blobs")` (no static
     import), store `"tradenext-sqlite-mirror"` / key `"sqlite-mirror.sqlite"`,
     `MIRROR_SNAPSHOT_BLOBS_MAX_BYTES = 200 MB` hard cap, `mirrorBlobsLastDigest` digest gate
     (identical bytes skip the re-upload), `getMirrorBlobsStore()` (908) memoized on globalThis
     `__sqliteMirrorBlobsStore` (test-overridable via `__setMirrorBlobsStoreForTests`).
     **Fail-open**: adapter missing / no env / any store error → no-op — never throws, never
     blocks boot.
   - **Test hooks**: `setMirrorSnapshotPathForTests` (773), `resetMirrorSnapshotOverrides` (778);
     `resetSqliteStateForTests` (2005) also clears the mirror overrides + Blobs store.
2. **`lib/__tests__/sqlite.test.ts` (+239)** — NEW "durable mirror snapshot" describe (10 tests):
   boot persists exactly the mocked export bytes (mock cannot create a real DB); empty export →
   `persistMirrorSnapshot` false + nothing written; magic-header-but-not-sqlite file is rewritten;
   junk without magic is treated as corrupt and overwritten with the magic header; boot consults
   the Blobs store when the disk file is missing; continues disk-only without a Blobs store and
   never throws; Blobs upload is digest-gated (identical bytes skip, changed bytes re-upload);
   skips uploading null/empty byte arrays; resets to the default mirror path after
   `resetSqliteStateForTests`; the ops-persistence tick re-persists the snapshot after state
   reset. Uses a `FakeBlobsStore` behind `globalThis.__sqliteMirrorBlobsStore` (no jest module
   mock of `@netlify/blobs`), real temp-dir files, and the existing hoisted `jest.mock("sql.js")`
   MockDatabase with `__setMirrorExportBytes`.
3. **`lib/__tests__/sqliteMirror.test.ts` (NEW, 6 tests)** — GOLDEN real-loader suite:
   `@jest-environment node` FIRST line (must NOT be a comment), NO `sql.js` jest mock — real
   sql.js WASM from `node_modules/sql.js/dist/sql-wasm.wasm`; mocks `@/lib/prisma`,
   `@/lib/services/leader`, `@/lib/db-utils` (factories mirror sqlite.test.ts); proves the REAL
   `state.db.export()` → disk persist → Blobs upload → fresh-process `resetSqliteStateForTests()`
   → boot restore round-trip end-to-end (tests a–f). This file exists BECAUSE
   `sqlite.test.ts` hoists `jest.mock("sql.js")` file-wide — a real-export test cannot live there.
4. **`.gitignore` (+4)** — defensive `/sqlite-mirror.sqlite` (repo-root variant) alongside the
   existing `logs/` gitignore.

## Tests
- Full suite: **89/89 suites · 1234 passed / 4 skipped / 0 failed** (vs v3.38.2 baseline
  88/88 · 1207/4 → +1 suite, +27 tests — feature adds 16: 10 mirror + 6 golden; the other +11
  come from the carried v3.39.x base commits). Exit 0.
- Targeted `npx jest sqlite --runInBand`: **3 suites / 103 tests / 0 failed** (incl. golden 6).
- Cosmetic non-failing jest noise (documented, pre-existing class): "Cannot log after tests are
  done" (`lib/logger.ts:268` console.error), `persistOpsCounter failed … getIstDayKey is not a
  function` (v3.34.0 PURE module, fails open), jsdom "SQLite: failed to sync …" warns.

## Verification
- `npx tsc --noEmit` — **46 = exact baseline (0 new)**.
- `npx prisma validate` — valid.
- No schema change → no migration; `@netlify/blobs ^11.0.3` already pinned (`package.json:49`,
  PR #123) → no `package.json`/lock change; no new packages; no new routes; no UI changes.
- `npm run lint` — pre-existing `next lint` CLI directory quirk (documented, non-blocking —
  deliberately NOT fixed in this feature).
- Stray-file check: no `sqlite-mirror.sqlite` in the repo root after the full test run.
- Live verify (dev server :3000): pending user permission to start `npm run dev`.

---

## v3.39.1 — WCAG a11y contrast fixes + flat-change neutral state + index chart buttons open TradingView + mobile menu aria-label (Sep 17 2026)

- **Date**: Sep 17 2026
- **Branch**: `feat/sqlite-durable-mirror` (on top of committed v3.39.0 work)
- **Commit**: `309deac` — committed on `feat/sqlite-durable-mirror`; push/PR/deploy PENDING USER
- **Diff**: 9 files changed, +65/−32; no schema change → no migration; no new packages.
- **User directive**: UI polish batch — index chart buttons were broken for indices (NSE Charting `?symbol=NIFTY-EQ` 404s), flat 0.00 was indistinguishable from a positive change, and several chart/analytics texts failed WCAG contrast.

1. **Index chart buttons → TradingView** (`lib/charting.tsx`, +33/−8) — chart buttons for the market indices now open TradingView (the previous NSE Charting links `charting.nseindia.com/?symbol=SYM-EQ` 404'd for indices). NEW `INDEX_TV_TICKERS`: NIFTY→`NSE-NIFTY`, BANKNIFTY→`NSE-BANKNIFTY`, NIFTYIT→`NSE-CNXIT`, SENSEX→`BSE-SENSEX`, FINNIFTY→`NSE-CNXFINANCE` (Nifty Financial Services is listed as CNXFINANCE on TradingView). Stocks stay `charting.nseindia.com/?symbol=<SYM>-EQ`; unknown symbols fall back to `?symbol=<SYM>`; `getChartButton` title = "View `<symbol>` chart on TradingView" when the index resolves, else "View on NSE Charting".
2. **Flat-change neutral state** (`app/components/StockQuoteHeader.tsx`) — the CHANGE row is now three-way: flat **0.00** renders a neutral gray pill (`text-gray-600 dark:text-gray-400` / `bg-gray-50 dark:bg-slate-800/40`, no arrow) instead of green (which was indistinguishable from a positive change).
3. **WCAG contrast fixes** — NEW `INDICATOR_TEXT_CLASSES` in `app/components/NSEStockChart.tsx`: MA20 `text-amber-700 dark:text-amber-300`, MA50 `text-violet-700 dark:text-violet-300`, MA200 `text-cyan-700 dark:text-cyan-300` (WCAG ≥4.5:1 on both themes); "Price Chart" section heading h3→h2; additional contrast adjustments in `app/components/analytics/CorporateDataTabs.tsx`, `app/components/analytics/PiotroskiFScore.tsx`, `app/components/intelligence/CompanyIntelligence.tsx`, `app/components/intelligence/sections/VerdictCard.tsx`, `app/components/UnifiedChart.tsx`.
4. **Mobile menu** (`app/Header.tsx` +1) — hamburger button gains `aria-label="Toggle mobile menu"`.

## Tests (v3.39.1)

- Full suite: **89/89 suites · 1234 passed / 4 skipped / 0 failed** (aggregate unchanged — UI-only batch, no new tests).
- `npx tsc --noEmit` — **46 = exact baseline (0 new)**; no migration; no new packages.
- Live check (dev server :3000): pending user permission to start `npm run dev`.

---

## v3.39.4 — Context-optimisation: slim injected instruction files (358 KB → 72 KB/session) + modular read-on-demand docs + Turbopack tracing fixes (Sep 18 2026)

**Branch**: `fix/turbopack-tracing-harness` (on top of `a7e3709` = origin/main). **Commit pending user.**

### Problem (root cause of the session compaction loop)
`.opencode/opencode.json` → `instructions` injects the **full contents** of every listed file into **every** request. The injected set had grown to **358,002 B ≈ 90K tokens** (`AGENTS.md` 191,017 B, `TODO.md` 134,054 B, `README.md` 19,156 B, `.agents/rules/README.md` 3,571 B, `.agents/rules/checklist.md` 10,204 B). Compaction summarised the conversation, but the next request re-injected all 358 KB → context refilled instantly → compact again. `compaction.reserved` was only 10000, leaving almost no headroom. A handful of small reads was enough to push 7% → 78%.

### Changes
1. **Injected files slimmed** via NEW `.context/slim-docs.mjs` (marker-based extraction, EOL-preserving, `trimTrail`):
   - `AGENTS.md` 191,017 → **20,260 B** — version history moved to **NEW `.agents/changelog/versions-index.md`** (171,421 B, not injected) with a pointer + `.agents/INDEX.md` reference.
   - `TODO.md` 134,054 → **20,792 B** — Quick Reference history moved to **NEW `.agents/changelog/todo-quick-reference-archive.md`** (116,047 B, not injected).
   - **Injected total 358 KB → 72.2 KB.**
2. **NEW `.agents/INDEX.md`** — topic → file manifest (operating rules, memory, spec-driven dev, changelog, `.agents/docs/` subsystem deep-dives, skills/agents/commands, root `@File.md` docs).
3. **NEW `.agents/session-archive/`** via NEW `.context/chunk-history.mjs` (marker-based, append-only archives, reversible — files are git-tracked):
   - `Primer.md` 1159 → **213 lines** (version log ≤ v3.30.0 + Sessions 1–23 → `primer-history-archive.md`, 959 lines).
   - `agent-memory.md` 1092 → **373 lines** (→ `agent-memory-archive.md`, 731 lines).
   - **`Lessons.md` deliberately NOT age-chunked** — it is a live rulebook; old entries are still active rules.
4. **Guards**:
   - NEW context-budget rule `.agents/rules/session-memory-rules.md` §7 — injected set ≤ ~100 KB; injected files must be thin indexes/pointers; read large docs on demand via `.agents/INDEX.md`.
   - NEW `scripts/dev-checks/check-doc-sizes.mjs` — parses `instructions` from `.opencode/opencode.json`, enforces 100 KB total / 32 KB per-file budgets, exits 1 when over.
5. **Turbopack tracing fixes** — all **33** `Dynamic filesystem access causes tracing of the whole project` warnings resolved with `/*turbopackIgnore: true*/` as the first token of the call args: `lib/logger.ts` (9), `lib/services/ingestService.ts` (2), `lib/services/worker/worker-logger.ts` (14), `lib/sqlite.ts` (8 — bare-import form e.g. `existsSync(/*turbopackIgnore: true*/ candidate)`).
6. **Docs updated**: `versions-index.md` v3.39.4 row, `.agents/CHANGELOG.md` index row + header note, `Primer.md` status entry, `agent-memory.md` activity entry, `Lessons.md` **Lesson 119**.

### Verification
- `node scripts/dev-checks/check-doc-sizes.mjs` → **OK — TOTAL 72.2 KB** (budget 100 KB); every file within the 32 KB per-file budget.
- `npx tsc --noEmit` → **46 = exact baseline (0 new)**.
- `npm run quickbuild` → **BUILD_OK**, `✓ Compiled successfully`, 185/185 static pages, **0 `Dynamic filesystem access` warnings** (was 33).
- No migration; no new packages (Node built-ins only).