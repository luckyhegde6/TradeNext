# ph22 — Laya→JS Code Extraction Plan (NandhaKishorM/laya)

> **Scope**: port the actual Python source of `https://github.com/NandhaKishorM/laya` (v0.3.6, main `c7527708`) to TypeScript for in-process use by TradeNext. **Documentation-only plan** — no implementation without human approval (POC-scope decision standing).
> **Related**: `.agents/specs/16-decision-engine.md`, `.agents/plans/16-decision-engine.md`, `docs/designDoc/ph22-laya-decision-engine-design.md`, `docs/laya.md`, `memory.md` §1.

---

## 1. Ground truth: what the repo actually is

The repo is **not** the model — it is the **inference runtime + decode layer** around HF checkpoints. `DecisionModel` (the only `nn.Module`) is tiny; the heavy encoder is pulled from `transformers.AutoModel` at load time. Everything else is **pure-Python business logic** (stdlib + numpy) → **deterministically portable to TS 1:1** with exact numerical parity.

### File inventory (8 package modules + tests)

| Module | Size | Role | Port strategy |
|---|---|---|---|
| `laya/common.py` | 11.4 KB | `QTYPES`, `serialize_state`, `render_criterion`/`render_options`, `build_sequence` (prompt→ids), `DecisionModel` (head), `proper_reward`/`td_lambda_targets` (train-only), `ece_score`, `confidence_from_probs`, `temp_bucket`/`clamp_temperature`, `collate_items`, `amp_dtype` | **TS 1:1** (train-only fns skipped or stubbed) |
| `laya/agent.py` | 17 KB | `Agent`/`RLAgent`, `load()`, `system_one()` (decode → answers), tokenizer/weights loading, device/dtype resolution, temperature clamp at load | **TS 1:1** for `system_one` decode + config; load path → ONNX/WASM runtime |
| `laya/router.py` | 14.5 KB | 3-checkpoint registry + `Router` (LRU cache, routing precedence, `RouteDecision`) | **TS 1:1** |
| `laya/lang.py` | 16 KB | Dependency-free script/language detection (`analyse`, `detect_script`, `latin_profile`, stopword lists) | **TS 1:1** (port the 25 unicode ranges + 8 stopword sets + diacritic regex) |
| `laya/shortlist.py` | 10.2 KB | `predict_shortlist`, `shortlist_choice`, `embed_fn_from_agent` (mean-pool), cosine rank | **TS 1:1** (embed_fn swaps to JS provider) |
| `laya/presets.py` | 7.2 KB | `triage_questions`, `email_questions`, `guard_questions`, `moderation_questions`, `router_questions` | **TS 1:1** (static data) |
| `laya/email.py` | 4.3 KB | `clean_email_body`, `email_state` | **TS 1:1** |
| `laya/__init__.py` | 1.3 KB | Public API + `__version__ = "0.3.6"` | TS barrel + version const |

### Not in repo (pulled from HF at load via `snapshot_download`, `allow_patterns=[rl_agent_config.json, model.safetensors, tokenizer/*, encoder/*]`)

- `rl_agent_config.json` — `encoder` id, `head_layers`, `act_costs`, `temperature` [3], `temperature_by_options` (bucket→t), `amp_dtype`, `max_len` (512), `head_max_len` (192).
- `model.safetensors` — English `convaiinnovations/laya` (421M ModernBERT-large), `laya-multilingual` (322M mmBERT-base), `laya-typed-decisions` (421M, fine-tuned).
- `tokenizer/*` — the checkpoint's own tokenizer (ModernBERT = 50k English BPE; mmBERT = WordPiece).
- `encoder/*` — optional local encoder dir (only when a repo stores it separately).

> **Ordering note**: `Agent` builds `DecisionModel` from `cfg["encoder"]` via `AutoModel.from_pretrained(cfg["encoder"], attn_implementation="sdpa")`; the same id must map to an ONNX-ready encoder in the JS port.

---

## 2. The four things that must match exactly (parity contract)

Porting is only worth it if **the JS produces byte-comparable decisions to Python**. These are the four surfaces where divergence would silently break decisions:

