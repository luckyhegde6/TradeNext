# Spec Document — 18: Laya Real Inference (P1–P3 + Real Provider Path)

> Follows `.agents/templates/spec-template.md`. N/A sections (Routes, DB Schema, UI/UX) marked with justification. User-approved scope: P1–P3 + minimal agent decode + real provider behind an env-gated parity gate; `laya-mock` stays default. Dependencies (onnxruntime + tokenizers) granted; no Python reference (self-consistency parity). Source: `.agents/specs/16-decision-engine.md`, `.agents/plans/16-decision-engine.md`, `docs/designDoc/ph22-laya-js-extraction-plan.md` (P1–P3 + §5 port detail + §7 gates), `scripts/spike-laya/VERDICT.md` (split-graph IO contract).

## 1. Overview

**What**: Replace the mock-only Laya provider with a **real, local inference path** for the ph22 decision engine: port the deterministic Laya algorithm surface to TypeScript (`lib/services/laya/`), load the real int8 ONNX backbone (split encoder + head graphs, already downloaded in the P0 spike), implement a minimal `system_one` decode agent, and expose a real provider (`LayaRealProvider`, `provider = "laya"`) that is selected **only when the parity-gate flag `DECISION_LAYA_REAL=1`** is set. `DECISION_PROVIDER=laya` with no flag keeps the existing deterministic `LayaMockProvider` (`"laya-mock"`) — byte-identical default behavior.

**Why**: The decision engine (v3.41.0–v3.41.2) is mock-only by design until the P1–P3 parity work lands. The P0 spike (v3.40.8) verified runtime feasibility (onnxruntime-node in-process, split graphs, chain ~2.3 s/decision, RSS ~600 MB, singleton). This spec converts that verdict into real inference — DETERMINISTIC, local, calibrated, free of hosted dependencies — while keeping every existing consumer (POC A screener, POC B swing, gate/fusion, monitoring) unchanged until the operator opts in.

**Scope**:
- IN: `lib/services/laya/` port modules (P1: qtypes, serialize, buildSequence, calibration, collate, lang, router, presets, email, version, index); `tokenizer.ts` over `@huggingface/tokenizers` WASM + real `tokenizer.json` (P2); `decisionModel.ts` chaining the two int8 ONNX sessions (P3); minimal `agent.ts` `system_one` decode; `LayaRealProvider` + client gate flag; weights home + downloader script; tests; deps.
- OUT: Python toolchain/fixtures (user chose self-consistency gate); FP32/FP16 reference parity (int8 drift documented, not claimed); `shortlist.py` k-reduction (embedding seam deferred — router/presets ported, shortlist wiring is P5); full `Router` LRU multi-checkpoint runtime (registry + precedence ported; single model `v1` active); `act_logits`/`action` fields in the answer contract (surfaced via trace metadata only); P6 docs/e2e UI (admin ping surfaces provider strings automatically; no new UI).

**Depends on**: v3.41.0 engine core (types/provider/gate/client/fusion), v3.41.1 monitoring, v3.41.2 (committed), P0 spike verdict + weights in `scripts/spike-laya/weights/v1/`.

---

## 2. Routes

### New Routes
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| — | — | — | **N/A — no new HTTP surface.** The real provider plugs into the existing `POST /api/decision/evaluate` + `GET /api/admin/decision/ping`; ping health detail + monitoring traces surface `laya` vs `laya-mock` + latency/source automatically. |

### Modified Routes
| Method | Path | Change |
|--------|------|--------|
| GET | `/api/admin/decision/ping` | No code change required (health detail string already includes provider id); if implementation shows provider-selection ambiguity the detail string is enriched only. |
| POST | `/api/decision/evaluate` | No code change required. |

---

## 3. Database Schema

**N/A — zero Prisma changes** (P6003 plan-limit discipline, extraction plan §8 "No new Prisma models"). No migration, no `prisma generate`. Models/registry deferred (extraction plan: "Model registry later").

