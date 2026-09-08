# Session Flow — 2026-09-07 (v3.29.2)

**Session**: `2026-09-07-admin-ai-model-management`
**Version**: v3.29.2 — Admin AI model management: true built-ins permanently locked
**Branch**: `fix/v3.29.1-header-watchlist` (on top of committed v3.29.1 `6e8db23`)

## Execution path

1. **API — DELETE hard-lock** (`app/api/admin/ai/config/route.ts`)
   - zod `modelId` (NOT `id`); builtin → 400 "Cannot remove built-in models" (nothing persisted); unknown → 404;
     catalog → hidden; custom → removed; ACTIVE-model removal → `ai_config.model = DEFAULT_MODEL` + `resetLLM()`.
2. **API — custom-models route** (`app/api/admin/ai/custom-models/route.ts`): add/remove; hidden-catalog-id re-add
   restores via the catalog path (CATALOG badge).
3. **Constants** (`lib/services/ai/config.ts`): NEW `BUILTIN_MODELS` + `BUILTIN_MODEL_IDS`; `AVAILABLE_MODELS` (8)
   contains no built-ins.
4. **UI** (`app/admin/ai/page.tsx`): "Model Library" heading + locked-note subtitle; active-model select → 3 optgroups
   (Built-in / Available / Custom); per-model Remove list = catalog ∪ custom minus builtins.
5. **Tests**:
   - NEW `lib/__tests__/aiModelCatalog.test.ts` (4).
   - NEW `lib/__tests__/adminAiConfigModelManagement.test.ts` (10) — builtin 400 regression, hide/remove/404/
     active-reset/restore, POST valid/invalid.
   - Guard-run `lib/__tests__/modelChain.test.ts` (5 pre-existing) → **19/19**.
   - Fixed 3 LSP errors in the new test file; tsc **46 = exact baseline (0 new)**; no migration.

## Live verification (Playwright :3000, admin)

- Builtin DELETE → 400 (nothing persisted).
- UI remove/re-add gpt-oss → toasts + CATALOG badge persists across reload.
- Combobox = **all 11 options** across 3 optgroups (initial a11y snapshot reported "7" — truncation; re-snapshot of
  the element showed all 11).
- 0 console errors; pre/post DB state identical (no pollution).

## Docs updated

AGENTS.md v3.29.2 row, `.agents/CHANGELOG.md` index row, `.agents/changelog/versions-v3.29.md` v3.29.2 section,
TODO.md Quick Reference row, Primer.md (Last Updated + Current Project Status), agent-memory.md entry, Lessons.md
#108 + Update Log bullet, `.agents/session-todos.md`, this session folder (decisions + flow).

## Status

**Commit pending user** (no push/merge without explicit approval). Do NOT mix unrelated v3.28.x-era working-tree
changes (sqlite/leader/worker files, `package.json`) into the v3.29.2 commit.