1. **`build_sequence`** — prompt→token-ids construction (`[CLS] <type> ins [SEP] [MASK] opt0 [MASK] opt1 … [SEP] state [SEP]`): marker positions, 48-token option cap, `opt_budget<16` per-option truncation, `truncate_left` state tailing, `max_len` cut. Depends on tokenizer ID parity → **must use the same `tokenizer.json` via WASM tokenizers** (see §4).
2. **`DecisionModel.forward`** — encoder → `+ type_emb(qtype)` → `head` (2-layer TransformerEncoder, `norm_first`, `d//64` heads, 4d FFN) → gather marker hidden states → `scorer` (LN→L→GELU→L(1)) → `logits.masked_fill(~marker_mask, -1e4)` → also `act_head` from `[pooled, top1, top1−top2, ent, k/255]`. Whole-model ONNX export (§4) keeps this exact.
3. **Temperature application + softmax** (agent decode) — `t = temperature_by_options.get(temp_bucket(qt,k), temperature[qt])`; `logits[:k]/t` → max-sub softmax. Clamped `[0.5, 5.0]` at load (ships over-confident: `choice:11+` raw 0.1006 → refused).
4. **Answer shaping** (agent decode) — choice: `keys[argmax]` + per-key probabilities; score: `Σ i·p_i` expected value + `legend`; noul: `p[1]` + `conf = max(p1, 1−p1)`; `confidence = 1 − H(p)/log(k)`; all floats `round(4)`; `usage.input_tokens = Σ attention_mask`.

Every helper in the TS port gets a **Python-vs-JS unit test** on fixed inputs (fixtures generated from the Python package once, committed as JSON).

---

## 3. Target architecture (TradeNext `lib/services/laya/`)

Mirror the Python package 1:1 so the port stays auditable against upstream:

```
lib/services/laya/
├── index.ts            # barrel: Agent, Router, presets, lang, shortlist (mirrors __init__.py)
├── version.ts          # LAYA_VERSION = "0.3.6"; SOURCE_SHA = "c7527708…"
├── qtypes.ts           # QTYPES = {choice:0, score:1, noul:2}, QTYPE_NAMES (from common.py)
├── serialize.ts        # serialize_state, render_criterion, render_options (common.py)
├── buildSequence.ts    # build_sequence — pure function over a TokenizerLike
├── decisionModel.ts    # ONNX session wrapper: forward(inputIds, attnMask, markerPos, markerMask, qtype) → {logits, actLogits}
├── calibration.ts      # confidence_from_probs, temp_bucket, clamp_temperature, ece_score, TEMP_MIN/MAX (common.py)
├── collate.ts          # collate_items — batching/padding (common.py)
├── agent.ts            # LayaAgent: load config + weights, system_one(state, questions) → answers (agent.py)
├── tokenizer.ts        # TokenizerLike over @huggingface/tokenizers WASM; load from tokenizer.json
├── router.ts           # Router: LRU cache, routing precedence, RouteDecision (router.py)
├── lang.ts             # analyse, detect_script, latin_profile, is_english + stopword tables (lang.py)
├── shortlist.ts        # predict_shortlist, shortlist_choice, cosine, embedFn provider seam (shortlist.py)
├── presets.ts          # triage/email/guard/moderation/router question builders (presets.py)
└── email.ts            # clean_email_body, email_state (email.py)
```

`agent.ts` produces **exactly** the `system_one` response contract from agent.py (answers keyed by qid + `usage`), so it plugs straight into the existing decision-engine provider contract (`lib/services/decision/types.ts` → `DecisionProvider`; `layaProvider.ts` becomes a thin adapter over `LayaAgent.system_one`).

---

## 4. The two unavoidable Python-runtime dependencies (and the JS replacements)

### 4a. Tokenizer — same `tokenizer.json`, WASM runtime

- Python uses `AutoTokenizer.from_pretrained(<checkpoint>/tokenizer)`. The serialized `tokenizer.json` is runtime-agnostic.
- JS: `@huggingface/tokenizers` WASM loads the same `tokenizer.json` → **identical IDs/offsets** → `build_sequence` parity.
- Fallback if a checkpoint lacks `tokenizer.json` (only raw `vocab.txt`/`tokenizer_config.json`): convert with a one-off Python snippet at port time (committed artifact, not runtime code), or use `tokenizers` CLI. Verify by parity test on 100 fixed strings.

