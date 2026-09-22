# memory.md — Durable Research Reference

> **Purpose**: Budget-preserving cross-session memory for TradeNext research. Whenever a topic here is needed again, read THIS file instead of re-scraping the web. Full detail lives in the docs linked per section.
>
> **Rule**: Append new research findings here first, then write the long-form doc. Keep entries terse and link the doc.
>
> Last updated: 2026-09-23 (session "laya GitHub repo + JS runtime research + WIKI: Laya-based decision engine pages").

---

## 1. Laya — local System One decision model (HuggingFace)

**Doc**: `docs/laya.md` · **Model card**: https://huggingface.co/convaiinnovations/laya

- **What**: A multilingual, **non-autoregressive** "System 1 decision model" that **never generates text**. It makes machine-native decisions — calibrated judgments only — in a single forward pass (~**33 ms** on listed hardware). Apache-2.0.
- **Runtime**: single forward pass, no token-by-token generation. Trained for decision-making (Choice/Score/Noul-style outputs) rather than text.
- **Tags** (HF): `system-one`, `calibrated-decisions`, `rlcd`, `routing`, `scoring`, `guardrails`, multilingual, decision-making.
- **Training (RLCD)**: log + spherical strictly-proper scoring rules, REINFORCE with group-mean baseline, TD(λ=1.0) for temporal consistency. **Not** instruction-tuned autoregressive RLHF; it eschews generation entirely.
- **Files**: single `model.safetensors` ~ **843 MB** (xet-backed).
- **Languages**: 100+ (multilingual by design).
- **Key architectural fact**: does NOT generate text — output is structured decisions/probabilities. This is the core difference vs chat LLMs.
- **Comparison to Jev**: Laya = local, free, Apache-2.0, can run offline in-process; Jev = proprietary hosted API (see §2). Laya is positioned as the "free local alternative to Jev".
- **Media**: Full Medium article is 403-blocked from fetching, but recovered claims: Laya performs analogous System-One decision tasks (choice/score/routing) locally; article title claims "it can even play Doom-ish". Treat as marketing/comparison signal, not spec.
- **Use in TradeNext (candidate)**: a `lib/` service wrapping Laya for fast local decision scoring — e.g., choice classification of screener results, score-based rank fusion, noul gatechecks — with TypeSafe-style primitives (see `docs/designDoc/ph22-laya-decision-engine-design.md`).
- **SOURCE-CODE (canonical repo)**: `github.com/NandhaKishorM/laya` (16.3 k★ / 1.4 k forks) — the original implementation behind the HF card. **Python package** (`pip install laya`, Python 3.10+), `pyproject.toml` + `setup.py`.
  - **Router** — script/language detection → routes to one of 3 checkpoints: `laya` (English), `laya-multilingual`, `laya-typed-decisions` (fine-tuned from English).
  - **Decision functions**: `predict_decision(. .)` (choice/score/noul style) + `predict_shortlist(. .)` for high-cardinality label sets; confidence gating + temperature calibration built in.
  - **⚠️ Honest-limits (from README)**: base checkpoints score ~0.36 / 0.35 / 0.318 (vs chance 0.333) zero-shot on typed-decisions — **near chance**. The fine-tuned `laya-typed-decisions` checkpoint is where 0.766 (vs Jev 0.743) comes from. For TradeNext use `laya-typed-decisions`, NOT the base checkpoints.
  - **⚠️ Calibration**: models ship **over-confident** — ECE 0.466 (English) → 0.081 after fitting temperatures (fine-tuning notebook provided). Any JS port MUST fit temperatures per (question-type × option-count) before trusting probabilities for gating. Temp clamp `[0.5, 5.0]` per laya-coreml following upstream v0.3.5.
  - **Options limit**: token-budget `head_max_len` caps option count; >50 options needs `head_max_len` bump or `predict_shortlist`. Screener POCs use 3–10 options → fine.
- **Forks/implementations researched (2026-09-23)**:
  - `aayushch/laya` (101★) — ⚠️ **NOT a fork of the decision model.** Different product sharing the name: "Laya: Your AI Command Center" — local-first notification center (Tauri + Svelte + Python FastAPI + n8n; LLMs via Ollama/LM Studio/cloud BYOK). Ignore for decision-engine purposes.
  - `mizorewww/laya-coreml` (1.3 k★) — **independent Apple Core ML / Neural Engine port** (Python 3.11–3.13, macOS-only, `pip install laya-coreml`); HF weights `aac6fef/laya-multilingual-coreml-ane`; ~5 ms short decisions on M3 Max ANE FP16. Proves the "port a checkpoint to a different runtime" path works (with fidelity gates — see below).
  - `mizorewww/laya-mlx` — Apple-MLX (Apple silicon) sibling. Not relevant for a Linux Netlify server.
  - **laya-coreml's fidelity methodology to copy for JS**: 189/189 answer parity vs PyTorch reference, 100 repeated calls, per-dtype drift gates, calibration temp clamp. Do the same for an ONNX/JS port.
