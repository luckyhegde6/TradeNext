/**
 * AI model catalog tests — builtin (non-removable) vs editable catalog
 * separation, plus the sync-guard that keeps `BUILTIN_MODEL_IDS` matching
 * the AI fallback chain (`AI_FALLBACK_MODELS` in `lib/services/ai/modelChain.ts`).
 */
import {
  BUILTIN_MODELS,
  BUILTIN_MODEL_IDS,
  AVAILABLE_MODELS,
  isValidModel,
} from "@/lib/services/ai/config";
import { AI_FALLBACK_MODELS } from "@/lib/services/ai/modelChain";

describe("AI model catalog — builtins vs editable catalog", () => {
  it("sync-guard: BUILTIN_MODEL_IDS matches the AI fallback chain", () => {
    expect([...BUILTIN_MODEL_IDS].sort()).toEqual([...AI_FALLBACK_MODELS].sort());
  });

  it("defines exactly the two non-removable built-ins with full metadata", () => {
    expect(BUILTIN_MODELS).toHaveLength(2);
    expect(BUILTIN_MODEL_IDS).toEqual(["openrouter/free", "openrouter/auto"]);
    for (const m of BUILTIN_MODELS) {
      expect(m.id).toBeTruthy();
      expect(m.name).toBeTruthy();
      expect(m.description).toBeTruthy();
      expect(m.contextLength).toBe(200_000);
      expect(m.billingPeriod).toBe("auto");
    }
  });

  it("the editable catalog does not contain either built-in", () => {
    const catalogIds = AVAILABLE_MODELS.map((m) => m.id);
    expect(catalogIds).not.toContain("openrouter/free");
    expect(catalogIds).not.toContain("openrouter/auto");
    // Keep the reviewed free-model catalog at its current size (8 entries)
    expect(AVAILABLE_MODELS).toHaveLength(8);
  });

  it("isValidModel accepts builtins and catalog ids, rejects everything else", () => {
    expect(isValidModel("openrouter/free")).toBe(true);
    expect(isValidModel("openrouter/auto")).toBe(true);
    expect(isValidModel(AVAILABLE_MODELS[0].id)).toBe(true);
    expect(isValidModel("org/not-a-real-model")).toBe(false);
    expect(isValidModel("openrouter/does-not-exist")).toBe(false);
    expect(isValidModel("")).toBe(false);
  });
});