### 4b. Encoder + decision head — whole-model ONNX export

- Python: `build_model` = `AutoModel.from_pretrained(cfg["encoder"], attn_implementation="sdpa")` wrapped in `DecisionModel` (+ `type_emb`, `head`, `scorer`, `act_head`).
- JS: export **the whole `DecisionModel` to a single ONNX graph** (encoder + head + gather + scorer + act_head) via a one-off Python export script (`optimum`/`torch.onnx.export` with dynamic axes: batch, seq, kmax markers). Runtime: **`onnxruntime-node`**.
  - This is exactly the path `mizorewww/laya-coreml` validated (CoreML export, 189/189 answer parity, ~5 ms on ANE).
- Export-time concerns to verify in the spike:
  - `AttentionMask`/gather with dynamic `marker_pos`/`marker_mask` — export with dynamic axes + `opset ≥ 17`; the head does `masked_fill` and gather on marker positions, all ONNX-expressible (Gather/Where/ScatterND).
  - Integer qtype embedding lookup (`type_emb`) — embed as a small ONNX Gather over an embedding matrix.
  - `n_act = len(act_costs)+1` — read from `rl_agent_config.json`.
  - FP32 export for CPU parity first; FP16/INT8 quantization is a later optimization (weights: 421M FP32≈1.7GB, FP16≈843MB, INT8≈420MB).
- If whole-model export proves fragile in the spike, **fallback**: export only the encoder ONNX, reimplement the (small) head in TS — head is just 2 TransformerEncoder layers + 2 MLPs + embedding lookup. Decision recorded in spike verdict.

---

## 5. Port detail — the exact algorithms to reproduce (from source)

### 5.1 `build_sequence` (common.py)
```
format: [CLS] <type> instructions [SEP] [MASK] opt0 [MASK] opt1 ... [SEP] state [SEP]
mask_tok = tok.mask_token; ins = q["ins"].replace(mask_tok, " ")
head_ids = tok(f"{t} question: {ins}", add_special_tokens=False)
opt_ids[i] = [mask_token_id] + tok(" " + render_option(i).replace(mask_tok," "), no-special)[:48]
opt_budget = head_max_len − Σ len(opt_ids);  if <16: per = max(4,(head_max_len−16)//n); truncate each opt to per
head_ids = head_ids[:max(8, opt_budget)]
ids = [cls] + head_ids + [sep]; markers = positions where each opt_id block starts (len→markers)
ids.append(sep)
room = max(0, max_len − len(ids) − 1)
st = tok(serialize_state(state).replace(mask_tok," "), no-special); st = st[-room:] if truncate_left else st[:room]
ids = ids + st + [sep]; return ids[:max_len], markers<max_len
```
Validation in `system_one`: `len(markers) == len(render_options(q))` else `ValueError("options exceed head_max_len")`.

### 5.2 `DecisionModel.forward` (common.py)
```
h = encoder(input_ids, attention_mask).last_hidden_state          # [B,L,d]
h = h + type_emb(qtype)[:,None,:]                                  # qtype ∈ {0,1,2}
for layer in head.layers: h = layer(h, src_key_padding_mask=~attn) # 2× norm_first TransformerEncoderLayer
m = gather(h, markers)                                             # [B,K,d]
logits = scorer(m).squeeze(-1); logits = masked_fill(~marker_mask, -1e4)
p = softmax(logits.detach(), -1); k = Σmarker_mask (min 2)
ent = −Σ(p·log p)/log(k)
top2 = p.topk(2) (single-option → pad [top1, 0])
feats = [top1, top1−top2, ent, k/255]; pooled = h[:,0]
act_logits = act_head([pooled, feats])                            # [B, n_act]
return logits, act_logits
```

