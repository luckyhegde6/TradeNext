import {
  AI_FALLBACK_MODELS,
  modelFallbackChain,
} from "@/lib/services/ai/modelChain";

describe("modelChain (v3.10.1)", () => {
  test("AI_FALLBACK_MODELS matches the connection-test routes", () => {
    expect(AI_FALLBACK_MODELS).toEqual(["openrouter/free", "openrouter/auto"]);
  });

  test("places the primary model first, then the shared fallbacks", () => {
    const chain = modelFallbackChain("nvidia/primary");
    expect(chain).toEqual(["nvidia/primary", "openrouter/free", "openrouter/auto"]);
  });

  test("dedupes when the primary is already a fallback route", () => {
    const chain = modelFallbackChain("openrouter/free");
    expect(chain).toEqual(["openrouter/free", "openrouter/auto"]);
  });

  test("drops empty/undefined primary and returns only the fallbacks", () => {
    expect(modelFallbackChain(undefined)).toEqual(["openrouter/free", "openrouter/auto"]);
    expect(modelFallbackChain("")).toEqual(["openrouter/free", "openrouter/auto"]);
  });

  test("returns a fresh array (caller mutations never affect the source)", () => {
    const a = modelFallbackChain("primary");
    const b = modelFallbackChain("primary");
    expect(a).toEqual(b);
    a.push("extra");
    expect(b).toEqual(["primary", "openrouter/free", "openrouter/auto"]);
    expect(AI_FALLBACK_MODELS).toEqual(["openrouter/free", "openrouter/auto"]);
  });
});