- **JS runtime reality (2026-09-23)**: Laya is Python (PyTorch/transformers). NO official JS impl. JS paths — (a) **transformers.js** (⚠️ ModernBERT-family + custom decision head support unverified), (b) **onnxruntime-node** after PyTorch→ONNX export (laya-coreml proves export path works; needs `transformers.onnx`/`optimum` conversion script), (c) **Python sidecar** (simplest, but NOT Netlify-deployable — no `pip install torch` + 800 MB model on a serverless build). In-process ONNX pp = 421 M-param FP32 ≈ 1.7 GB, FP16 ≈ 843 MB, INT8 ≈ 420 MB RSS — heavy for Netlify persistent server; needs spike gate.
  - Latency on CPU (README: 193–464 ms) ≈ Jev hosted (236–276 ms) → "local is faster" is a **GPU claim**; on a Netlify CPU server Laya≈Jev latency (value = cost/offline/privacy, not speed).
- **CODE-LEVEL EXTRACTION MAP (2026-09-23, repo v0.3.6, main `c7527708`)** — repo is the inference layer; the NN model class lives on HF (`model.safetensors` + `rl_agent_config.json` + `tokenizer/` + `encoder/` downloaded by `Agent`).
  - **Fully portable to TS (pure stdlib/numpy → pure TS 1:1, deterministic parity)**: `common.py` (`QTYPES` choice|score|noul=0|1|2; `render_options` label-order option rendering incl. noul `false:/true:` defaults; `build_sequence` `[CLS] <type> ins [SEP] [MASK] opt0… [SEP] state [SEP]` w/ marker positions + 48-token opt cap + `opt_budget<16` per-opt truncation; `confidence_from_probs` = normalized Shannon entropy `1−H(p)/log(k)`; `temp_bucket(qt,k)` `{qtype}:{2|3-5|6-10|11+}`; `clamp_temperature` [0.5,5.0]; `ece_score`), `agent.py` `system_one()` decode (per-q: `logits[:k]/t_scale` → max-sub softmax → probs; choice=argmax, score=Σ i·p_i = expected value, noul=p[1] w/ conf=max(p1,1−p1); `usage.input_tokens`; rounded 4dp) + question normalization `_to_internal` (choice list→dict, ins→JSON str), `lang.py` (regex+unicode-range script detect, stopword/diacritic Latin guess — zero deps), `router.py` routing precedence (model>task>workflow>lang>script-detect>default; LRU cache; typed-decisions NEVER auto unless `auto_task_detection`), `shortlist.py` orchestration (cosine top-k then one predict; mean-pool `embed_fn_from_agent` needs backbone), `presets.py` (static q dicts: triage/email/guard/moderation/router), `email.py` (small text utils).
  - **Python-runtime required (2 things only)**: **① tokenizer** — `tokenizer/*` dir (ModernBERT = 50k English BPE; mmBERT = WordPiece) → port via same-`tokenizer.json` + WASM (`@huggingface/tokenizers`) for **exact ID parity**; **② backbone inference** — `DecisionModel` (encoder `AutoModel` sdpa + `type_emb` Embedding(3,d) + 2-layer `TransformerEncoder(d,d//64,4d,norm_first)` + `scorer` LN→L→GELU→L(1) + `act_head` L(d+4→256)→GELU→L(256,n_act); forward adds type_emb, runs head layers, `gather` marker hidx, scorer logits masked `−1e4`, softmax, entropy+top2 features → act) — port via **whole-model ONNX export** (encoder+head one graph; optimum; laya-coreml proved export path w/ 189-189 parity) + **onnxruntime-node**. Reimplementing the head in TS is feasible but slower to verify; whole-model export is proven.
  - **Model footprints**: english/typed = 421M ModernBERT-large (512/1024 tok); multilingual = 322M mmBERT-base (1024 tok). FP32 ≈1.6/1.3GB, FP16 ≈843/650MB, INT8 ≈420/330MB RSS.
  - **Checkpoint repo layout** (download allow_patterns): `rl_agent_config.json` (encoder id, head_layers, act_costs, temperature, temperature_by_options, amp_dtype, max_len=512, head_max_len=192), `model.safetensors`, `tokenizer/*`, `encoder/*` (optional local encoder).
  - **Parity fixtures to reuse**: `tests/test_local_e2e.py` (12.8KB end-to-end), `test_criteria.py`, `test_router.py`, `test_shortlist.py`.

