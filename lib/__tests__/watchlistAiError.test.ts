import { extractErrorMessage } from "@/lib/aiErrorMessage";

describe("extractErrorMessage", () => {
  it("returns a thrown string as-is", () => {
    expect(extractErrorMessage("boom")).toBe("boom");
  });

  it("returns an Error instance message", () => {
    expect(extractErrorMessage(new Error("network down"))).toBe("network down");
  });

  it("prefers a string err.error over err.message", () => {
    expect(extractErrorMessage({ error: "rate limited", message: "fallback" })).toBe("rate limited");
  });

  it("extracts nested { error: { message } } — the real /api/ai/query 500 body shape", () => {
    expect(extractErrorMessage({ error: { message: "Internal server error" } })).toBe("Internal server error");
  });

  it("falls back when both error and message are missing", () => {
    expect(extractErrorMessage({ foo: 1 })).toBe("AI analysis failed");
  });

  it("handles null and undefined input", () => {
    expect(extractErrorMessage(null)).toBe("AI analysis failed");
    expect(extractErrorMessage(undefined)).toBe("AI analysis failed");
  });

  it("falls back on empty strings", () => {
    expect(extractErrorMessage("")).toBe("AI analysis failed");
    expect(extractErrorMessage({ error: "" })).toBe("AI analysis failed");
  });

  it("supports a custom fallback", () => {
    expect(extractErrorMessage(null, "Analysis unavailable")).toBe("Analysis unavailable");
  });
});