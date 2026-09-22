# memory.md — Durable Research Reference

> **Purpose**: Budget-preserving cross-session memory for TradeNext research. Whenever a topic here is needed again, read THIS file instead of re-scraping the web. Full detail lives in the docs linked per section.
>
> **Rule**: Append new research findings here first, then write the long-form doc. Keep entries terse and link the doc.
>
> Last updated: 2026-09-22 (session "laya/typesafe decision-engine research").

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
7. Laya runtime/format for local inference in Node (transformers.js vs ONNX vs Python loop) — needs a spike.

---

## 7. Deliverables of research session (2026-09-22)

- `memory.md` — this file (durable condensed reference).
- `docs/laya.md` — Laya-focused doc.
- `docs/designDoc/ph22-laya-decision-engine-design.md` — detailed research + proposed decision-engine design for TradeNext (follows docs-workflow phNN convention).
- **Next step (user-stated)**: build the decision engine from this foundation — spec → plan → implement → verify per spec-driven-development.