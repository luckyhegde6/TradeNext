/**
 * Laya tokenizer tests (spec 18, plan step 13) — weights-gated per decision D5:
 * CI has no weights → suite skips; locally it runs against the SAME
 * `tokenizer.json` the Python `AutoTokenizer` path loads, so special ids and
 * `encode` behavior are asserted against the checkpoint, not a fixture.
 */

import {
  getLayaTokenizer,
  LayaTokenizer,
  tokenizerAvailable,
} from "../services/laya/tokenizer";

const maybeDescribe = tokenizerAvailable() ? describe : describe.skip;

maybeDescribe("laya tokenizer (weights)", () => {
  let tok: LayaTokenizer;

  beforeAll(async () => {
    tok = await getLayaTokenizer();
  }, 30000);

  it("reads the checkpoint special-token ids (v1 tokenizer.json pins)", () => {
    expect(tok.clsTokenId).toBe(50281);
    expect(tok.sepTokenId).toBe(50282);
    expect(tok.padTokenId).toBe(50283);
    expect(tok.maskTokenId).toBe(50284);
    expect(tok.maskToken).toBe("[MASK]");
    expect(new Set([tok.clsTokenId, tok.sepTokenId, tok.padTokenId, tok.maskTokenId]).size).toBe(4);
  });

  it("encode is deterministic across calls", () => {
    const a = tok.encode("high breakout question");
    const b = tok.encode("high breakout question");
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("encode adds no special tokens by default (add_special_tokens=false parity)", () => {
    const ids = tok.encode("payout policy decision");
    expect(ids).not.toContain(tok.clsTokenId);
    expect(ids).not.toContain(tok.sepTokenId);
    expect(ids).not.toContain(tok.padTokenId);
    expect(ids).not.toContain(tok.maskTokenId);
  });

  it("round-trips clean text through decode", () => {
    const text = "allocate to growth stocks";
    expect(tok.decode(tok.encode(text))).toBe(text);
  });

  it("singleton lazy init returns the same instance", async () => {
    expect(await getLayaTokenizer()).toBe(tok);
  });
});