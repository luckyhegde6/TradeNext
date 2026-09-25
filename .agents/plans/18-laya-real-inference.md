# Implementation Plan — 18: Laya Real Inference (P1–P3 + Real Provider Path)

> Generated from spec: `.agents/specs/18-laya-real-inference.md`
> Branch: `feature/ph22-decision-engine` · Created: 2026-09-25 · Version: **v3.41.3**
> Deps granted (onnxruntime + tokenizers, skip Python). Parity gate: self-consistency (user decisions D1–D3).

---

## Implementation Steps

> Each step atomic — independently verifiable. `[N] step → verify: [check]`

### Phase 1: Dependencies + weights home

1. **Install `onnxruntime-node@1.30.0` + `@huggingface/tokenizers` (root, granted)** → verify: `npm install onnxruntime-node@1.30.0 @huggingface/tokenizers && npm ls onnxruntime-node @huggingface/tokenizers`
2. **Add `.gitignore` entry `lib/services/laya/weights/`** → verify: `git check-ignore lib/services/laya/weights/v1/encoder_q8.onnx` (after copy)
3. **Create `lib/services/laya/weights/v1/`** (runtime home; never staged) → copy `scripts/spike-laya/weights/v1/*` (encoder_q8.onnx + .onnx.data, head_q8.onnx + .onnx.data, v1_tokenizer.json, v1_tokenizer_config.json) → verify: `dir /b lib\services\laya\weights\v1` shows 6 artifacts + `git status` clean of weights
4. **Write `scripts/fetch-laya-weights.mjs`** (generalized spike downloader → `lib/services/laya/weights/`, subdir-preserving, skip-if-exists) → verify: dry-run/size report without re-download (files exist → skipped)

### Phase 2: P1 — pure-TS ports (`lib/services/laya/`)

5. **`version.ts` + `qtypes.ts` + `serialize.ts`** (pins, QTYPES/guards, serializeState/renderCriterion/renderOptions) → verify: `npx tsc --noEmit` (0 new)
6. **`calibration.ts`** (confidenceFromProbs/tempBucket/clampTemperature/eceScore + TEMP_MIN/MAX tables) → verify: tsc clean
7. **`collate.ts` + `presets.ts` + `email.ts`** → verify: tsc clean
8. **`buildSequence.ts`** (TokenizerLike interface + §5.1 exact algorithm + guards) → verify: tsc clean
9. **`lang.ts` + `router.ts`** (unicode tables, stopwords, precedence, LRU semantics) → verify: tsc clean
10. **`index.ts` barrel** → verify: tsc clean
11. **Tests: `layaPorts.test.ts` + `layaBuildSequence.test.ts` + `layaLangRouter.test.ts`** (algebraic/hand-computed expectations) → verify: `npm run test` (ALONE) — new suites pass, whole suite green

### Phase 3: P2 — tokenizer

12. **`tokenizer.ts`** (`@huggingface/tokenizers` WASM wrapper; singleton lazy init; TokenizerLike impl reading `v1_tokenizer.json`) → verify: tsc clean
13. **Test `layaTokenizer.test.ts`** (skipIf no weights; special-ID reads, determinism, round-trip) → verify: `npm run test` green (skips on CI)

### Phase 4: P3 — backbone

14. **`decisionModel.ts`** (two InferenceSessions encoder+head; chained forward; int64/bool casts; K≥2 pad; act_logits guarded; health/latency; singleton; dynamic `import("onnxruntime-node")`) → verify: tsc clean
15. **Test `layaDecisionModel.test.ts`** (skipIf no weights; determinism, IO dims, bool marker_mask, qtype=0 → act_logits null, latency smoke) → verify: `npm run test` green

### Phase 5: minimal agent + real provider wiring

16. **`agent.ts`** (systemOne decode: _toInternal → buildSequence → collate → forward → temperature application → max-sub softmax → choice/score/noul shaping + confidence 4dp + usage) → verify: tsc clean
17. **Test `layaAgent.test.ts`** (skipIf no weights; decode contract shapes, temperature clamp effects, confidence rounding, usage) → verify: `npm run test` green
18. **Modify `lib/services/decision/layaProvider.ts`** — add `LayaRealProvider` (provider `"laya"`, lazy singleton engine, honest latency, health detail w/ source pin; throws loudly) — **mock class untouched** → verify: tsc clean
19. **Modify `lib/services/decision/client.ts`** — `DECISION_LAYA_REAL` whitelist gate in `buildProviders` (real vs mock); unknown → warn + mock; `DecisionProviderMode` unchanged → verify: tsc clean
20. **Modify `lib/__tests__/decisionClient.test.ts`** — flag-off regression (mock default), flag-on (real listed), flag-garbage (mock + warn) → verify: `npm run test` green
21. **Live check**: dev server up → `GET /api/admin/decision/ping` with `DECISION_PROVIDER=laya` only → `["laya-mock"]`; with `DECISION_LAYA_REAL=1` → `["laya"]` + health detail → verify: both responses correct; no console errors

### Phase 6: Verification sweep

22. **`npx tsc --noEmit`** → verify: 46 exact (0 new; new lib files + tests clean)
23. **`npm run lint`** → verify: 0 errors
24. **`npm run test`** (ALONE) → verify: all suites green (weights-gated suites run locally, skip on CI)
25. **`npm run quickbuild`** → verify: 0 new Turbopack warnings
26. **Doc budget** `node scripts/dev-checks/check-doc-sizes.mjs` → verify: within limit
27. **Extraction plan status note** (`docs/designDoc/ph22-laya-js-extraction-plan.md` P1–P3 → implemented v3.41.3) → verify: diff reviewed

