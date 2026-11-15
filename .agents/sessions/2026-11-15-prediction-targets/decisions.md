# Decisions — 2026-11-15 prediction targets & analysis mode (Spec 43)

## D1 — Always show prediction targets when AI unavailable (no "AI targets off")
- **Decision:** Replace "AI targets off"/targetless AI-missing states with prediction/calculation-generated targets persisted and shown to users (especially Swing screener-only load).
- **Reasoning:** Users need actionable targets and performance tracking even during AI outages/quota issues; "AI targets off" blocked visibility and downstream evaluation.
- **Alternatives considered:** Keep AI-only targets and improve notices (rejected: does not satisfy requirement); generate only on manual refresh (rejected: user requested automatic on screener-only view/load).

## D2 — Analysis mode is explicit and per-stock
- **Decision:** Add `analysisMode` with values `"AI Targets"` | `"Prediction Targets"` to relevant analysis records; each stock carries its own mode (AI-analyzed vs fallback-filled can coexist in same run/feed).
- **Reasoning:** Transparent provenance, supports mixed partial-AI runs, and enables correct UI/export/backfill behavior.
- **Alternatives considered:** Infer mode from heuristics (rejected: ambiguous, error-prone for backfill/exports).

## D3 — Backfill and persistence rules
- **Decision:** Historical rows with any target/analysis backfilled as `"AI Targets"`. Missing targets/analysis eligible for prediction are generated and persisted as `"Prediction Targets"` (idempotent, bounded in perf checks; plus one-time backfill routine where needed).
- **Reasoning:** Preserve provenance for existing AI-derived data while making legacy/missing rows actionable going forward.

## D4 — Daily fallback directionality
- **Decision:** Daily prediction/fallback must **never return HOLD** on weak signals (always directional BUY/SELL with valid targets); normal AI/rare-neutral analysis may still be HOLD where appropriate.
- **Reasoning:** User explicitly requires actionable BUY/SELL picks from prediction fallback and no fallback-to-HOLD regression.
- **Alternatives considered:** Keep weak-signal HOLD fallback (rejected by user).

## D5 — Swing vocabulary and auto-generation
- **Decision:** Swing keeps `LONG/SHORT/OBSERVE` (with targets). Prediction targets computed automatically on every screener-only Swing view/load.
- **Reasoning:** Immediate target visibility without AI/manual refresh, while preserving existing swing semantics.

## D6 — Performance checks perform bounded generation/backfill
- **Decision:** Scheduled/admin `checkRecommendationPerformance` and `checkSwingPerformance` generate & persist missing prediction targets/mode (bounded per run, idempotent) and backfill mode for existing targeted rows as encountered.
- **Reasoning:** Ensures performance tracking remains functional without waiting for separate manual backfill; bounded to control runtime/ops.

## D7 — Compatibility for downstream consumers
- **Decision:** Telegram, admin exports, and Google Sheets continue to work as-is but include the new mode.
- **Reasoning:** Preserve integrations while surfacing provenance.

## D8 — SDD gate before implementation
- **Decision:** Created Spec 43 and Plan 43; implementation (including DB migration/data backfill) required explicit user approval/permission before code/schema changes.
- **Reasoning:** Mandatory spec-driven workflow and sensitive DB operations policy.
- **Update (2026-11-15):** Spec/plan and DB migration/backfill/verification explicitly approved by user; implementation completed and verified in-session (targeted tests + gates). Spec 43 commit explicitly requested and prepared on `feature/spec-43-prediction-targets`; Tracks 1–4 sequenced after commit.