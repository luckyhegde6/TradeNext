# Spec Document — Google Sheets Header-Label Fix

## 1. Overview

**What**: Align the `/admin/google-sheets` client's `HeaderState` type and `HEADER_BADGE` label map with the
server's actual contract, and correct the misleading label for the `absent` state.

**Why**: The console renders the wrong header badge for every populated tab. `lib/services/googleSheets/tabs.ts`
defines `HeaderState = "matched" | "drifted" | "absent" | "unknown"` (`tabs.ts:116`) and
`statusService.ts:77` emits those values. But `app/admin/google-sheets/page.tsx:17` declares
`HeaderState = "match" | "mismatch" | "empty" | "unreadable" | "absent" | "unknown"` — a **disjoint** set — so
`HEADER_BADGE[t.headerState]` is `undefined` for `matched`/`drifted` and the render (`page.tsx:546`) silently
falls back to `HEADER_BADGE.unknown` → every healthy tab shows **"unknown"**. Additionally `absent` is labelled
**"tab missing"**, but the server's `absent` means *the tab exists and its header row is blank/unwritten*; a
truly nonexistent tab surfaces as `unknown`. Confirmed live on prod 2026-10-09: `custom` and `metrics` are
`matched` yet the page shows "unknown".

**Scope**:
- **IN**: `app/admin/google-sheets/page.tsx` — the `HeaderState` union, `HEADER_BADGE` map, and the
  `absent` label; plus a unit test for the badge mapping.
- **OUT**: the server contract (`tabs.ts`/`statusService.ts` unchanged — the server is correct); ledger
  explainer copy; the data-starvation side (producers/exports) — that is a consequence of the cron fix in
  spec 25, not a UI change.

**Depends on**: Spec 20 (Google Sheets console), Spec 25 (producers must run for tabs to populate — but this
label fix is independently verifiable).

---

## 2. Routes

*(N/A justified: consumes existing `/api/admin/google-sheets/status`; no route change.)*

---

## 3. Database Schema

*(N/A justified: no DB change.)*

---

## 4. Functions to Implement

### `app/admin/google-sheets/page.tsx`

#### `type HeaderState` (line 17)

- Replace with the server contract: `"matched" | "drifted" | "absent" | "unknown"`.

#### `HEADER_BADGE` (lines 124-131)

- Keys become `matched | drifted | absent | unknown`:
  - `matched` → `{ label: "header ok", cls: green }` (unchanged visual)
  - `drifted` → `{ label: "header drifted", cls: amber }` (was `mismatch`)
  - `absent` → `{ label: "no header yet", cls: blue }` (was `"tab missing"`, red — misleading)
  - `unknown` → `{ label: "unknown", cls: gray }` (unchanged)

#### render (line 546)

- Keep the defensive `?? HEADER_BADGE.unknown` fallback (harmless once keys align).

---

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `app/admin/google-sheets/page.tsx` | Modified | `HeaderState` union + `HEADER_BADGE` map + `absent` label |
| `lib/__tests__/googleSheetsHeaderBadge.test.ts` | New | Assert `matched`/`drifted`/`absent`/`unknown` each map to a defined badge |

*(Server `tabs.ts` / `statusService.ts` are NOT changed.)*

---

## 6. Dependencies

### New Packages

| Package | Version | Reason |
|---------|---------|--------|
| None | — | — |

### Internal Dependencies

| Module | Function Used | Purpose |
|--------|---------------|---------|
| `@/lib/services/googleSheets/tabs` | `type HeaderState` (type-only import) | Single source of truth (optional: import the type instead of redeclaring) |

---

## 7. API Contract

*(N/A justified: no route change — see §2.)*

---

## 8. UI/UX Requirements

- **Loading**: unchanged.
- **Empty**: unchanged.
- **Error**: unchanged.
- **Data**: each tab shows the correct badge — `matched` → "header ok", `drifted` → "header drifted",
  `absent` → "no header yet", `unknown` → "unknown".
- **Responsive / dark mode**: unchanged (existing classes preserved).

---

## 9. Rules & Guardrails

- [ ] Prefer importing the server `HeaderState` type to prevent future drift (if the import is
      client-safe — it is a pure `type` re-export).
- [ ] No behaviour change to any other column/badge.
- [ ] Surgical: touch only the union, the map, and the `absent` label.

---

## 10. Expected Behavior

1. A tab whose server `headerState === "matched"` renders "header ok" (green), not "unknown".
2. `drifted` renders "header drifted" (amber).
3. A tab with a blank header row (`absent`) renders "no header yet" — not "tab missing".
4. An unrecognised value still renders "unknown" (defensive).

---

## 11. Error Handling

| Scenario | Behavior | Log Level |
|----------|----------|-----------|
| Unknown/future state value | Falls back to "unknown" badge | N/A (render) |
| Status fetch fails | Existing error card unchanged | existing |

---

## 12. Test Strategy

### Unit Tests (`lib/__tests__/googleSheetsHeaderBadge.test.ts`)

- [ ] `HEADER_BADGE.matched.label === "header ok"`
- [ ] `HEADER_BADGE.drifted.label === "header drifted"`
- [ ] `HEADER_BADGE.absent.label === "no header yet"`
- [ ] `HEADER_BADGE.unknown.label === "unknown"`
- [ ] `HEADER_BADGE[state]` is defined for every value the server can emit

*(If `HEADER_BADGE` stays module-private, export it for the test — the only production change is the
`export` keyword.)*

### E2E (Playwright)

- [ ] `/admin/google-sheets` shows "header ok" for `custom`/`metrics` (currently "unknown")

---

## 13. Performance Considerations

- Pure render change; no effect.

---

## 14. Security Considerations

- No change; values are server-controlled strings rendered as text.

---

## 15. Definition of Done

- [ ] `HeaderState` union + `HEADER_BADGE` map match the server contract
- [ ] `absent` labelled "no header yet"
- [ ] Unit test added and passing
- [ ] `npx tsc --noEmit` passes (0 new errors)
- [ ] `npm run lint` passes
- [ ] Playwright confirms correct badges on the admin page
- [ ] Documentation updated (AGENTS.md, CHANGELOG, TODO, Primer, agent-memory)
- [ ] Session memory updated (`decisions.md` + `flow.md`)
