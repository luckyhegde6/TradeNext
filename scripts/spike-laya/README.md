# Spike Laya — P0 runtime feasibility (decision engine)

**Spec:** `.agents/specs/16-decision-engine.md` · **Plan:** `.agents/plans/16-decision-engine.md` (ph22)
**In progress — BLOCKING gate** for the Laya provider. No provider code until VERDICT.

## Scope (P0 only)
Prove the **whole-model ONNX + onnxruntime-node** inference path in this repo's Node process:
- Load prebuilt **int8-quantized ONNX weights** (~524 MB) from HF `nvkudva/laya-web-q8` — **skip export** (prebuilt exists).
- Smoke: one forward pass → decode 3-sample choice/score/noul (build_sequence parity logic).
- Measure **RSS + per-decision latency + model footprint** on this host.
- Output `VERDICT.md` (Approve onnxruntime-node / Reject / Hybrid).

## Gates
- [ ] `npm install onnxruntime-node` — **NEEDS USER PERMISSION** (package install, sensitive op).
- [ ] HF `laya-web-q8` weight download (~524 MB v1/) — **NEEDS USER PERMISSION** (network+storage).
- [ ] Smoke run + RSS/latency capture
- [ ] `VERDICT.md` written

## Files
| File | Purpose |
|------|---------|
| `download.mjs` | Download int8 ONNX weights from HF into `weights/` |
| `smoke.mjs` | onnxruntime-node load + 3-sample forward + RSS/latency |
| `VERDICT.md` | Spike verdict (gate output) |
| `VERDICT.skeleton.md` | Template pre-filled before run |

## Next
Run `npm run spike` after permissions granted.