---

## 2. Jev 1.13.0 — TypeSafe AI's System One model (published, hosted)

- **Identity**: Jev is **NOT** a GitHub OSS project. `github.com/answers-ai/jev` is a **404** (premise disproven during research). Jev is TypeSafe AI's **proprietary, closed-API** model, "the first public System One model".
- **Versioning**: docs use `jev-1.13.0` in API **response** examples and `jev-latest` in **request** examples; SDK default model is `jev-latest`. Version high-water mark during research: **1.13.0 (published)**.
- **Endpoint**: `POST https://api.typesafe.ai/v1/systemone`.
- **Console**: https://console.typesafe.ai/ (playground, shared decode links).
- **Design claims**: "a new architecture, a new sampler, a new training algorithm (RLCD)" → "calibrated probabilities instead of generated text". TypeSafe cofounder Diogo Almeida co-invented RLHF; they contrast RLCD vs RLHF (sycophancy/hallucination/mode-dropping) and RLVR (slow/expensive).
- **Latency/bench**: homepage benchmark ~0.114 s/decision; docs say ~100 ms (build page) vs 150 ms (use-case map) — **discrepancy not reconciled**.
- **Cost claim**: "194.6x cheaper / 193.6x faster" than leading reasoning LLM (marketing baseline uncaptured — treat as directional).

---

## 3. TypeSafe AI — concepts

**Full doc**: `docs/designDoc/ph22-laya-decision-engine-design.md` (research + proposed design)

- **System One Model**: makes fast structured decisions software can use directly; returns **typed answers + probabilities**, not text. Named after Kahneman's System 1 (fast/intuitive). No agent autonomy — the model never picks its own next step.
- **State**: the single content a request evaluates — string, JSON object, or array of text. One `state` per request, shared by all questions. No thread/turn state in docs; multistep workflows = code re-issuing requests.
- **Primitives** (typed answers; decision logic lives in YOUR code):
  - **Choice** → `{ choice, probabilities[], confidence ∈ [0,1] }` — pick one of N options.
  - **Score** → `{ score, probabilities[], confidence ∈ [0,1] }` — position on an ordered rubric (non-integer allowed, e.g. 1.4).
  - **Noul** → `{ noul: 0–1 }` — truth value; **no confidence field**.
  - confidence = f(probability distribution shape): flat → uncertain, peaked → confident; `(count·peak−1)/(count−1)` family for uniform baseline.