---

## 4. Functions to Implement

### A. `lib/services/laya/` — deterministic ports (1:1 from extraction plan §5, no weights needed)

#### `qtypes.ts`
- `QTYPES = { choice: 0, score: 1, noul: 2 }`, `QTYPE_NAMES`, `isQtype(type)` guard. Type: `LayaQtype = 0 | 1 | 2`.

#### `serialize.ts`
- `serializeState(state): string` — deterministic JSON-encode of the decision state (stable key order); escapes `[MASK]` → space per `build_sequence` contract.
- `renderCriterion(i: number, c: string): string`, `renderOptions(q): string[]` — option/criterion rendering from `common.py`; `render_option` per plan §5.1 (index + text, e.g. `"i) text"` format from upstream — TBD from source during port).

#### `buildSequence.ts`
- `buildSequence(tok: TokenizerLike, state: unknown, q: LayaQuestion): { ids: number[]; markers: number[]; markerMask: boolean[] }` — exact §5.1 algorithm: `[CLS] <type> ins [SEP] [MASK] opt0 [MASK] opt1 … [SEP] state [SEP]`; 48-token per-option cap; `opt_budget < 16` → per-option truncation `per = max(4, (head_max_len−16)//n)`; `head_ids[:max(8, opt_budget)]`; markers = each option block start; state tailing `truncate_left`; final `ids[:max_len]`, markers `< max_len`. TokenizerLike interface (encode/no-special + special ids) so P1 tests run over a fake tokenizer.
- Guard: `markers.length === renderOptions(q).length` else throw `"options exceed head_max_len"` (validation parity §5.1).
- `MAX_LEN = 512`, `HEAD_MAX_LEN = 192`, `OPT_CAP = 48`, `OPT_BUDGET_FLOOR = 16` (from `rl_agent_config.json` in spike/weights).

#### `calibration.ts`
- `confidenceFromProbs(p: number[], k: number): number` — `1 − H(p)/log(k)` (extraction plan §5.3 & gate.ts already shapes the same formula — this is the Laya-native port).
- `tempBucket(qtype: number, k: number): number` (bucket index), `clampTemperature(t: number): number` (`TEMP_MIN = 0.5`, `TEMP_MAX = 5.0` per plan §2.3 "Clamped [0.5, 5.0] at load"), `eceScore(...)` (train-side metric — ported, used in tests only).
- `TEMPERATURE_BY_OPTIONS`, `TEMPERATURE` default tables read from config (v1 defaults embedded, overridable).

#### `collate.ts`
- `collateItems(items: { ids: number[] }[], padTokenId: number): { inputIds: bigint[]; attentionMask: bigint[]; lengths: number[] }` — padding to max len; int64-ready arrays for the ONNX encoder. Handles empty/ragged inputs.

#### `lang.ts`
- `detectScript(text): ScriptId` — 25 unicode-range tables + Latin/Latin-Extended special-case (§5.5).
- `latinProfile(text)`, `analyse(text): { script, language, isEnglish }` — stopword sets en/fr/de/es/pt/it/nl/ro, `_NON_EN_DIACRITICS`, margin rule `best ≥ max(2, en+2)` (+diacritics variant), evidence rule (≥1 non-shared word). Pure-data port; used by router precedence.

#### `router.ts`
- `ROUTER_CHECKPOINTS` (3-checkpoint registry: `v1` int8 english active; multilingual/typed-decisions registered-future), `routePrecedence(model?, task?, language?)` — explicit model > explicit task > workflow > explicit lang > analysed script/lang > default english; non-Latin ⇒ multilingual; Latin+en ⇒ english; Latin+other ⇒ multilingual; `typed-decisions` NEVER auto-selected (§5.4).
- LRU `max_loaded` eviction semantics ported as a pure function/map (runtime uses `v1` only).

