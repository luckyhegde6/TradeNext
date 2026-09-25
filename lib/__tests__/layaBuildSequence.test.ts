/**
 * Laya build_sequence port tests — hand-computed token layouts with a
 * deterministic fake tokenizer (word-splitting, stable ids), asserting the
 * Python `laya/common.py` `build_sequence` behavior (spec 18; §5.1 of
 * `.agents/plans/18-laya-real-inference.md`).
 */

import { buildSequence, SequenceResult } from "../services/laya";
import type { TokenizerLike } from "../services/laya/tokenizer";

// word -> token id (deterministic; multi-word split on whitespace)
const TOKEN_IDS: Record<string, number> = {
  "choice:": 10,
  choice: 10, // buildSequence encodes `${q.t} question: ...`
  "question:": 20,
  ab: 30,
  cd: 40,
  "refund:": 50,
  xyz: 60,
  other: 70,
  "other:": 71,
  x: 72,
  y: 73,
  z: 74,
  w: 75,
  "masked:": 90,
  val: 91,
  st: 80,
  w1: 101,
  w2: 102,
  w3: 103,
  w4: 104,
  w5: 105,
};

const tok: TokenizerLike = {
  maskToken: "[MASK]",
  maskTokenId: 0,
  clsTokenId: 1,
  sepTokenId: 2,
  padTokenId: 3,
  encode: (text: string) => text.split(/\s+/).filter(Boolean).map((w) => TOKEN_IDS[w] ?? 999),
};

describe("laya buildSequence", () => {
  it("default layout: cls head sep | mask+opt0 | mask+opt1 sep | state sep", () => {
    const res: SequenceResult = buildSequence(
      tok,
      "st",
      { t: "choice", ins: "ab cd", crit: { refund: "xyz", other: null } },
    );
    expect(res.ids).toEqual([1, 10, 20, 30, 40, 2, 0, 50, 60, 0, 70, 2, 80, 2]);
    expect(res.markers).toEqual([6, 9]);
  });

  it("optionOrder reorders the option masks in place (markers follow)", () => {
    const res: SequenceResult = buildSequence(
      tok,
      "st",
      { t: "choice", ins: "ab cd", crit: { refund: "xyz", other: null } },
      512,
      192,
      [1, 0],
    );
    expect(res.ids).toEqual([1, 10, 20, 30, 40, 2, 0, 70, 0, 50, 60, 2, 80, 2]);
    expect(res.markers).toEqual([6, 8]);
  });

  it("maxLen truncation drops markers beyond the cut AND trims the state", () => {
    const res: SequenceResult = buildSequence(
      tok,
      "st",
      { t: "choice", ins: "ab cd", crit: { refund: "xyz", other: null } },
      9,
    );
    expect(res.ids).toHaveLength(9);
    expect(res.markers).toEqual([6]); // marker 9 cut by truncation
  });

  it("option-head budget trimming: per-option cap 48, floor 16 head budget", () => {
    // opts: "refund: xyz" (3 ids incl mask), "other: x y z w" (6 ids) = 9
    // head_max_len 16 → optBudget 7 < 16 → per = max(4, (16-16)/2) = 4
    const res: SequenceResult = buildSequence(
      tok,
      "st",
      { t: "choice", ins: "ab cd", crit: { refund: "xyz", other: "x y z w" } },
      512,
      16,
    );
    // option 1 truncated to [0, other:, x, y]
    expect(res.ids).toEqual([1, 10, 20, 30, 40, 2, 0, 50, 60, 0, 71, 72, 73, 2, 80, 2]);
    expect(res.markers).toEqual([6, 9]);
  });

  it("mask token in ins/option text is replaced with a space before encode", () => {
    const res: SequenceResult = buildSequence(
      tok,
      "st",
      { t: "choice", ins: "ab [MASK] cd", crit: { masked: "[MASK] val" } },
    );
    // ins "ab [MASK] cd" → "ab   cd" → [ab, cd]; crit "masked: [MASK] val" → "masked: val"
    expect(res.ids).not.toContain(999);
    expect(res.ids).toContain(90); // masked:
    expect(res.ids).toContain(91); // val
  });

  it("truncateLeft: right vs left state truncation", () => {
    const state = "w1 w2 w3 w4 w5";
    const right: SequenceResult = buildSequence(
      tok,
      state,
      { t: "choice", ins: "ab cd", crit: { refund: "xyz", other: null } },
      16,
    );
    // room = 16 - 12 - 1 = 3 → keep first 3 state tokens
    expect(right.ids).toEqual([1, 10, 20, 30, 40, 2, 0, 50, 60, 0, 70, 2, 101, 102, 103, 2]);

    const left: SequenceResult = buildSequence(
      tok,
      state,
      { t: "choice", ins: "ab cd", crit: { refund: "xyz", other: null } },
      16,
      192,
      undefined,
      true,
    );
    // st[-3:] → last 3 state tokens
    expect(left.ids).toEqual([1, 10, 20, 30, 40, 2, 0, 50, 60, 0, 70, 2, 103, 104, 105, 2]);
  });

  it("state dict is python-dumped before encode (space-joined keys:values)", () => {
    const res: SequenceResult = buildSequence(
      tok,
      { message: "st" },
      { t: "choice", ins: "ab cd", crit: { refund: "xyz", other: null } },
    );
    // serializeState({message:"st"}) = '{"message": "st"}' → encode = [999, 999]
    expect(res.ids).toContain(999);
  });
});