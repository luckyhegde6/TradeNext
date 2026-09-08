# Session Decisions — 2026-09-07 (v3.29.2)

**Session**: `2026-09-07-admin-ai-model-management`
**Version**: v3.29.2 — Admin AI model management: true built-ins permanently locked
**Branch**: `fix/v3.29.1-header-watchlist` (on top of committed v3.29.1 `6e8db23`)

## Objective

User directive: **"a built-in model cannot be removed."** Built-ins (`openrouter/free` + `openrouter/auto`) are the
`AI_FALLBACK_MODELS` foundation re-selected whenever the active model is removed/becomes unviable — they must be
permanently non-removable at both the API and UI layers, while catalog (8) and custom models stay removable.

## Decisions

1. **Enforce at the API layer, not just the UI** (model-governance rule).
   - `app/api/admin/ai/config/route.ts` DELETE: zod-validates `modelId` (NOT `id` — `{id}` → 400 "modelId is required");
     **builtin → 400 "Cannot remove built-in models"** with nothing persisted; unknown → 404; catalog → hidden from GET;
     custom → removed outright; ACTIVE-model removal resets `ai_config.model` → `DEFAULT_MODEL` + `resetLLM()`.
   - `app/api/admin/ai/custom-models/route.ts`: add/remove; adding a hidden catalog id **restores via the catalog path**
     (CATALOG badge — no custom-collection dup).

2. **Built-in identity lives in `lib/services/ai/config.ts`** — NEW `BUILTIN_MODELS` + `BUILTIN_MODEL_IDS`
   (the 2 true built-ins). `AVAILABLE_MODELS` (8) contains NO built-ins. A sync-guard test ties
   `AI_FALLBACK_MODELS` ⊆ `BUILTIN_MODEL_IDS` so the fallback chain and the permanent lock can never drift apart.

3. **UI reflects the lock without hiding removability of the rest** (`app/admin/ai/page.tsx`):
   - Custom-model section → **"Model Library"** heading + locked-note subtitle.
   - Active-model select → **3 optgroups (Built-in / Available / Custom)**.
   - Per-model Remove list = catalog ∪ custom **minus builtins** (only safe/removable additions get Remove controls).

4. **Playwright MCP a11y snapshots truncate deep/combined option lists** — a caret-combobox with optgroup children
   reported "7 options" until the combobox element itself was re-snapshotted with an element target ref → **all 11
   options** across 3 optgroups. Do NOT conclude options are missing without re-snapshotting the specific element.

5. **No schema change → no migration.** Working-tree hygiene: the tree ALSO carries unrelated pending v3.28.x-era
   changes (sqlite/leader/worker files, `package.json`) — do NOT mix them into the v3.29.2 commit.

## Queued decisions (re-surfaced, held by user)

- (a) dailyRecommendationService AI-unavailable fallback behavior.
- (b) `upsertCronJob` Date-bind fix.
- (c) rate re-capture wiring.

## Status

Code + tests + live verification + docs complete; **commit pending user** (no push/merge without explicit approval).