#### `presets.ts`
- `triageQuestions`, `guardQuestions`, `moderationQuestions`, `emailQuestions`, `routerQuestions` builders (§5.6 note: static data from `presets.py`; question JSON shapes per `QTYPES`).

#### `email.ts`
- `cleanEmailBody(...)`, `emailState(...)` — small pure port (used when email questions are asked; minimal tests).

#### `version.ts`
- `LAYA_VERSION = "0.3.6"`, `SOURCE_SHA = "c7527708"`, `HF_REPO = "nvkudva/laya-web-q8"`, `ARTIFACT_VERSION = "v1"`, Apache-2.0 attribution comment.

#### `index.ts` — barrel (mirrors `__init__.py`).

### B. `tokenizer.ts` (P2)
- `createLayaTokenizer(modelDir: string): Promise<TokenizerLike>` — wraps `@huggingface/tokenizers` WASM `Tokenizer.fromFile(<modelDir>/v1_tokenizer.json)`; exposes `encode(text, addSpecialTokens)`, `maskTokenId`, `clsTokenId`, `sepTokenId` (read from tokenizer JSON at load).
- `TokenizerLike` interface (pure-P1-compatible): `encode(text: string): number[]` + `encodeNoSpecial(text: string): number[]` + `specialIds: { cls, sep, mask }` + `padTokenId`.
- Singleton + async lazy init (no top-level await; no WASM/root import on the client).

