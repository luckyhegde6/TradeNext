# Session Decisions — 2026-09-25 Laya real inference (P1–P3 + real provider path)

Branch: `feature/ph22-decision-engine` (on `5b088e3` = v3.41.2 COMMITTED). Workstream: spec/plan 18.

## D1 — Scope: P1–P3 + real provider path (user answer to scope question)
- Implement extraction-plan P1 (pure-TS ports), P2 (tokenizer WASM), P3 (ONNX backbone) **PLUS** a minimal `agent.ts` `system_one` decode and a real Laya provider path.
- `DECISION_PROVIDER=laya` **stays mock by default**; real inference is selected only when the parity-gate flag `DECISION_LAYA_REAL=1` is set. Rationale: "real Laya inference behind a parity gate" needs a real end-to-end path for the gate to mean anything; mock-first keeps every consumer byte-identical until opt-in.

## D2 — P3 parity gate: self-consistency only (user answer)
- NO Python reference, NO torch, NO onnxruntime-python. The backbone gate = **determinism** (same input → bit-identical logits), **IO-contract** (spike-verified dims/dtypes, `marker_mask` bool, `act_logits` conditional on qtype), **shape guards** (K≥2, seq/head max-len, int64/bool casts), **algebraic helper parity** (hand-computed expectations for confidence/temp/softmax math), and spike latency/RSS as informational baseline (2.3 s chain, ~600 MB — async batch use only).
- V1 int8 drift honesty: documented (int8 vs FP32 reference not runnable; no claim of 1e-4 FP32 logits parity — gate is self-consistency, per user).

## D3 — Dependencies granted (user answer): onnxruntime + tokenizers, skip Python
- `onnxruntime-node@1.30.0` (root production dep — same pin as spike) + `@huggingface/tokenizers` (root production dep, WASM) + `@huggingface/tokenizers` may need pinned version at install time.
- NO Python venv, NO `laya` pip install, NO committed Python fixtures. Tokenizer tests use special-token-ID reads from `tokenizer.json` + round-trip/determinism, not Python-generated fixtures.
- Weights: reuse `scripts/spike-laya/weights/v1/*` (already downloaded, gitignored). Runtime home decision: NEW `lib/services/laya/weights/` (gitignored) + generalized downloader script `scripts/fetch-laya-weights.mjs` (pin `nvkudva/laya-web-q8`, `v1`); copy existing spike weights once locally. Never stage weights.

## D4 — Client wiring shape (engine architecture)
- `DecisionProviderMode` stays `"none" | "laya"` — no new mode. The parity gate is a **sub-switch** in `buildProviders`: `DECISION_LAYA_REAL` truthy → `LayaRealProvider` (`provider = "laya"`); else `LayaMockProvider` (`"laya-mock"`).
- `DECISION_LAYA_MODEL_DIR` env (optional) overrides weights dir; default `lib/services/laya/weights/v1`.
- Real provider throws on load/run failure (no silent mock fallback) — matches provider-contract rule (provider throws, client retries, failure traces).
- `act_logits`/`action` decoded values do NOT extend `types.ts` answer contract (no consumer needs them yet) — surfaced via monitoring trace metadata; answer surface byte-compatible with mock consumers (fusion/POC A/B use gate + fusion only).

## D5 — Self-consistency test tolerance precedent
- Tokenizer/backbone/agent tests are `describe.skipIf(!weightsAvailable)` — mirrors the existing 4 client-cache IndexedDB skip precedent. CI without weights skips; local dev with weights runs full suite.

## D6 — Versioning / branch
- Next app version: **v3.41.3** (commit style `v3.41.3: <desc>`). Same feature branch — PR will carry v3.41.0 (`ab6fd65`) + v3.41.1 (`a269057`) + v3.41.2 (`5b088e3`) + v3.41.3 per user's push+PR request at the end (after wiki update).

## D7 — Completion record (2026-09-25, Phase 7 close-out)
- All Phase 1–6 scope DONE + VERIFIED + user-accepted plan step 21 (live in-process real ping `laya: ok` through the real 503 MB chained ONNX forward; HTTP ping 200 mock path). Gates: tsc **46 exact (0 new)** · lint **0 (1155 warnings; Lesson 139)** · **116/116 suites (1538 pass / 4 skip / 0 fail)** · quickbuild **189/189** · doc budget **85.4/100 KB**.
- Lesson-worthy findings recorded: `act_logits` snake_case graph-name vs camelCase key spike bug (Phase 4) · Jest vm × native-realm `instanceof Float32Array` → child-process probe (Phase 4) · ESLint disable-directive for an unregistered rule in native flat config (Lesson 139).
- Repo docs pass applied: AGENTS.md row + v3.41.2 tail, `versions-v3.41.md` §v3.41.3, CHANGELOG index, TODO blurb + retitle, Primer, agent-memory, Lessons 139, session-todos, HANDOFF yaml, handoff latest.md, session flow/decisions, extraction-plan status note.
- NEXT: user commits v3.41.3 (pending approval) → wiki update → push → PR carries v3.41.0 + v3.41.1 + v3.41.2 + v3.41.3.