### 5.3 `system_one` decode (agent.py)
```
for each qid: q = _to_internal(qdef); seq,markers = build_sequence(tok, state, q)
  _to_internal: choice criteria list→dict {c:None}; instructions not str → json.dumps
b = collate_items([items], pad_token_id)
logits, act = model(...); act = softmax(act)
per r,qid:
  k = len(markers); t_scale = temperature_by_options.get(temp_bucket(qt,k), temperature[qt])
  z = logits[r,:k]/t_scale; p = softmax(z) (max-sub)
  confidence = round(confidence_from_probs(p,k), 4)             # 1 − H(p)/log(k)
  choice → {"type":"choice","choice":keys[argmax],"probabilities":{k:v}, "confidence", "action":{act_probability}}
  score  → {"type":"score","score":Σ i·p_i,"legend":{str(i):c},"probabilities":{str(i):v}, "confidence", "action"}
  noul   → {"noul":p[1],"confidence":max(p1,1−p1),"action"}
return {"model":"laya-rl-agent","answers":answers,"usage":{"input_tokens":Σattn,"output_tokens":0}}
```

### 5.4 Router precedence (router.py)
`explicit model > explicit task > detected workflow (auto_task_detection only) > explicit lang > analysed script/language > default(english)`.
- Non-Latin script ⇒ `multilingual`; Latin + `is_english` ⇒ `english`; Latin + non-English/undecided ⇒ `multilingual`.
- LRU cache `max_loaded` (default 1) evicts least-recently-used agents; `preload` raises cap.
- `typed-decisions` **never** auto-selected unless `task="typed_decisions"` or workflow match + opt-in.

### 5.5 `lang.py` detection — port 1:1
- `_SCRIPT_RANGES` — 25 script unicode-range tables; `detect_script` counts by codepoint, Latin + Latin-Extended-Additional (`<0x0250` or `1E00–1EFF`) special-cased.
- `_STOP` — en/fr/de/es/pt/it/nl/ro stopword sets; `_NON_EN_DIACRITICS` string; `_SHARED_WORDS` computed; `_WORD = [^\W\d_]+` regex.
- `latin_profile`: scores by stopword hits, margin `best ≥ max(2, en+2)` (or `max(2,en)` if diacritics) + evidence rule (≥1 non-shared word).
- `analyse`: script→language→`is_english`; `undecided ≠ english` unless no non-English letters.

### 5.6 `shortlist.py`
- `predict_shortlist`: for choice questions with `n > k`, rank by cosine(embed(query), embed(options)), take top-k, one predict on reduced criteria; attach `shortlist` metadata. Non-choice passthrough.
- `embed_fn_from_agent` → JS seam: mean-pool encoder over a bi-encoder (default: the same ONNX encoder in projection mode; a dedicated embeddings model is deferred).

---

## 6. Phased plan (informed by spec/plan 16 Phase 0 spike gate)

| Phase | Deliverable | Verifies |
|---|---|---|
| **P0 — Spike (BLOCKING gate)** | `scripts/laya-spike/`: (a) one-off Python export script → whole-model ONNX from a real checkpoint; (b) onnxruntime-node smoke: load, one forward, decode 3-sample choice/score/noul; (c) RSS + per-decision latency vs Python on same CPU; (d) check Netlify persistent-server fit (421M FP32/FP16/INT8) | `VERDICT.md`: runtime chosen (onnxruntime-node vs fallback TS head), export toolchain pinned, memory/latency numbers. **No provider code until verdict** |
| **P1 — Pure-TS ports (no weights needed)** | `lib/services/laya/{qtypes,serialize,calibration,collate,lang,router,presets,email,version,index}.ts` + unit tests + `buildSequence.ts` (over a fake tokenizer) | Python-vs-JS parity tests; `tsc`; `npm run test` |
| **P2 — Tokenizer** | `tokenizer.ts` wrapping `@huggingface/tokenizers` WASM; load real `tokenizer.json` | 100-string ID parity vs Python `AutoTokenizer` |
| **P3 — Backbone** | `decisionModel.ts` (ONNX session); weights/config fixture download + version pin | One-forward parity (logits within 1e-4); latency/RSS on target host |
| **P4 — Agent + adapter** | `agent.ts` (full `system_one`), then thin `layaProvider` adapter into `lib/services/decision/` | End-to-end: same input state/questions → same answers as Python (fixture JSON); decision-engine unit tests green |
| **P5 — Router + shortlist + presets wiring** | File/provider wiring over the decision client; `DECISION_PROVIDER=laya|auto` paths | Router precedence tests; shortlist k-reduction tests; engine-off inert default preserved |
| **P6 — Docs + e2e** | Docs pass (version row, changelog, Primer, agent-memory, Lessons), admin panel ping includes Laya health/latency/source | Full validation sweep (`tsc`, `lint`, `test`, `quickbuild`, e2e); doc budget |

