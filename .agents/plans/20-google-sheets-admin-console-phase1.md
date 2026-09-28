# Implementation Plan — Google Sheets Admin Console, Phase 1

> Generated from spec: `.agents/specs/20-google-sheets-admin-console.md`
> Save to: `.agents/plans/20-google-sheets-admin-console-phase1.md`
> Status: **DRAFT — awaiting human approval. No code written.**

## Spec Reference

- **Spec**: `.agents/specs/20-google-sheets-admin-console.md` (approved 2026-09-26)
- **Branch**: `feature/google-sheets-admin-console` (cut from `a6e4e6e`)
- **Created**: 2026-09-26
- **Scope**: spec §2 **Phase 1 only** — config model + migration + SQLite mirror + admin tab + status + Sync now (high-water mark) + 5th `metrics` tab. Phases 2–4 explicitly out of scope.
- **Human decisions recorded**: Phase 1 approved to start; Phase 4 new users route to a pending `JoinRequest` (spec §5.G.3, locked 2026-09-26).

---

## Pre-Flight (before step 1)

0. **Verify repo state** → verify: `git status --short` shows only `.agents/specs/20-*.md`, `.agents/plans/20-*.md`, and the untracked `scripts/dev-checks/google-oauth-consent.mjs`; `git log --oneline -1` is `a6e4e6e`
1. **Create the branch** → `git checkout -b feature/google-sheets-admin-console` → verify: `git branch --show-current`
2. **✅ RESOLVED 2026-09-26 — SQLite mirror table registry located.** A new mirrored table registers at these positions in `lib/sqlite.ts`:

   | Line | Symbol | Required | Purpose |
   |------|--------|----------|---------|
   | 1142+ | `SCHEMA_SQL` | **Yes** | `CREATE TABLE IF NOT EXISTS google_sheets_config` |
   | 4326 | `OUTBOX_TABLES` | **Yes** | SQLite-first writes drained to Prisma by the 6 h push |
   | 608 | `lib/sqlitePushSinks.ts` `pushTable()` switch | **Yes** | ⚠️ **throws** for an unregistered table — omitting this breaks the push for *every* table, not just this one |
   | ~3885 | `syncFromPrisma` `syncTable()` block | **Yes** | Prisma→mirror sync so a cold start populates the row |
   | 4160 | `DERIVED_COUNT_TABLES` | No | per-table row counts for the db-health dashboard |
   | 6642 | `getHealthStatus().tableNames` | No | health row counts |

   Reference symbols: `pushSqliteToPrisma` at `lib/sqlite.ts:4420`, `syncFromPrisma` at `lib/sqlite.ts:3378`. (An earlier `findstr` miss on `pushSqlite*` was a cmd-escaping artifact, not a missing API — **Lesson 143**: on Windows `cmd`, `findstr` under `/s` with `2>nul` and `|` alternation inside `(...)` can silently return *empty* output. A negative `findstr` is therefore **not** evidence of absence — re-verify with the `grep` tool or by reading the file before concluding a symbol does not exist. Note `rg` is **not** installed on this machine.)

   **Precedent decision — outbox pattern, not masked-copy.** `ai_config` is **absent** from `OUTBOX_TABLES` because it is a *read-only degradation copy* (Prisma→mirror; see the "MASKED mirrors — value/token never stored" comment at `lib/sqlite.ts:1564`). `google_sheets_config` is **admin-written**, so it takes the opposite pattern: **outbox / SQLite-first**. Consequences: the admin's write costs **zero Prisma ops** and drains on the next push (the desired posture under the P6003 hold); and unlike `ai_config` it needs **no masking**, since a spreadsheet ID is not a credential. The singleton is outbox-compatible — `id` is the fixed literal `"singleton"`, so it is a single id-keyed upsert row like every other outbox table.
