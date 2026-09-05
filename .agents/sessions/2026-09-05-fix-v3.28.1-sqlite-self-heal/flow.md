# Session Flow — 2026-09-05-fix-v3.28.1-sqlite-self-heal (v3.29.0 UI/UX audit fixes)

## Execution path
1. Doc recon reads: `.agents/CHANGELOG.md` (head), `Primer.md` (head), `.agents/handoffs/active/latest.md` (v3.28.4 state — stale), `.agents/changelog/versions-v3.28.md` (head, header style), `.agents/session-todos.md` (L1-47), `AGENTS.md` (head), `TODO.md` (head), `agent-memory.md` (head).
2. Phase 1 — `app/api/backtest/run/route.ts`: removed the symbol 404-gate; `symbolSource` known/unlisted from `findUnique` :83 (labeling only, echoed :178); warn fall-through log :85-91; `barCount < 50 → 400` stays :99-103; `runtime="nodejs"` :29. `lib/services/symbolReference.ts`: deleted `isBacktestSymbolAllowed` (dead code). `lib/__tests__/symbolReference.test.ts`: 11 → 7 (removed 4 gate tests).
3. Phase 2 — NEW `lib/aiErrorMessage.ts` (`extractErrorMessage`); `app/components/AiActionButton.tsx` (`error?: string | null` prop :20; red status line :114-116, hidden while loading); `app/watchlist/page.tsx` (import :8; throw-site normalization :254; `setAiError(extractErrorMessage(err))` :268; passes `error={aiError}`).
4. Phase 3 — `app/Header.tsx`: logged-in quick-access `grid-cols-2` :312 → Dashboard / Portfolio / F&O Analytics (:334) / Alerts (:337).
5. NEW tests: `lib/__tests__/backtestSymbolFallthrough.test.ts` (4, node-env), `lib/__tests__/watchlistAiError.test.ts` (8), `app/components/__tests__/AiActionButton.test.tsx` (4).
6. Verification: `npx tsc --noEmit` **46 = exact baseline (0 new)**; targeted 4 suites **23/23**; full `npm run test` **1043 pass / 4 skip / 1 fail** (1 = documented pre-existing `intelligence.test.ts` flake).
7. Live verification (Playwright + chrome-devtools; dev server PID 34672 pre-existing, left running): admin login; backtest `RBLBANK` → 200 `symbolSource:"unlisted"` 70 bars; simulated AI 500 `{error:{message:"AI provider unavailable (simulated 500)"}}` → red line extracted text + button enabled; mobile 375×812 grid shows all 4 quick links; `[object Object]` regression verified fixed; test watchlist deleted via UI.
8. Docs: NEW `.agents/changelog/versions-v3.29.md`; `.agents/CHANGELOG.md` index row; `AGENTS.md` table row; `TODO.md` quick-ref row; `Primer.md` (Last Updated + Current Project Status); `agent-memory.md` entry; `.agents/session-todos.md` Current section rewrite; `.agents/handoffs/active/latest.md` rewrite; NEW session folder with `decisions.md` + `flow.md`.

## Code touched
- **Modified**: `app/api/backtest/run/route.ts`, `app/components/AiActionButton.tsx`, `app/watchlist/page.tsx`, `app/Header.tsx`, `lib/services/symbolReference.ts`, `lib/__tests__/symbolReference.test.ts`.
- **Created**: `lib/aiErrorMessage.ts`, `lib/__tests__/backtestSymbolFallthrough.test.ts`, `lib/__tests__/watchlistAiError.test.ts`, `app/components/__tests__/AiActionButton.test.tsx`, `.agents/changelog/versions-v3.29.md`, `.agents/sessions/2026-09-05-fix-v3.28.1-sqlite-self-heal/`.
- **Docs modified**: `.agents/CHANGELOG.md`, `AGENTS.md`, `TODO.md`, `Primer.md`, `agent-memory.md`, `.agents/session-todos.md`, `.agents/handoffs/active/latest.md`.

## Notes
- LSP diagnostics surfaced during the session are pre-existing and unrelated (ignore): `scripts/test-prod-db.ts` (`datasources` not in `PrismaClientOptions`); `lib/__tests__/db-utils.test.ts`, `lib/__tests__/document-normalize.test.ts`, `lib/__tests__/stock-analysis-prompt.test.ts` (module-alias resolution).
- No schema change → no migration. Net suite test delta **+12** vs the 1031 pre-v3.29.0 observed baseline (16 new, 4 removed).
- Next step (awaiting user approval): `git add -A` → commit plan-07 (code + tests + docs) → push `fix/v3.28.1-sqlite-self-heal` (carries `6700076`).