### C. `decisionModel.ts` (P3)
- `class LayaDecisionModel` — module singleton, lazy load. Creates TWO `onnxruntime-node` `InferenceSession`s (sequential mode) from `<modelDir>/v1/encoder_q8.onnx` + `head_q8.onnx` (external `.onnx.data` siblings — **must preserve v1/ subdir layout**, spike verdict #2).
- `forward(inputId: bigint[], attentionMask: bigint[], markers: number[]): Promise<{ logits: number[]; actLogits: number[] | null }>`:
  - Encoder run: `input_ids` int64 `[1,L]`, `attention_mask` int64 `[1,L]` → `hidden` f32 `[1,L,1024]`.
  - Head run: `hidden`, `attention_mask` int64, `marker_pos` int64 `[1,K]`, `marker_mask` **bool** `[1,K]`, `qtype` int64 `[1]` → `logits` f32 `[1,K]`; `act_logits` **guarded read** (absent on qtype=0).
  - Guards: `K ≥ 2` (pad to 2 per upstream topk-2 semantics); `L ≤ MAX_LEN`; int64/bool cast helpers (BigInt64Array/Uint8Array) mirroring `smoke.mjs` (i64/i64_1d/bool01/f32).
- `health(): { ok, detail, loadMs?, lastLatencyMs? }` + latency/RSS telemetry (informational; spike baseline: chain ~2.3 s @ seq 128, RSS ~600 MB — async batch use only).
- Errors: load/run failures throw with context (never swallow); no auto-fallback to mock.

### D. `agent.ts` (minimal decode — user scope: "real provider path")
- `systemOne(state: unknown, questions: DecisionQuestion[]): Promise<LayaAnswers>` — per-question: `_toInternal` (criteria list→dict, instructions json.dumps if not str), `buildSequence` → `collateItems` (batch 1) → `forward` → decode per §5.3:
  - `k = markers.length` (≥2 padded); `t = temperatureByOptions.get(tempBucket(qt,k)) ?? temperature[qt]`; `z = logits[:k]/t`; max-sub softmax.
  - choice → `{ type:"choice", choice: keys[argmax], probabilities, confidence: round(confidenceFromProbs,4), action: {actProbability} }`.
  - score → `{ type:"score", score: Σ i·pᵢ, legend: {str(i): c}, probabilities, confidence, action }`.
  - noul → `{ type:"noul", noul: p[1], confidence: max(p1, 1−p1), action }`.
  - `usage: { inputTokens: Σ attentionMask, outputTokens: 0 }`.
- Answer mapping to existing `types.ts` contract (choice/score/noul fields only; `action`/`legend` attached for trace metadata, NOT added to `DecisionAnswer`).

### E. `lib/services/decision/layaProvider.ts` (modified)
- Keep `LayaMockProvider` exactly as-is (default path, byte-identical).
- Add `LayaRealProvider implements DecisionProvider` — `provider = "laya"`; constructs lazy singleton `LayaAgent` (tokenizer + model) from `DECISION_LAYA_MODEL_DIR ?? lib/services/laya/weights/v1`; `evaluate()` maps `EvaluateRequest` → `systemOne` → `EvaluateResponse` with `model: "laya-rl-agent (v1 int8)"`, honest latency; `health()` reports `ok`, loaded status, load/latency, source pin. Throws loudly on missing weights/misconfig (client retry + failure trace).

### F. `lib/services/decision/client.ts` (modified)
- `buildProviders`: `DECISION_PROVIDER=laya` + `DECISION_LAYA_REAL` truthy (`"1"|"true"|"yes"`) → `[new LayaRealProvider()]`; else `[new LayaMockProvider()]` (unchanged). `DecisionProviderMode` unchanged (`"none"|"laya"`). Unknown `DECISION_LAYA_REAL` values → warn once + mock (conservative).

### G. Weights home + downloader
- New runtime weights dir `lib/services/laya/weights/v1/` (gitignored) — populated by copying existing `scripts/spike-laya/weights/v1/*` (already on disk) OR via new script.
- New `scripts/fetch-laya-weights.mjs`: generalized from `spike-laya/download.mjs` — HF tree probe `nvkudva/laya-web-q8` → `lib/services/laya/weights/`, subdir-layout-preserving, skip-if-exists, size-summary. Run: `node scripts/fetch-laya-weights.mjs`.

---

## 5. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `package.json` | Modified | Add `onnxruntime-node` (1.30.0) + `@huggingface/tokenizers` (pin at install). Deps granted. |
| `lib/services/laya/qtypes.ts` | **Created** | QTYPES + guard |
| `lib/services/laya/serialize.ts` | **Created** | serializeState / renderCriterion / renderOptions |
| `lib/services/laya/buildSequence.ts` | **Created** | build_sequence port + guards |
| `lib/services/laya/calibration.ts` | **Created** | confidenceFromProbs / tempBucket / clampTemperature / eceScore |
| `lib/services/laya/collate.ts` | **Created** | collateItems padding |
| `lib/services/laya/lang.ts` | **Created** | script/language detection tables + rules |
| `lib/services/laya/router.ts` | **Created** | checkpoint registry + precedence + LRU semantics |
| `lib/services/laya/presets.ts` | **Created** | question builders |
| `lib/services/laya/email.ts` | **Created** | email helpers |
| `lib/services/laya/version.ts` | **Created** | version/sha/attribution pins |
| `lib/services/laya/tokenizer.ts` | **Created** | @huggingface/tokenizers WASM wrapper |
| `lib/services/laya/decisionModel.ts` | **Created** | split-graph ONNX sessions + forward + guards |
| `lib/services/laya/agent.ts` | **Created** | systemOne decode |
| `lib/services/laya/index.ts` | **Created** | barrel |
| `lib/services/decision/client.ts` | Modified | DECISION_LAYA_REAL gate flag → real vs mock |
| `lib/services/decision/layaProvider.ts` | Modified | Add LayaRealProvider (mock untouched) |
| `.gitignore` | Modified | Add `lib/services/laya/weights/` |
| `scripts/fetch-laya-weights.mjs` | **Created** | weights downloader (prod home) |
| `lib/__tests__/layaPorts.test.ts` | **Created** | P1 pure ports (qtypes/serialize/calibration/collate/email/presets) — algebraic expectations |
| `lib/__tests__/layaBuildSequence.test.ts` | **Created** | P1 buildSequence over fake tokenizer — hand-computed sequences |
| `lib/__tests__/layaLangRouter.test.ts` | **Created** | P1 lang + router precedence |
| `lib/__tests__/layaTokenizer.test.ts` | **Created** | P2 tokenizer — skipIf no weights; special-ID reads from tokenizer.json, round-trip, determinism |
| `lib/__tests__/layaDecisionModel.test.ts` | **Created** | P3 — skipIf no weights; determinism, IO-contract, K≥2, act_logits conditional, latency smoke |
| `lib/__tests__/layaAgent.test.ts` | **Created** | decode — skipIf no weights; shaping, temperature clamp, confidence, usage |
| `lib/__tests__/decisionClient.test.ts` | Modified | real/mock selection tests (flag off → mock default, flag on → real provider listed) |
| `docs/designDoc/ph22-laya-js-extraction-plan.md` | Modified | Status note P1–P3 implemented (v3.41.3) |

---

## 6. Dependencies

### New Packages
| Package | Version | Reason |
|---------|---------|--------|
| `onnxruntime-node` | 1.30.0 | ONNX InferenceSession (encoder + head int8 graphs). Native module — root prod dep (spike-pinned). |
| `@huggingface/tokenizers` | pin at install | WASM tokenizer over the same `tokenizer.json` (P2). |

Granted by user 2026-09-25. Python NOT installed/used (user: skip Python).

### Internal Dependencies
| Module | Function Used | Purpose |
|--------|---------------|---------|
| `@/lib/logger` | `logger.info/warn/error` | Structured logging |
| `@/lib/services/decision/types` | `DecisionQuestion` etc. | Provider contract |
| `@/lib/services/decision/provider` | `DecisionProvider`, `ProviderHealth` | Interface |
| `@/lib/services/decision/monitoring` | `trackDecisionTrace` | Trace metadata (provider id + latency) — no new fields |

**N/A**: no Prisma, no audit tags (provider selection is not a state-changing op; traces + logs suffice), no API routes, no UI.

---

## 7. API Contract

**N/A — no new/changed public API.** Existing:
- `POST /api/decision/evaluate` — unchanged shape; `provider` becomes `"laya"` only when `DECISION_LAYA_REAL=1`, else `"laya-mock"`.
- `GET /api/admin/decision/ping` → `{ mode, providers: ["laya"|"laya-mock"|...], detail }` — automatic. Health detail for real: model loaded state + source pin + latency.

---

## 8. UI/UX Requirements

**N/A — no UI.** Admin AI Monitoring Decision Engine tab renders provider strings/traces already emitted by `/api/admin/decision/monitoring`; no component changes. (P6 of the extraction plan is a later phase if operator wants model health cards.)

---

## 9. Rules & Guardrails

- [x] No Prisma in client components (no Prisma at all) — P6003 discipline
- [x] All DB operations parameterized (N/A — zero DB ops)
- [x] Server-side proxy only for NSE (N/A)
- [x] All external inputs validated (env flags parsed with warn-on-unknown; model IO guards)
- [x] Errors return safe defaults, never expose internals (provider throws with context; client retries; traces)
- [x] Logging via `@/lib/logger` only (no `console.log`)
- [x] Background inference never blocks HTTP response (real inference is async batch / on-call; evaluate latency honest; no sync blocking of cron)
- [x] Cache invalidation on write (N/A — no writes; model singleton cached)
- [x] Audit trail for state-changing operations (N/A — read-only inference; traces logged)
- [x] **No staged weights** — `lib/services/laya/weights/` gitignored; downloader script committed, weights never. (Extraction-plan risk table + secrets/hygiene discipline.)
- [x] **Lazy dynamic imports** — `onnxruntime-node` + `@huggingface/tokenizers` imported via dynamic `import()` inside session factories only (nodejs runtime routes); never top-level in shared modules → `next build`/SSG graph stays clean (Node-only modules must not leak into client bundles).
- [x] **Singleton sessions** — one shared engine instance (spike verdict #5: never per-request sessions; ~600 MB RSS).
- [x] **K ≥ 2 / int64 / bool casts** — mirror spike smoke helpers; `act_logits` guarded read.
- [x] Provider throws — never silent mock fallback when real requested (misconfig is loud).

---

## 10. Expected Behavior

1. `DECISION_PROVIDER` unset or `none` → inert NOOP (unchanged).
2. `DECISION_PROVIDER=laya` (no `DECISION_LAYA_REAL`) → `LayaMockProvider`, provider id `"laya-mock"`, everything byte-identical to v3.41.2.
3. `DECISION_PROVIDER=laya` + `DECISION_LAYA_REAL=1` → `LayaRealProvider` (`"laya"`); evaluate runs tokenizer → buildSequence → collate → encoder → head → decode; answers match Laya decode contract; `usage.inputTokens>0`; latency >0 (chain seconds-scale).
4. `DECISION_LAYA_REAL=1` with missing weights dir → `health().ok=false` with detail; `evaluate()` throws (client retries ≤3 then error trace) — no silent mock.
5. `DECISION_LAYA_REAL=banana` → warn once + mock (conservative).
6. P1 ports: `buildSequence({choice,2 options}, fakeTok)` reproduces the §5.1 layout exactly; `confidenceFromProbs([0.5,0.5],2)=0`, `[1,0]→1`, `clampTemperature(0.2)=0.5`, `clampTemperature(7)=5.0`; lang margins per §5.5 hand-computed cases.
7. P2: tokenizer loads `v1_tokenizer.json`; special IDs read consistently; encode→decode round-trips; identical bytes → identical IDs (determinism).
8. P3: same input → bit-identical logits across calls; dims `[1,K]`/`[1,2]`; `marker_mask` bool; qtype=0 → `act_logits` null (guarded); K=1 padded to 2; K=2..N preserved.
9. Decision engine suite (spec 16/17 tests) stays green; `DECISION_PROVIDER=none` inert preserved.
10. `npx tsc --noEmit` — 0 new errors (baseline 46); `npm run lint` — 0 errors; `npm run test` — all pass (weights-gated suites skip cleanly without weights); `quickbuild` — 0 new Turbopack warnings; doc budget within 100 KB.

---

## 11. Error Handling

| Scenario | Behavior | Log Level |
|----------|----------|-----------|
| Weights dir missing (real requested) | health `ok:false` + detail; evaluate throws → client retry → failure trace | `error` |
| ONNX session create/run failure | Throw with context (file, stage); client retry ×3 → trace | `error` |
| Tokenizer load failure | Throw with context; same path | `error` |
| K < 2 degenerate question | Pad to 2 (upstream topk semantics) — no throw | `info` |
| seq > MAX_LEN(512) | Truncate at buildSequence (`ids[:max_len]`) — no throw | `info` |
| Unknown `DECISION_LAYA_REAL` | Warn once + use mock | `warn` |
| Mock path unchanged | No new failure modes | — |

---

## 12. Test Strategy

### Unit Tests — P1 ports (`lib/__tests__/layaPorts.test.ts`, `layaBuildSequence.test.ts`, `layaLangRouter.test.ts`)
- [x] qtypes guard / names
- [x] serializeState stable key order + [MASK] escape
- [x] confidenceFromProbs algebra (uniform→0, one-hot→1, midpoint known values)
- [x] tempBucket / clampTemperature (0.2→0.5, 7→5.0, bucket lookup)
- [x] collateItems padding edge (ragged, empty)
- [x] buildSequence exact §5.1 layout with fake tokenizer (markers at option starts, 48-cap, opt_budget floor 16, truncate_left, max_len cut) + `options exceed head_max_len` throw
- [x] lang analyse: en / fr / devanagari / latin-other + evidence margin
- [x] router precedence: explicit model > task > lang > default english; typed-decisions never auto
- [x] presets/email shape smoke

### Unit Tests — P2/P3/agent `(skipIf !weightsAvailable — mirrors existing IndexedDB skip precedent)`
- [x] tokenizer: special IDs from tokenizer.json; determinism; round-trip decode
- [x] decisionModel: determinism (bit-identical logits ×2 calls); IO dims; bool marker_mask; K≥2 pad; qtype=0 → act_logits null; latency smoke < 30 s
- [x] agent: decode shapes choice/score/noul; temperature application; confidence rounding 4dp; usage tokens

### Unit Tests — engine wiring (`decisionClient.test.ts` modified)
- [x] `laya` → providers `["laya-mock"]` (default, regression)
- [x] `laya` + `DECISION_LAYA_REAL=1` → providers `["laya"]`
- [x] `DECISION_LAYA_REAL=banana` → warn + `["laya-mock"]`
- [x] full suite (spec 16/17 decision test files) stays green

### E2E — N/A (no UI; admin ping path covered by existing decisionPingRoute tests + monitoring).

### Parity fixture note
Algebraic/hand-computed expectations only (user: skip Python). No Python-derived fixture JSON committed.

---

## 13. Performance Considerations

- **Singleton** — one `LayaDecisionModel` + one `LayaTokenizer` module instances; lazily constructed on first real use; RSS ~600 MB (spike), document in `layaProvider` health detail.
- **Async only** — real inference is seconds-scale (chain ~2.3 s @ seq 128); used by async daily-batch/on-call paths, never interactive request/response. `evaluate` latency reported honestly.
- **No worker** — spike verdict: no thread benefit (load is blob mapping).
- **Lazy dynamic imports** — ort/tokenizers pulled only inside nodejs-runtime factories → build-time bundle unaffected; quickbuild stable.
- **Cache/writes** — none (read-only inference); model registry deferred.
- Netlify persistent-server fit: ~600 MB RSS + native module — documented risk; `DECISION_PROVIDER=none` production default unchanged.

---

## 14. Security Considerations

- **Weights never committed**: `lib/services/laya/weights/` in `.gitignore`; downloader is the only acquisition path; `.onnx.data` sibling layout preserved.
- **No secrets**: no keys; HF download is public; U-A header only.
- **Node-only modules**: dynamic import only inside server-side factories; nothing reaches the client bundle (no `NEXT_PUBLIC_*`).
- **Env parsing**: `DECISION_LAYA_REAL` whitelist (`1|true|yes`), unknown → warn + mock; `DECISION_LAYA_MODEL_DIR` path validated (exists/readable) before sessions created.
- **No new network egress at runtime**: weights are local files; runtime inference makes zero external calls.

---

## 15. Definition of Done

- [ ] All P1–P3 + agent + provider functions implemented per §4
- [ ] All files created/modified per §5
- [ ] Existing contract preserved: `DECISION_PROVIDER=none|laya` semantics unchanged without the flag
- [ ] Deps installed (onnxruntime-node 1.30.0 + @huggingface/tokenizers) — granted
- [ ] Weights home populated + downloader script committed
- [ ] Unit tests written and passing (`npm run test` — run ALONE)
- [ ] `npx tsc --noEmit` — 0 new errors (baseline 46)
- [ ] `npm run lint` — 0 errors
- [ ] `npm run quickbuild` — 0 new warnings
- [ ] Doc budget within limit
- [ ] Decision engine suites (spec 16/17) green; `laya-mock` default byte-identical
- [ ] Documentation updated (AGENTS.md, CHANGELOG, TODO, Primer, agent-memory, Lessons, session-todos, handoff, session archive)
- [ ] Wiki updated (per user request — after code, before push)
- [ ] Push + open PR (carries v3.41.0 → v3.41.3) — per user request at end