- **Calibration**: probabilities track actual outcome frequency across groups (0.2 → ~20% of the time; 1.0 → 100%).
- **RLCD** = Reinforcement Learning for Calibrated Decisions (TypeSafe's algorithm; Laya uses same family).
- **Atomicy**: ask atomic, well-scoped questions; compose in code. Backticked paths (`support.tickets[0].message`) point questions at nested state values. Parallel isolated evaluation avoids "context-rot".
- **Patterns**:
  - **Speculative fan-out** — many independent questions in ONE parallel request (cheap, low latency; add questions ≈ no extra latency) → combine in code.
  - **Confidence-gated routing** — high conf → act; medium → cautious (confirm/review); low → escalate/human/fallback. Thresholds per-action, risk-scaled (read-only vs destructive).
  - **Composite scoring** — multiple Score questions fused (weighted sums) into one decision.
  - **Intent routing** — use Choice to classify intent, route to different code paths.

---

## 4. TypeSafe AI JS SDK (`@typesafe-ai/sdk`)

- **Package**: `@typesafe-ai/sdk` — current **v0.6.0** (2026-09-15). v0.5.7 initial (2026-09-11).
- **Breaking change v0.6.0**: `Score.criteria` is now an **ordered tuple** (list of ordered levels) instead of a set.
- **Runtime**: Node.js 20+; ships ESM + CJS + TS declarations.
- **Env vars**: `TYPESAFE_API_KEY` (required), `TYPESAFE_BASE_URL` (default `https://api.typesafe.ai`), `TYPESAFE_DEFAULT_MODEL` (default `jev-latest`), `TYPESAFE_LOG_LEVEL` (default `warn`).
- **Quickstart shape**:
  ```ts
  import { TypeSafeClient } from "@typesafe-ai/sdk";
  const client = new TypeSafeClient();            // reads env
  const res = await client.systemOne({ state, questions: [ choice({ name: "..." }) ] });
  const ans = res.answers["..."];                 // typed answer
  ```
- **Model discovery**: `client.models.list()`.
- **Gotcha**: free/paid keys and limits not documented in fetched pages; no npm auth needed but package requires API key at runtime.

---

## 5. Research sources + status

| Source | URL | Status |
|---|---|---|
| Laya HF model card | https://huggingface.co/convaiinnovations/laya | ✅ fetched |
| TypeSafe homepage | https://typesafe.ai/ | ✅ fetched |
| Docs intro / ML primer / confidence / system-one / state / how-to-build / use-case map | https://docs.typesafe.ai/{introduction, introduction/machine-learning-primer, confidence, concepts/system-one, concepts/state, concepts/how-to-build-with-system-one, concepts/use-case-map} | ✅ all fetched |
| Primitives (index, choice, score, noul, advanced) | https://docs.typesafe.ai/primitives{,/choice,/score,/noul,/advanced} | ✅ fetched |
| Patterns (index, fan-out, confidence-routing, composite-scoring, intent-routing) | https://docs.typesafe.ai/patterns{,/fan-out,/confidence-routing,/composite-scoring,/intent-routing} | ✅ fetched |
| Smart-home demo | https://docs.typesafe.ai/demos/smart-home | ✅ fetched |
| JS SDK (getting-started, api) | https://docs.typesafe.ai/sdk/javascript{,/api} | ✅ fetched |
| **Medium article** (Laya vs Jev) | https://medium.com/@christian.graham_49279/laya-a-free-local-alternative-to-jev-and-it-can-even-play-doom-ish-42e2292e541e | ❌ **403 blocked** (recovered via search snippets only) |
| Jev repo (non-existent) | https://github.com/answers-ai/jev | ❌ 404 — premise disproven |
| **Laya source repo (canonical)** | https://github.com/NandhaKishorM/laya (v0.3.6, main `c7527708`) | ✅ code fetched |
| Laya `common.py` (arch + decode math) | https://raw.githubusercontent.com/NandhaKishorM/laya/main/laya/common.py | ✅ fetched |
| Laya `agent.py` (`system_one` runtime) | https://raw.githubusercontent.com/NandhaKishorM/laya/main/laya/agent.py | ✅ fetched |
| Laya `router.py` / `lang.py` | https://raw.githubusercontent.com/NandhaKishorM/laya/main/laya/{router,lang}.py | ✅ fetched |
| Laya `shortlist.py` / `presets.py` | https://raw.githubusercontent.com/NandhaKishorM/laya/main/laya/{shortlist,presets}.py | ✅ fetched |
| Laya fork `aayushch/laya` | https://github.com/aayushch/laya | ⚠️ DIFFERENT product (notification cmd center) — not a decision-model fork |
| Laya port `mizorewww/laya-coreml` (Core ML/ANE) | https://github.com/mizorewww/laya-coreml (weights `aac6fef/laya-multilingual-coreml-ane`) | ✅ provenance — export+fidelity gates model to copy |
| API endpoint | `POST https://api.typesafe.ai/v1/systemone` | reference (not hit) |
| Docs machine index | https://docs.typesafe.ai/llms.txt | advertised (not fetched) |

---

## 6. Open questions (for engine design)

1. Jev underlying architecture unspecified (docs claim "new architecture" but ML primer implies pretrained-LM base — unresolved).
2. Noul semantics/etymology + whether a 2-atom distribution backs `noul`.
3. Score: point estimate vs expectation over level distribution.
4. Confidence formula is demo-illustrated, not formal; a cookbook is "planned" (link TBA).
5. Latency canonical value unclear (~100 ms vs 150 ms vs 0.114 s).
6. Cost/limit model for `typesafe.ai` hosted API undocumented on fetched pages.
7. ~~Laya runtime/format for local inference in Node (transformers.js vs ONNX vs Python loop) — needs a spike.~~ → **ANSWERED (research-level, 2026-09-23)**: Laya = Python (`torch`/`transformers`). JS port = pure-TS ports of everything in `common.py`/`agent.py`/`lang.py`/`router.py`/`shortlist.py`/`presets.py` (deterministic, test-parity) + 2 runtime deps: (a) same-checkpoint `tokenizer.json` via WASM tokenizers (@huggingface/tokenizers) for exact ID parity, (b) whole-model ONNX export (encoder + head) run via onnxruntime-node (path proven by laya-coreml's CoreML export + 189/189 parity). **Remaining spike question**: onnxruntime-node memory/latency reality on the Netlify persistent server (421M FP16 ≈843MB vs INT8 ≈420MB) — still needs Phase-0 spike gate; nothing committed to a runtime yet.

---

## 7. Deliverables of research session (2026-09-22)

- `memory.md` — this file (durable condensed reference).
- `docs/laya.md` — Laya-focused doc.
- `docs/designDoc/ph22-laya-decision-engine-design.md` — detailed research + proposed decision-engine design for TradeNext (follows docs-workflow phNN convention).
- **Next step (user-stated)**: build the decision engine from this foundation — spec → plan → implement → verify per spec-driven-development.