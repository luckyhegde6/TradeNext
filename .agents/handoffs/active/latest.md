# Handoff — Active (latest)

> SCHEMA v1.1 · read at session start after `@HANDOFF.md`. Live resume context — update after every session; archive to `.agents/handoffs/` history when superseded.

## Status

| Field | Value |
|-------|-------|
| **Task** | v3.41.3 Spec 18 — Laya real inference P1–P3 + real provider path |
| **Branch** | `feature/ph22-decision-engine` (HEAD = `5b088e3` = v3.41.2 COMMITTED) |
| **State** | CODE + TESTS + VERIFIED + user-accepted live check; Phase 7 docs pass finishing; **commit pending user** |
| **Gate** | `DECISION_LAYA_REAL=1` → real `LayaRealProvider`; default laya-mock byte-identical |
| **Blocked** | NO — awaiting user commit approval (no push/PR) |

## What's done (v3.41.3)

- **P1** pure-TS ports `lib/services/laya/`: `version`, `qtypes`, `serialize`, `calibration`, `collate`, `presets`, `email`, `buildSequence`, `lang`, `router`, `index` (Python 1:1).
- **P2** `tokenizer.ts` WASM lazy-singleton (`@huggingface/tokenizers`, `add_special_tokens=false` encode parity; v1 specials CLS 50281 / SEP 50282 / PAD 50283 / MASK 50284; `DECISION_LAYA_MODEL_DIR` override).
- **P3** `decisionModel.ts` two chained ONNX sessions encoder_q8→head_q8 (`onnxruntime-node@1.30.0`; int64/bool casts; K≥2 pad clamp; `act_logits` snake_case graph-name read; crypto probe hidden-1024 fail-fast; lazy singleton; dynamic import). Real inference is NOT jest/vm-compatible → child-process probe `scripts/dev-checks/laya-forward.ts`; weights `lib/services/laya/weights/v1/` gitignored, fetched via `scripts/fetch-laya-weights.mjs`.
- **agent.ts** minimal systemOne decode (buildSequence → collate → forward → temperature → max-sub softmax → choice/score/noul + confidence 4dp + usage).
- **`LayaRealProvider`** behind `DECISION_LAYA_REAL=1`; decisionClient gate (default mock byte-identical); admin ping route + OpenAPI.
- NEW 7 laya suites (incl. `layaAgent`, `layaDecisionModel`, `layaTokenizer`) + decisionClient/layaProvider updates.
- **Verified**: tsc **46 exact (0 new)** · lint **0 (1155 warnings; Lesson 139 flat-config disable-directive fix)** · **116/116 suites (1538 pass / 4 skip / 0 fail)** · quickbuild **189/189** · doc budget **85.4/100 KB** · live in-process real ping (503 MB chain) `laya: ok` + HTTP ping 200 (plan step 21, user-accepted).

## Next steps (for the next agent)

1. Finish Phase 7 docs (remaining tail: session-todos NEXT line, hygiene, final `git status`) — most applied: AGENTS.md row ✓ · `versions-v3.41.md` §v3.41.3 ✓ · CHANGELOG ✓ · TODO ✓ · Primer ✓ · agent-memory ✓ · Lessons 139 ✓ · HANDOFF yaml ✓ · latest.md ✓ · session flow/decisions ✓ · extraction-plan status note ✓.
2. Hygiene: delete junk `tsc-laya-filter.txt` + `tsc-phase2.txt`; review `git status`/`git diff --stat`.
3. **STOP → ask user: commit v3.41.3?** (no push/PR). After approval: commit, wiki update, `git push`, open PR carrying v3.41.0 `ab6fd65` + v3.41.1 `a269057` + v3.41.2 `5b088e3` + v3.41.3.

## Gotchas / lessons (recent)

- **Jest vm × native-realm**: ort's `instanceof Float32Array` guard rejects binding outputs in Jest's vm sandbox → real inference only via child `node --import tsx` probe (`scripts/dev-checks/laya-forward.ts`); ONNX suites `@jest-environment node` + `skipIf` no weights (mirrors existing 4-suite skip precedent).
- **`act_logits` is snake_case** — reading `headOut.actLogits` (camelCase) yields null (spike bug, corrected); model keeps defensive `?? null` read.
- **ESLint flat config has no jest plugin** → disable-directives for jest rules are config errors (Lesson 139 → deleted 3 `jest/no-disabled-tests` directives; kept `maybeDescribe` weights gates).
- **Weights never stage** — `lib/services/laya/weights/` is gitignored; keep it that way.
- Do not kill the leftover dev server on :3000 (PID 19208) — already-running, user-owned.