3. **✅ RESOLVED 2026-09-26 — the outbox write path.** The sink registry is the hard switch `pushTable()` at `lib/sqlitePushSinks.ts:606`, whose `default:` arm **throws** `no sink for table "${tableName}"`. So `OUTBOX_TABLES` and `pushTable()` must be extended **together** — adding only the former converts a silent no-op into a push-breaking throw that fails every mirrored table, not just this one.

   The reusable helper is `pushByIdUpsert(db, mirrorTable, prismaTable, cols, rows)` at `lib/sqlitePushSinks.ts:304`, driven by a `GenCol[]` (`{ sql, val, json?, arr?, bool? }`; type flags emit `CAST($N AS jsonb/text[]/boolean)`). Reference callers: `pushAdminAnnouncements` (`:555`), `pushAlerts` (`:573`). `google_sheets_config` needs `bool: true` on `enabled` and `json: true` on `tabMarks`; quoted-identifier columns are used for camelCase Prisma fields (`'"lastSyncAt"'`). **Do not hand-roll a second mechanism.**


---

## Phase 1: Database

4. **Add `GoogleSheetsConfig` model** to `prisma/schema.prisma` exactly as specced §4.A (singleton `id @default("singleton")`, `sheetId?`, `displayName?`, `enabled @default(false)`, `lastSyncAt?`, `tabMarks Json?`, `@@map("google_sheets_config")`) → verify: `npx prisma validate`
5. **Generate migration SQL** → `npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` → verify: DDL is `CREATE TABLE` only — **no `ALTER` on existing tables, no data loss**
6. **Apply the migration** → `npx prisma migrate dev --name add_google_sheets_config` (dev; template explicitly permits `migrate dev` for the user) → verify: `npx prisma db pull` shows the model
7. **Regenerate the client** → `npx prisma generate` → verify: no errors
8. **Add the mirror table** to `lib/sqlite.ts` (`CREATE TABLE IF NOT EXISTS google_sheets_config`, snake_case columns) and register it per the pre-flight step 2/3 findings → verify: mirror schema init runs without error in a unit test

---

## Phase 2: Service Layer

9. **Add the `metrics` tab contract** in `lib/services/googleSheets/tabs.ts` — add `"metrics"` to the `TrackerTab` union + a `TRACKER_TABS` entry → verify: existing `tabs.test.ts` still green; **existing 5 contracts must remain 24/16/12/13/16, unchanged** (Lesson 141)
10. **Add `metricsRow`** in `lib/services/googleSheets/rows.ts` — pure positional encoder, mirroring `decisionRow`; blank cells stay `""` (never `0`) → verify: unit test asserts a fixed positional vector
11. **Implement `configService.ts`** per specced §5.A: `getConfig`, `setSheetId`, `getTabMark`, `setTabMark`, `resolveSheetId` (DB first, `GOOGLE_SHEET_ID` env fallback so Spec 19 stays byte-identical), Zod sheet-ID validation, SQLite write-through, audit tag → verify: `npx tsc --noEmit` (0 new errors)
12. **Implement `syncService.ts`** per specced §5.B: `syncTab` + `syncAll` (sequential, never `Promise.all`); cap 200 rows/tab/sync; mark advances **only** on `ExportResult === "enabled"`; `decisions` returns `skipped: true, reason: "backfill_unsupported"` → verify: `npx tsc --noEmit`
13. **Implement `statusService.ts`** per specced §5.C: booleans + `sheetIdMasked` + per-tab header state; **must not** expose any secret value → verify: `npx tsc --noEmit`
14. **Add audit tags** in `lib/audit.ts` (`GOOGLE_SHEETS_CONFIG_UPDATED`, `GOOGLE_SHEETS_SYNC_TRIGGERED`) → verify: tags exported and importable
15. **Wire `auth.ts`** so `trackerSheetId()` resolves DB-first → verify: with no DB row, behaviour is byte-identical to Spec 19 (env path only)

---

## Phase 3: API Routes

16. **Create `app/api/admin/google-sheets/status/route.ts`** → verify: `GET` returns 200 + specced §8 shape; unauthenticated/non-admin → 401
17. **Create `app/api/admin/google-sheets/config/route.ts`** (PUT) → verify: invalid `sheetId` → 400; `sheetId: null` clears
18. **Create `app/api/admin/google-sheets/sync/route.ts`** (POST) → verify: flag off → `skipped: true, reason: "disabled"` and **zero** network calls (assert the Sheets client factory was never invoked)
19. **Guard all three** with `auth()` + `role === "admin"` + `runtime = "nodejs"` (pattern: `app/api/admin/decision/monitoring/route.ts`) → verify: no Prisma import in any client component

