# v3.40.8 handoff — Laya spike scaffold DONE, engine gated

> **Branch**: `feature/ph22-decision-engine` (at 5453d91 v3.40.7; scaffold + docs UNCOMMITTED)
> **Read next**: `scripts/spike-laya/README.md` + `docs/laya.md` + `docs/designDoc/ph22-laya-decision-engine-design.md`

## New on disk (scaffold — no install, no download, no code)
- `scripts/spike-laya/` (plan-16 canonical path; user inline todo said `scripts/laya-spike/` — mismatch flagged, chose plan path):
  - `package.json` — spike-scoped, `onnxruntime-node@1.30.0` only, `spike` = download+smoke
  - `download.mjs` — HF tree probe (**`?recursive=true` — fixed after live probe showed weights under `v1/` dir**) → int8 weights → `weights/`; skips if present (§F0)
  - `smoke.mjs` — onnxruntime-node load → 3 canned forward passes → RSS load/final + per-decision ms → `smoke-results.json`
  - `README.md`, `VERDICT.md` (APPROVE), `.gitignore`


## P0 SPIKE VERDICT — APPROVE onnxruntime-node (2026-09-23)
- npm i onnxruntime-node (spike-scoped) DONE · ~503MB int8 weights (encoder+head, SPLIT graphs, external .onnx.data) downloaded to scripts/spike-laya/weights/v1/
- Chained encoder→head smoke PASSED: encoder fwd ~2.52s / head ~33ms / full-decision median 2316ms @ seq=128 · RSS 54.5→611MB
- IO contract mapped: encoder input_ids/attention_mask int64→hidden f32[1,L,1024]; head hidden,f32 + attention_mask int64 + marker_pos int64 + marker_mask BOOL + qtype int64[b]→logits f32[1,K] (act_logits conditional); marker K>=2
- Artifacts: scripts/spike-laya/VERDICT.md + smoke-results.json (weights gitignored)
- Verdict rationale: engine = TWO InferenceSessions (encoder+head), module singleton (~600MB RSS), async batch use (2.3s/decision), no worker thread needed

## NEXT (user approval required)
1. Engine core P1–P6 per VERDICT (lib/services/laya/) — mock default until spike-complete gate
2. Commit scaffold + docs on user OK, push branch, optional PR
3. P2 parity: tokenizer + marker construction (encoder attention_mask int64 vs head bool)

> ⚠️ Context exhaustion note below (kept).

> ⚠️ **Agent context exhausted this session** — next session MUST read the files, not conversation memory.
