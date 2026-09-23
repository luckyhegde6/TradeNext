# Spike Laya — VERDICT (P0)

> Date: 2026-09-23 · Node v24.9.0 · onnxruntime-node 1.30.0 · branch `feature/ph22-decision-engine`

## Status: ✅ APPROVE — onnxruntime-node is runtime-feasible for the ph22 decision engine

## Findings (plan-16 claims → reality)

1. **Model is SPLIT, not one whole-model graph.** The prebuilt int8 repo (`nvkudva/laya-web-q8`, ~503 MB)
   ships **two** ONNX graphs: `v1/encoder_q8.onnx` (+446 MB `.onnx.data`) and `v1/head_q8.onnx`
   (+50.6 MB `.onnx.data`). Plan §F0 assumed a single whole-model export — **assumption corrected.**
   Consequence: engine wires TWO sessions; the decision head is independently swappable (drop-in for
   per-strategy heads).
2. **Graphs use external `.onnx.data`** — downloader must preserve the repo subdir layout (flattening
   breaks ORT's relative external-data path resolution). Fixed in `download.mjs`.
3. **onnxruntime-node works in-process** — both graphs load and run sequentially; no worker/child-process
   requirement (0-op worker option becomes unnecessary).
4. **IO contract (mapped at runtime):**
   - encoder: `input_ids` int64 `[b,L]`, `attention_mask` int64 `[b,L]` → `hidden` float32 `[b,L,1024]`
   - head: `hidden` float32 `[b,L,1024]`, `attention_mask` int64 `[b,L]`, `marker_pos` int64 `[b,K]`,
     `marker_mask` **bool** `[b,K]`, `qtype` int64 `[b]` → `logits` float32 `[b,K]`,
     `act_logits` float32 `[1,2]` (**conditional output** — absent on qtype=0; guard on read)
   - K (decision options/markers) must be ≥ 2 (TopK k=2).
5. **Per-decision latency is ENCODER-BOUND**: chain median **2316 ms** @ seq=128 (encoder ~2.5 s, head
   ~33 ms). RSS peaks **611 MB** in-process (weight blobs dominate; inference itself is light after load).

## Numbers (smoke-results.json)

| Step | size | load | fwd | RSS-after |
|---|---|---|---|---|
| encoder_q8 | 2.7 MB (+446 MB data) | 795 ms | 2521 ms | 461 MB |
| head_q8 | 0.2 MB (+50.6 MB data) | 302 ms | 33 ms | 578 MB |
| full chain ×3 | — | — | 2316 / 2543 / 2103 ms | final 611 MB |

## Recommendations for engine implementation (phase 2)

- **P1 engine**: two `InferenceSession`s (encoder + head), `qtype`-driven head dispatch, logits guarded.
- **Latency**: 2.3 s/decision is fine for the async daily-batch use case (P3+), NOT for interactive
  request/response. Do NOT spawn a worker thread for inference (no benefit; load is in blob mapping).
- **Memory**: expect ~600 MB RSS per process with the int8 encoder loaded. Single shared engine instance
  (module singleton) — never per-request sessions.
- **Verification parity (P2)**: tokenizer + marker construction — `attention_mask` is **bool** on head;
  encoder wants int64. Smoke used zeros/ones markers only (no semantic correctness — parity is P2).

## Artifacts

- `scripts/spike-laya/download.mjs` (subdir-preserving, grabs `.onnx` + `.onnx.data` + tokenizer)
- `scripts/spike-laya/smoke.mjs` (chained encoder→head, metadata-driven IO discovery)
- `scripts/spike-laya/smoke-results.json` (raw numbers)
- `scripts/spike-laya/weights/` (503 MB int8, gitignored)