---

## Phase 4: UI

20. **Create `app/admin/google-sheets/page.tsx`** (client component, mirrors `app/admin/decision/page.tsx`) — status panel, sheet-link card, per-tab table, Sync now + per-tab Sync → verify: `npx tsc --noEmit`
21. **Add loading / empty / error / data states**; error state shows a message + Retry, never a raw stack → verify: all four render
22. **Add the confirm dialog** when a sync would append > 100 rows → verify: dialog opens before any fetch
23. **Add the admin nav entry** to the `navItems` array in `app/admin/layout.tsx` (~lines 9–35) → verify: link renders for admin, hidden for non-admin
24. **Metrics preview card** — read-only KPI display + "Append KPI snapshot" (append-only; no clear/overwrite control) → verify: tsc clean
25. **Responsive + dark mode** → verify: Playwright at 375 / 768 / 1440; 0 console errors

---

## Phase 5: Tests

26. **`lib/__tests__/googleSheetsConfig.test.ts`** — Zod validation, singleton defaults, DB-then-env resolution, mirror write-through
27. **`lib/__tests__/googleSheetsSync.test.ts`** — mark advances only on `"enabled"`; re-run with no new rows appends 0; 200-row cap; `syncAll` sequential; `decisions` skipped; flag-off makes zero network calls
28. **`lib/__tests__/googleSheetsStatus.test.ts`** — assert the literal secret value never appears in the payload
29. **`lib/__tests__/googleSheetsMetrics.test.ts`** — KPI aggregation math (win rate, net P&L, counts) + `metricsRow` positional vector
30. **Regression guard** — assert the 5 existing tab contracts are still 24/16/12/13/16 (protects Lesson 141)
31. **E2E** `e2e/admin-google-sheets.spec.ts` — tab renders, non-admin 401, link+sync round-trip against a **mocked** Sheets client (no live Google calls in CI)
32. Run the full suite **alone** (Windows quirk: never chain with `;`) → verify: `npm run test` all green, **0 new failures**

---

## Phase 6: Documentation

33. **AGENTS.md** → version row
34. **.agents/CHANGELOG.md** + `.agents/changelog/versions-v3.43.md` → detail + index
35. **TODO.md** → quick-reference row
36. **Primer.md** · **agent-memory.md** · **Lessons.md** · **HANDOFF.md** · **.agents/session-todos.md** · **.agents/handoffs/active/latest.md**
37. **Session memory** → `.agents/sessions/<YYYY-MM-DD-hash>/decisions.md` + `flow.md` (write during work, not after)
38. **`.env.example`** → document `SECRETS_ENCRYPTION_KEY` (Phase 2, stub the section) + the `drive.file` re-consent note (Phase 3)
39. **`app/api/openapi/route.ts`** → document all 3 new routes
40. **Doc budget** → `node scripts/dev-checks/check-doc-sizes.mjs` (budget 100 KB; currently 90.2) → verify: green

---

## Test Strategy

### Unit Tests (Required)

| Test | File | What It Verifies |
|------|------|------------------|
| Valid `sheetId` → saved | `googleSheetsConfig.test.ts` | Happy path |
| Malformed `sheetId` → rejected | `googleSheetsConfig.test.ts` | Zod validation |
| No DB row → env fallback | `googleSheetsConfig.test.ts` | Spec 19 byte-identical |
| `setSheetId` → mirror row written | `googleSheetsConfig.test.ts` | Write-through |
| `exportRows` returns `"enabled"` → mark advances | `googleSheetsSync.test.ts` | Mark contract |
| returns `"failed"` → mark **not** advanced | `googleSheetsSync.test.ts` | At-least-once, no data loss |
| Re-sync, 0 new rows → 0 appended | `googleSheetsSync.test.ts` | **No duplicates** (the core risk) |
| 500 pending rows → only 200 appended | `googleSheetsSync.test.ts` | Cap |
| flag off → zero Sheets client construction | `googleSheetsSync.test.ts` | Spec 19 gate preserved |
| secret literal absent from payload | `googleSheetsStatus.test.ts` | No leak |
| `metricsRow` positional vector | `googleSheetsMetrics.test.ts` | Encoder contract |
| 5 existing contracts still 24/16/12/13/16 | `googleSheetsMetrics.test.ts` | Lesson 141 guard |

