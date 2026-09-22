# Laya — Local System 1 Decision Model

> **Source of truth**: HuggingFace model card — https://huggingface.co/convaiinnovations/laya
> **Source code**: https://github.com/NandhaKishorM/laya (canonical repo, v0.3.6, main `c7527708` — Python inference runtime; the NN model class lives on HF)
> **License**: Apache-2.0 · **Status**: actively published (research snapshot 2026-09-22, code-level extraction 2026-09-23)

Laya is a **multilingual, non-autoregressive "System 1 decision model"** — it makes calibrated, machine-native decisions and **never generates text**. It is positioned as the free, local, Apache-2.0 alternative to TypeSafe AI's hosted **Jev** model (see `docs/designDoc/ph22-laya-decision-engine-design.md` for the full TypeSafe/Jev/SDK context).

---

## 1. What Laya is

| Property | Value |
|---|---|
| Model | `convaiinnovations/laya` |
| License | Apache-2.0 (weights downloadable, local inference allowed) |
| Architecture class | Non-autoregressive; single forward pass — no token-by-token generation |
| Decision latency | ~33 ms per decision (single forward pass, model-card claim) |
| Output | Structured decisions + calibrated probabilities (no text generation) |
| Languages | 100+ (multilingual by design) |
| Weights | Single `model.safetensors`, ~843 MB (xet-backed) |
| HF tags | `system-one`, `calibrated-decisions`, `rlcd`, `routing`, `scoring`, `guardrails` |

**The core design principle**: like TypeSafe's System One models, Laya is a *judgment engine*, not a *text generator*. You supply a **state** (string/JSON/array) plus **atomic questions**, and it returns typed answers (choice / score / truth-value style) with calibrated probabilities — the same primitive family as TypeSafe's `Choice` / `Score` / `Noul`.

---

## 2. Training (RLCD family)

Laya is trained for calibrated decision-making rather than next-token prediction of prose:

- **RLCD (Reinforcement Learning for Calibrated Decisions)** training family — shared DNA with TypeSafe's Jev:
  - **Log + spherical strictly-proper scoring rules** — the reward signal only optimises when probabilities are honest (you cannot game expected score by hedging or over-claiming).
  - **REINFORCE with a group-mean baseline** — variance reduction without a critic network.
  - **TD(λ = 1.0)** — temporal-consistency / returns accumulation across decision steps.
- Explicitly **not** an instruction-tuned, RLHF-chat pipeline; escapes the RLHF failure modes (sycophancy, confident hallucination, mode dropping).

---

## 3. What it is NOT

- ❌ NOT an LLM chat model — it will not write prose, answer open-ended questions, or produce free text.
- ❌ NOT an autoregressive generator — a single forward pass suffices (hence the ~ms latency).
- ❌ NOT hosted/closed — weights are on HuggingFace under Apache-2.0; you can run it locally and offline.
- ❌ NOT the same as Jev — Jev is TypeSafe's **proprietary hosted API** (`jev-1.13.0` / `jev-latest` at `https://api.typesafe.ai/v1/systemone`). Laya is the local/open counterpart.

---

## 4. Media coverage

- **Medium article** — "Laya: a free, local alternative to Jev (and it can even play Doom-ish)" by christian.graham_49279.
  - Direct fetch **HTTP 403** (blocked); claims recovered via search snippets only:
    - Laya performs analogous System-One decision tasks (choice / scoring / routing) locally and free.
    - Headline Doom reference is a (joke) demo of decision-speed, not a game emulator.
  - Treat as **comparison signal / marketing**, not specification. Model card is the spec.

---

## 5. How TradeNext could use it (direction, not commitment)

Candidate integration: a server-side decision layer (`lib/services/decision/…`) that runs Laya locally for:

1. **Choice classification** — e.g. screen-result category (`momentum | breakout | trend | reversal`) with probabilities.
2. **Score-based rank fusion** — score each screened stock against rubrics (setup quality, risk, drift) and fuse weighted sums for ordering.
3. **Noul-style gatechecks** — fast truth-value guardrails (e.g. "is this recommendation still valid?" / "is market regime trending?").
4. **Confidence-gated routing** — high confidence → auto-act (e.g. alert/signal emit), medium → review queue, low → escalate to the AI agent (OpenRouter) or human.

Follows the same pattern vocabulary as TypeSafe (fan-out, confidence-gating, composite scoring) but runs **in-process, free, offline**.

> ⚠️ **Open spike**: local inference path in Node.js (transformers.js / ONNX runtime / Python sidecar) is **unverified** — see open questions in `memory.md` §6 and the design doc §7. This must be prototyped before committing to the integration.

---

## 5b. Code-level extraction (2026-09-23)

The canonical repo (`NandhaKishorM/laya`, v0.3.6) is the **inference/decode layer**, not the model. Concretely:

| Layer | What it is | Python → JS port |
|---|---|---|
| `common.py` | prompt construction (`build_sequence`), `DecisionModel` head, decode math (`confidence_from_probs`, `temp_bucket`, `clamp_temperature`, `ece_score`) | **pure TS 1:1** (deterministic parity) |
| `agent.py` | `system_one()` answer shaping (choice/score/noul), temperature application, load/verify weights | **pure TS 1:1** |
| `router.py` / `lang.py` / `shortlist.py` / `presets.py` / `email.py` | checkpoint routing, language/script detection, shortlist reduction, question presets | **pure TS 1:1** |
| `model.safetensors` + `tokenizer/*` + `rl_agent_config.json` | encoder + small decision head; tokenizer; config | ONNX export + `onnxruntime-node`; tokenizer via same `tokenizer.json` on WASM |

**Only two Python-runtime dependencies**: the tokenizer (same `tokenizer.json` on the WASM runtime reproduces identical IDs) and the backbone (`DecisionModel` exported to a single ONNX graph from PyTorch — the same export path `mizorewww/laya-coreml` validated with 189/189 answer parity).

**Fork/impl warnings**:
- `aayushch/laya` is **NOT a fork** — unrelated "AI notification command center" (Tauri+Svelte+FastAPI+n8n). Ignore for decision-engine purposes.
- `mizorewww/laya-coreml` / `laya-mlx` are real Apple-only ports of the decision model (~5 ms on M3 Max ANE) — the fidelity methodology to copy, not the runtime.

Full port plan with per-algorithm reproduction specs: **`docs/designDoc/ph22-laya-js-extraction-plan.md`**.

---

## 6. Related docs

- `memory.md` §1 – condensed durable reference (budget-preserving).
- `docs/designDoc/ph22-laya-decision-engine-design.md` – full TypeSafe/Jev/SDK research + proposed decision-engine design.
- https://huggingface.co/convaiinnovations/laya – authoritative model card.