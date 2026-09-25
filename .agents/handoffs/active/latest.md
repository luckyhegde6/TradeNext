# Handoff — Active (latest)

> SCHEMA v1.1 · read at session start after `@HANDOFF.md`. Live resume context — update after every session; archive to `.agents/handoffs/` history when superseded.

## Status

| Field | Value |
|-------|-------|
| **Task** | v3.41.3 Spec 18 — Laya real inference P1–P3 + real provider path |
| **Branch** | `feature/ph22-decision-engine` (HEAD = `3c765b9` = v3.41.3 COMMITTED) |
| **State** | COMMITTED `3c765b9` · pushed (origin in sync) · **PR #132 OPEN** — merge/deploy pending user |
| **Gate** | `DECISION_LAYA_REAL=1` → real `LayaRealProvider`; default laya-mock byte-identical |
| **Blocked** | NO — awaiting user merge/deploy decision (PR #132 open) |

## What's done (v3.41.3)

- **P1** pure-TS ports `lib/services/laya/`: `version`, `qtypes`, `serialize`, `calibration`, `collate`, `presets`, `email`, `buildSequence`, `lang`, `router`, `index` (Python 1:1).
- **P2** `tokenizer.ts` WASM lazy-singleton (`@huggingface/tokenizers`, `add_special_tokens=false` encode parity; v1 specials CLS 50281 / SEP 50282 / PAD 50283 / MASK 50284; `DECISION_LAYA_MODEL_DIR` override).
- **P3** `decisionModel.ts` two chained ONNX sessions encoder_q8→head_q8 (`onnxruntime-node@1.30.0`; int64/bool casts; K≥2 pad clamp; `act_logits` snake_case graph-name read; crypto probe hidden-1024 fail-fast; lazy singleton; dynamic import). Real inference is NOT jest/vm-compatible → child-process probe `scripts/dev-checks/laya-forward.ts`; weights `lib/services/laya/weights/v1/` gitignored, fetched via `scripts/fetch-laya-weights.mjs`.
- **agent.ts** minimal systemOne decode (buildSequence → collate → forward → temperature → max-sub softmax → choice/score/noul + confidence 4dp + usage).
- **`LayaRealProvider`** behind `DECISION_LAYA_REAL=1`; decisionClient gate (default mock byte-identical); admin ping route + OpenAPI.
- NEW 7 laya suites (incl. `layaAgent`, `layaDecisionModel`, `layaTokenizer`) + decisionClient/layaProvider updates.
- **Verified**: tsc **46 exact (0 new)** · lint **0 (1155 warnings; Lesson 139 flat-config disable-directive fix)** · **116/116 suites (1538 pass / 4 skip / 0 fail)** · quickbuild **189/189** · doc budget **85.4/100 KB** · live in-process real ping (503 MB chain) `laya: ok` + HTTP ping 200 (plan step 21, user-accepted).

## Next steps (for the next agent)

1. **Ask user: merge PR #132** (https://github.com/luckyhegde6/TradeNext/pull/132) into `main` → deploy? NO auto-merge/deploy without explicit approval.
2. On merge: update status rows to MERGED; P4–P6 Laya follow-ups (full `agent.ts` → router/shortlist/presets wiring → docs/e2e sweep) are the next feature batch.

## Gotchas / lessons (recent)

- **Jest vm × native-realm**: ort's `instanceof Float32Array` guard rejects binding outputs in Jest's vm sandbox → real inference only via child `node --import tsx` probe (`scripts/dev-checks/laya-forward.ts`); ONNX suites `@jest-environment node` + `skipIf` no weights (mirrors existing 4-suite skip precedent).
- **`act_logits` is snake_case** — reading `headOut.actLogits` (camelCase) yields null (spike bug, corrected); model keeps defensive `?? null` read.
- **ESLint flat config has no jest plugin** → disable-directives for jest rules are config errors (Lesson 139 → deleted 3 `jest/no-disabled-tests` directives; kept `maybeDescribe` weights gates).
- **Weights never stage** — `lib/services/laya/weights/` is gitignored; keep it that way.
- Do not kill the leftover dev server on :3000 (PID 19208) — already-running, user-owned.