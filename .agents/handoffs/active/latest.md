---
handoff_version: "1.0"
session_id: "sess-20260808-screener-change-pct"
agent: "system"
timestamp: "2026-08-08T10:30:00Z"
status: "in_progress"
priority: "high"
parent_session: "sess-20260807-ph21-carryforward"
child_sessions: []
checkpoint: "screener-change-percent-fix"
---

# Active Session Handoff

## Context
- **Task**: Screener fix (v3.5.2) — TradingView `change` field IS % change on NSE; `change_percent` null/unsupported → ~60 templates matched 0 stocks, "Short Term Breakouts" returned 0, `getTopMovers` gainers returned `[]`, UI Change column showed wrong ₹ values
- **Branch**: `fix/screener-change-percent` (from `main` @ `c7a30ba`)
- **Full plan + work state**: `HANDOFF.md` → `.agents/session-todos.md`
- **Root cause verified**: TV `change` = % (RELIANCE 1334.8 vs prev 1325 = +0.74%; EEPL +20.0%, SBCL +19.99% — matches Chartink); `change_percent > 1` probe → 0 rows (unsupported column/filter/sort on NSE)

## Progress
- [x] **Short Term Breakouts rewritten** (`lib/screener/screener-templates.ts` L503–511): `change > 0` + `relative_volume_10d_calc > 1` + `Perf.5D > 3` → live TV **250 matched (was 0)**, 627ms, **18/20 Chartink overlap** (SBCL, SICAGEN, VISAKAIND, PGIL, AVALON, EMIL, VARROC, LLOYDSENGG, TATATECH, MOTHERSON, UNIMECH, TRAVELFOOD, MACPOWER, NEULANDLAB, MPSLTD, TFCILTD, KENNAMET)
- [x] **Mass-fix**: all 57 remaining `change_percent` → `change` template args (grep confirms 0 remain in `screener-templates.ts`)
- [x] **`Perf.5D` added** to `FILTER_FIELDS` (`lib/screener/condition-tree.ts`) + `FilterBuilder.tsx` FIELD_OPTIONS — was missing → `validateFilterGroup` would have 400'd the template
- [x] **`getTopMovers` fixed** (`lib/services/tradingview-service.ts`): gainers `change > 3`, losers `change < -3`, active volume `egreater 1,000,000`
- [x] **Advanced route** (`app/api/screener/advanced/route.ts`): `percentChange: s.percentChange ?? change` (TV change already %), removed `(change/(close-change))*100` formula
- [x] **UI semantics**: `change` labeled "Change (%)" (`condition-tree.ts` + `FilterBuilder.tsx` hint "Daily % change (TradingView for NSE)"); `ScannedResultsTable.tsx` `changePct = Number(stock.change ?? stock.change_percent ?? 0)`, ₹ derived `close*pct/(100+pct)` — SBIN row verified `+12.2 +1.12%`
- [x] **Rejected server-side lookback enrichment**: `daily_prices` only 12 rows; NSE history 4.4s/symbol → 882 candidates ≈ 65 min; TV has no lookback columns (~50 probed); TV pre-filter `change>0 & vol>50k` → 882 stocks in ~1s
- [x] **Verification**: 45 screener tests pass (filter-engine 24, backtest-engine 7, technical-analysis 16); tsc clean on 6 touched files (71 pre-existing errors all in untouched test files); Playwright — template dialog shows updated "Short Term Breakouts", applies 3 conditions, Run Scan → **"250 stocks found · 574ms"**, % Change column sortable with real values (SBIN +1.12%, MOTHERSON +8.71%, TATATECH +8.89%, NEULANDLAB +6.09%, AVALON +10.75%), **zero console errors**
- [x] **Docs**: AGENTS.md (v3.5.2 row), `.agents/CHANGELOG.md` index + `versions-v3.md` (v3.5.2 entry), CHANGELOG.md ([3.5.2]), TODO.md (screener row), Primer.md (status + Session 13), `.agents/changelog/screener.md` (fix section), `.agents/session-todos.md`

## Decisions
- TV-native proxy for "Short Term Breakouts" instead of server-side NSE history enrichment (too slow, DB too sparse)
- `change` field = % everywhere; ₹ derived client-side only for display
- `change_percent` sort key (col L48) left as-is — sorts to 0s/no-op harmlessly (TV default order), avoids duplicate React keys; `change` key sorts correctly
- Basic screener route already fell back `percentChange ?? change_percent ?? change` — untouched

## Blockers
- None blocking. **Commit pending**: 6 files staged-for-commit; user-owned Playwright files (`e2e/`, `playwright.config.ts`, `.github/workflows/playwright.yml`, `@playwright/test` in package.json, `.gitignore` section) must NOT be touched/committed.
- Carried forward: prod crons verification, demo holdings re-seed, F&O UI, issues #68/#69

## Next Steps
1. **Commit the 6 screener-fix files** as one commit (templates, condition-tree, tradingview-service, advanced route, ScannedResultsTable, FilterBuilder); leave user's Playwright files untracked; push + PR if that's the workflow
2. Deploy to Netlify → verify prod screener returns 250 for Short Term Breakouts + gainers API
3. Verify prod daily crons produce a successful run in the next 10 AM / 4 PM IST window (OPENROUTERKEY now set)
4. Re-seed demo holdings on prod
5. Fix issue #69 (wire `createUserSession` into NextAuth `signIn`/`signOut` events) + revisit #68 Server Logs tab
6. F&O Analytics UI (services + API done, UI pending)