### Integration Tests

| Test | What It Verifies |
|------|------------------|
| `GET /status` → 200 + specced shape | Route wiring |
| `PUT /config` invalid → 400 | Validation |
| `PUT /config` `sheetId: null` → clears | Clear path |
| All routes unauthenticated → 401 | Admin guard |
| `POST /sync` flag off → `skipped: "disabled"` | Gate, zero network |

### E2E Tests

| Test | What It Verifies |
|------|------------------|
| Admin tab renders with data | Component rendering |
| "Not linked yet" empty state | Empty state handling |
| Mobile layout 375px | Responsive |
| Dark mode renders | Theme |
| Non-admin 401 on all 3 routes | Authz |

---

## Verification Checklist

```bash
npx prisma validate                 # schema valid
npx prisma generate                 # client regenerated
node scripts/dev-checks/check-tsc-baseline.mjs   # 0 NEW errors (baseline 46, prod 0)
npm run test                        # all pass — RUN ALONE, never chained with ';'
npm run lint                        # 0 errors
npm run quickbuild                  # >= 189 pages, 0 new warnings
node scripts/dev-checks/check-doc-sizes.mjs       # <= 100 KB
npm run test:e2e                    # admin-google-sheets.spec.ts
```

---

## Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| **Mirror table registry unknown** (pre-flight step 2) — silently unsynced config if missed | Resolve file:line before writing the migration; stop if unresolvable | No — blocks Phase 1 |
| **First `Sync now` backfills the full history** for 4 tabs | 200-row/tab cap + confirm dialog above 100; operator runs it repeatedly | No |
| **At-least-once**: an interrupted sync can duplicate rows on retry | Acceptable and documented (spec §11.4) — exactly-once would need a marker column, which breaks the Lesson 141 contracts | Yes (future spec) |
| P6003 plan-limit hold until 2026-10-02 | `GoogleSheetsConfig` is a single-row config; all reads are SQLite-mirror-first; the P0 plan-limit breaker will surface if writes fail. **Re-check status before the migration.** | No |
| `tabMarks` as `Json` (no index, no FK) | Single-row singleton, read once per export — a child table would be over-engineering | No |
| High-water mark on a mutable `createdAt` | Marks use `createdAt > mark` ordered asc; never rewinds. Documented as a known approximation. | Yes |
| Sheet ID shown in admin UI | Masked (`1AbC…XyZ`); it is not secret, but avoids leaking into screenshots/logs | No |

---

## Documentation Checklist

- [ ] **AGENTS.md** — version row
- [ ] **CHANGELOG** — `.agents/changelog/versions-v3.43.md` + index
- [ ] **TODO.md** — quick-reference row
- [ ] **Primer.md** — current project status
- [ ] **agent-memory.md** — activity log entry
- [ ] **Lessons.md** — new lesson (mirror-table-registry + high-water-mark patterns)
- [ ] **Session memory** — `decisions.md` + `flow.md`
- [ ] **session-todos.md** / **handoffs/active/latest.md**
- [ ] **OpenAPI** — 3 routes documented

---

## Pre-Commit Gate

1. `npx tsc --noEmit` — 0 new errors
2. `npm run test` — all pass (run alone)
3. `npm run lint` — 0 errors
4. `git status` — no junk, no secrets in diff; `google-oauth-consent.mjs` still untracked
5. Documentation checklist complete
6. `.agents/rules/checklist.md` validated
7. Human review of the diff (no auto-commit/push/deploy)
