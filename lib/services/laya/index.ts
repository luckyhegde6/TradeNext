/**
 * Laya inference library — TradeNext's JavaScript port of the Laya Python
 * codebase (`github.com/NandhaKishorM/laya` @ `c7527708`), spec 18.
 *
 * P1 (this package) covers the pure-Python modules with ZERO runtime deps:
 * qtypes, serialize (pythonDumps/serializeState/render*), calibration,
 * version, collate, presets, email cleaning, buildSequence, lang detection and
 * checkpoint routing. P2/P3 add the FFI surface (tokenizers, ONNX Runtime
 * sessions) surfaced through `lib/services/decision/` as `LayaRealProvider`.
 *
 * NOT ported (documented, see spec 18 §scope): the `Agent`/`RLAgent` class
 * wrappers and `load()`; `Agent.system_one` internals (P2/P3 re-implement the
 * ONNX call graph); `proper_reward`/`td_lambda_targets` (training only);
 * `shortlist`; and the `Router` class lifecycle (LRU model loading) — router.ts
 * ports only its pure decision logic.
 *
 * Every port keeps Python dict keys (`ins`, `is_english`, `non_latin_fraction`,
 * ...) and values byte-identical to the reference so parity tests can assert
 * against the Python outputs directly.
 */

export * from "./version";
export * from "./qtypes";
export * from "./serialize";
export * from "./calibration";
export * from "./collate";
export * from "./presets";
export * from "./email";
export * from "./buildSequence";
export * from "./lang";
export * from "./router";

// tokenizer.ts is exported separately (Phase 3 extends it with the
// @huggingface/tokenizers loader) so P1 consumers don't see a stub.
export type { TokenizerLike } from "./tokenizer";