### Phase 7: Docs pass (mandatory)

28. **AGENTS.md** version row v3.41.3 + `.agents/CHANGELOG.md` index + `.agents/changelog/versions-v3.41.md` §v3.41.3 → verify: rows consistent
29. **TODO.md + Primer.md + agent-memory.md + Lessons.md** (Lesson 139 if new pattern — candidate: lazy native-module dynamic-import rule for build graph cleanliness) → verify: entries present
30. **`.agents/session-todos.md` + `HANDOFF.md` + `.agents/handoffs/active/latest.md`** → verify: v3.41.3 state reflected
31. **Session archive update** (`2026-09-25-laya-real-inference/{flow,decisions}.md` — append Phase 2–7 flow) → verify: files current
32. **Pre-commit gate** (tsc/lint/test-alone/quickbuild/hygiene/secrets/doc-budget) → verify: all green
33. **Commit as `v3.41.3: ...`** (user-approved step; no push/PR yet)

### Phase 8: Wiki + push/PR (per user sequence — AFTER code + docs approval)

34. **Wiki update** (wiki-creator/docs-workflow skill): decision-engine pages + ph22 Laya real-inference page reflecting P1–P3 shipped + parity-gate flag + weights ops → verify: pages published + render (GitHub-renderer-safe mermaid)
35. **Push + open PR** — carries v3.41.0 `ab6fd65` + v3.41.1 `a269057` + v3.41.2 `5b088e3` + v3.41.3; `gh pr create` with summary → verify: PR URL + CI green (quality-gate/playwright)

---

## Test Strategy

### Unit Tests (Required)

| Test | File | What It Verifies |
|------|------|------------------|
| Qtypes/serialize/calibration/collate/presets/email algebra | `layaPorts.test.ts` | P1 pure ports, hand-computed expectations |
| buildSequence §5.1 layout + guards | `layaBuildSequence.test.ts` | markers/48-cap/floor/truncation/max_len/throw |
| lang + router precedence | `layaLangRouter.test.ts` | en/fr/devanagari detection, precedence chain, typed-decisions guard |
| tokenizer (skipIf no weights) | `layaTokenizer.test.ts` | special IDs, determinism, round-trip |
| backbone (skipIf no weights) | `layaDecisionModel.test.ts` | determinism, IO contract, K≥2, act_logits conditional, latency |
| agent decode (skipIf no weights) | `layaAgent.test.ts` | choice/score/noul shapes, temp clamp, confidence 4dp, usage |
| client wiring (modified) | `decisionClient.test.ts` | mock default regression, real flag, garbage flag |
| engine regression (spec 16/17) | `decision*.test.ts` | unchanged green |

### Integration: live ping check (`/api/admin/decision/ping`) — mock vs real provider id.

### E2E: N/A (no UI; ping covered by existing route tests).

---

## Verification Checklist

```bash
npx tsc --noEmit              # 46 exact (0 new)
npm run test                  # ALONE — all green (weights suites skip without weights)
npm run lint                  # 0 errors
npm run quickbuild            # 0 new warnings
node scripts/dev-checks/check-doc-sizes.mjs   # within budget
# live (dev server): curl /api/admin/decision/ping with flag off/on
```

---

## Risks & Tradeoffs

| Risk | Mitigation | Deferred |
|------|------------|----------|
| 503 MB weights + ~600 MB RSS on Netlify persistent server | Singleton lazy load; `DECISION_PROVIDER=none` production default; async batch use only; documented in health detail | Quantization/registry later |
| `@huggingface/tokenizers` WASM node-API drift vs Python | Not claimed (self-consistency gate); same serialized `tokenizer.json` + same upstream lib | Python 100-string parity (future P2-gate if operator wants) |
| int8 drift vs FP32 reference | Documented honestly — no 1e-4 FP32 claim; determinism+contract gate | FP32 reference (needs torch/onnxruntime-python) |
| Native module in Netlify build | onnxruntime-node prebuilds for linux-x64; quickbuild verified; lazy import keeps SSG clean | — |
| Degenerate questions (K<2) | Pad to 2 (upstream topk semantics) | — |
| Tokenizer/backbone suite skipped on CI (no weights) | Mirrors existing 4-skip precedent; full suite runs locally with weights | Weights in CI (artifacts) later |

---

## Documentation Checklist

- [x] **Spec/plan** — `.agents/specs/18-laya-real-inference.md` + `.agents/plans/18-laya-real-inference.md`
- [ ] **Session memory** — `decisions.md` (D1–D6 done) + `flow.md` (Phase 2–7 pending)
- [ ] **AGENTS.md** version row v3.41.3 · **CHANGELOG** index + `versions-v3.41.md` §v3.41.3
- [ ] **TODO.md** quick-ref row · **Primer.md** status · **agent-memory.md** entry · **Lessons.md** (139 if needed)
- [ ] **session-todos.md** current · **HANDOFF.md** · **handoffs/active/latest.md**
- [ ] **Wiki** — decision-engine + ph22 pages (Phase 8)
- [ ] **Extraction plan** status note P1–P3

---

## Pre-Commit Gate

1. `npx tsc --noEmit` — 0 new (46 exact)
2. `npm run test` — ALONE, all pass
3. `npm run lint` — 0 errors
4. `git status` — no junk, no staged weights, no secrets
5. Documentation per checklist above
6. Engineering checklist (`.agents/rules/checklist.md`) validated
7. User approval for commit + push/PR per sequence