> Every phase ends with a check that can pass/fail independently; P0 result may change P3 strategy (whole-model ONNX vs TS-head fallback vs INT8 quantization).

> **Status (2026-09-25, v3.41.3):** P1–P3 implemented (see `.agents/changelog/versions-v3.41.md` §v3.41.3) — `lib/services/laya/` pure-TS ports (`version`/`qtypes`/`serialize`/`calibration`/`collate`/`presets`/`email`/`buildSequence`/`lang`/`router`) · `tokenizer.ts` WASM (`@huggingface/tokenizers`, `add_special_tokens=false` encode parity) · `decisionModel.ts` chained ONNX encoder_q8→head_q8 (`onnxruntime-node@1.30.0`), weights `lib/services/laya/weights/v1/` (gitignored) via `scripts/fetch-laya-weights.mjs`; real path behind `DECISION_LAYA_REAL=1` → `LayaRealProvider` (mock default byte-identical); live in-process ping `laya: ok` (503 MB chain). P4–P6 (full `agent.ts` → router/shortlist/presets wiring → docs/e2e sweep) NOT started — keep this plan for the remaining phases.

---

## 7. Verification & fidelity gates (modeled on laya-coreml)

1. **Deterministic helper parity** — for fixed inputs: `build_sequence` IDs identical; `confidence_from_probs`, `temp_bucket`, `clamp_temperature`, `ece_score` within 1e-12; answers rounded 4dp identical.
2. **Backbone parity** — ONNX vs PyTorch logits within `1e-4` (FP32), FP16/INT8 drift gated (laya-coreml baseline: drift 0.014 within gate).
3. **Answer parity** — ≥189/189 like laya-coreml on a committed fixture set derived from `tests/test_local_e2e.py` scenarios; repeated-call determinism (same input → same answer).
4. **Calibration honesty** — apply clamp at load; verify with raw-sharpening buckets refused (warn like upstream: "treat confidence from affected buckets as uncalibrated").
5. **Regression contract** — decision-engine suite (spec 16 tests: gate, client, fusion, swing gatecheck) stays green; `DECISION_PROVIDER=none` remains inert.

---

## 8. Risks & tradeoffs

| Risk | Mitigation | Deferred |
|---|---|---|
| ONNX export of gather/masked-fill head fails in spike | Fallback: encoder-only ONNX + TS reimplementation of the 2-layer head (small, auditable) | Spike only |
| Model footprint on Netlify persistent server (843MB FP16 / 420MB INT8) | Spike measures RSS on target host; INT8 quantization path; keep Jev hosted as default provider; `DECISION_PROVIDER=none` default | Quantization if FP16 fits |
| Tokenizer ID drift between Python/JS | Same `tokenizer.json` via WASM + 100-string parity test (P2 gate) | — |
| Upstream `temperature_by_options` over-confident buckets | `clamp_temperature` ported verbatim (TEMP_MIN/MAX) + load-time warning parity | — |
| License | Apache-2.0 — port is fine; keep attribution + version/SHA pin in `version.ts` | — |
| Plan-limit pressure (P6003) | No new Prisma models; admin ping reuses existing decision route surface | Model registry later |
| Python toolchain needed at build time only | Export script runs in dev/CI (one-off), NOT at runtime; artifact is ONNX + config committed/downloaded per policy | Runtime Python sidecar explicitly out (Netlify) |

---

## 9. Recommended next action

Produce `scripts/laya-spike/VERDICT.md` steps from P0 (export one checkpoint → run onnxruntime-node → measure). Until the verdict lands, `layaProvider` stays the existing mock. This plan is documentation-only; any code requires the spec/plan gates + explicit permission (SDK installs, model downloads, ONNX export toolchain).