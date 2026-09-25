/**
 * Laya prompt-sequence builder (spec 18, P1 port of `laya/common.py`
 * `build_sequence`).
 *
 * Format: [CLS] <type> instructions [SEP] [MASK] opt0 [MASK] opt1 ... [SEP]
 * state [SEP], truncated to max_len; markers are the token positions of each
 * option mask.
 */

import type { TokenizerLike } from "./tokenizer";
import { renderOptions, serializeState, type InternalQuestion } from "./serialize";

export interface SequenceResult {
  ids: number[];
  markers: number[];
}

/**
 * `build_sequence(tok, state, q, max_len, head_max_len, option_order,
 * truncate_left)` — faithful port including the option-head budget trimming
 * (per-option cap 48, floor 16 head budget, `max(4, (head_max_len-16)/n)`
 * fallback) and the left/right state truncation rules.
 */
export function buildSequence(
  tok: TokenizerLike,
  state: string | Record<string, unknown> | unknown[],
  q: InternalQuestion,
  maxLen = 512,
  headMaxLen = 192,
  optionOrder?: number[],
  truncateLeft = false,
): SequenceResult {
  const maskTok = tok.maskToken;
  const opts = renderOptions(q);
  const order = optionOrder ?? opts.map((_, i) => i);
  const ins = String(q.ins).replaceAll(maskTok, " ");

  const headIds = tok.encode(`${q.t} question: ${ins}`);
  const optIds: number[][] = [];
  for (const i of order) {
    optIds.push([tok.maskTokenId, ...tok.encode(` ${opts[i].replaceAll(maskTok, " ")}`).slice(0, 48)]);
  }
  let optBudget = headMaxLen - optIds.reduce((s, o) => s + o.length, 0);
  if (optBudget < 16) {
    const per = Math.max(4, Math.floor((headMaxLen - 16) / Math.max(1, optIds.length)));
    for (let i = 0; i < optIds.length; i++) optIds[i] = optIds[i].slice(0, per);
    optBudget = headMaxLen - optIds.reduce((s, o) => s + o.length, 0);
  }
  const head = headIds.slice(0, Math.max(8, optBudget));

  const ids = [tok.clsTokenId, ...head, tok.sepTokenId];
  const markers: number[] = [];
  for (const o of optIds) {
    markers.push(ids.length);
    ids.push(...o);
  }
  ids.push(tok.sepTokenId);

  const room = Math.max(0, maxLen - ids.length - 1);
  let st = tok.encode(serializeState(state).replaceAll(maskTok, " "));
  // Python `st[-room:]` with room == 0 is `st[0:]` (the whole list) — JS
  // `slice(-0)` behaves identically, so both branches stay faithful.
  st = truncateLeft ? st.slice(-room) : st.slice(0, room);
  ids.push(...st, tok.sepTokenId);

  const truncated = ids.slice(0, maxLen);
  return { ids: truncated, markers: markers.filter((m) => m < maxLen) };
}