/**
 * Minimal tokenizer contract for Laya prompt building (spec 18).
 *
 * Phase 2: type-only contract consumed by buildSequence.ts (imported with
 * `import type` — no runtime cycle).
 * Phase 3: `@huggingface/tokenizers`-backed loader + lazy singleton loading the
 * SAME serialized `tokenizer.json` + `tokenizer_config.json` the Python path
 * loads (via `AutoTokenizer`), so `build_sequence` produces identical ids.
 *
 * The WASM lib is imported DYNAMICALLY inside the lazy init — there is no
 * static import, so the laya barrel stays dependency-free for P1 consumers and
 * the build graph (SSG/Next) never pulls the native module just by importing
 * the barrel.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
// Type-only — erased at compile time, no runtime import.
import type { Tokenizer } from "@huggingface/tokenizers";

export interface TokenizerLike {
  maskToken: string;
  maskTokenId: number;
  clsTokenId: number;
  sepTokenId: number;
  padTokenId: number;
  /** tokens for `text` with add_special_tokens=false (Python `tok(text)["input_ids"]`). */
  encode(text: string): number[];
}

/** Weights home (decision D4): `DECISION_LAYA_MODEL_DIR` override, else the pinned v1 dir. */
export function layaWeightsDir(): string {
  return process.env.DECISION_LAYA_MODEL_DIR || join(process.cwd(), "lib", "services", "laya", "weights", "v1");
}

/** True when the serialized tokenizer artifacts exist (test skip-gate; CI has none). */
export function tokenizerAvailable(): boolean {
  const dir = layaWeightsDir();
  return existsSync(join(dir, "tokenizer.json")) && existsSync(join(dir, "tokenizer_config.json"));
}

/**
 * WASM-backed `TokenizerLike` — special ids come from `token_to_id`, exactly
 * the ids the Python `AutoTokenizer` uses for the same serialized file.
 */
export class LayaTokenizer implements TokenizerLike {
  readonly clsTokenId: number;
  readonly sepTokenId: number;
  readonly maskTokenId: number;
  readonly padTokenId: number;
  readonly maskToken: string;

  private constructor(
    private readonly wasm: Tokenizer,
    specials: SpecialTokens,
  ) {
    this.clsTokenId = specials.clsTokenId;
    this.sepTokenId = specials.sepTokenId;
    this.maskTokenId = specials.maskTokenId;
    this.padTokenId = specials.padTokenId;
    this.maskToken = specials.maskToken;
  }

  /** Load a tokenizer from a weights dir containing tokenizer.json + tokenizer_config.json. */
  static async load(dir: string): Promise<LayaTokenizer> {
    const { Tokenizer: WasmTokenizer } = await import("@huggingface/tokenizers");
    const json: object = JSON.parse(readFileSync(join(dir, "tokenizer.json"), "utf8"));
    const config = JSON.parse(readFileSync(join(dir, "tokenizer_config.json"), "utf8")) as Record<string, unknown>;
    const wasm = new WasmTokenizer(json, config);
    // Python reads these attributes off the AutoTokenizer (from tokenizer_config.json).
    return new LayaTokenizer(wasm, {
      maskToken: resolveToken(wasm, "mask_token", config["mask_token"], "[MASK]"),
      clsTokenId: resolveId(wasm, "cls_token", config["cls_token"]),
      sepTokenId: resolveId(wasm, "sep_token", config["sep_token"]),
      padTokenId: resolveId(wasm, "pad_token", config["pad_token"]),
      maskTokenId: resolveId(wasm, "mask_token", config["mask_token"]),
    });
  }

  /** `tok(text, add_special_tokens=False)["input_ids"]` — build_sequence parity. */
  encode(text: string): number[] {
    return this.wasm.encode(text, { add_special_tokens: false }).ids;
  }

  /** Inverse of `encode` (round-trip tests; not part of the TokenizerLike contract). */
  decode(ids: number[]): string {
    return this.wasm.decode(ids, { skip_special_tokens: false });
  }
}

interface SpecialTokens {
  maskToken: string;
  clsTokenId: number;
  sepTokenId: number;
  padTokenId: number;
  maskTokenId: number;
}

function resolveToken(wasm: Tokenizer, name: string, value: unknown, fallback: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  const id = wasm.token_to_id(fallback);
  if (id === undefined) throw new Error(`laya tokenizer: '${name}' missing from tokenizer_config.json`);
  return fallback;
}

function resolveId(wasm: Tokenizer, name: string, value: unknown): number {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`laya tokenizer: tokenizer_config.json missing '${name}'`);
  }
  const id = wasm.token_to_id(value);
  if (id === undefined) {
    throw new Error(`laya tokenizer: '${value}' (${name}) not found in tokenizer.json vocabulary`);
  }
  return id;
}

let singleton: Promise<LayaTokenizer> | null = null;

/** Lazy singleton (D4): resolves once; a failed load clears itself for retry. */
export function getLayaTokenizer(dir: string = layaWeightsDir()): Promise<LayaTokenizer> {
  if (!singleton) {
    singleton = LayaTokenizer.load(dir).catch((err) => {
      singleton = null;
      throw err;
    });
  }
  return singleton;
}