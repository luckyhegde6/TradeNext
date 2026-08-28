// lib/__tests__/document-normalize.test.ts — Tests for normalizeDocumentText
import { normalizeDocumentText, DOCUMENT_MAX_LEN } from "@/lib/services/document/normalize";

describe("normalizeDocumentText", () => {
  it("returns empty string for non-string input", () => {
    expect(normalizeDocumentText(null)).toBe("");
    expect(normalizeDocumentText(undefined)).toBe("");
    expect(normalizeDocumentText(12345)).toBe("");
    expect(normalizeDocumentText({ text: "x" })).toBe("");
  });

  it("returns empty string for blank/whitespace-only input", () => {
    expect(normalizeDocumentText("   ")).toBe("");
    expect(normalizeDocumentText("\n\t\n")).toBe("");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeDocumentText("  hello world  ")).toBe("hello world");
  });

  it("collapses trailing spaces on lines", () => {
    const input = "line one   \nline two";
    expect(normalizeDocumentText(input)).toBe("line one\nline two");
  });

  it("collapses 3+ consecutive newlines to a single blank line", () => {
    const input = "a\n\n\n\nb";
    expect(normalizeDocumentText(input)).toBe("a\n\nb");
  });

  it("leaves normal single blank lines intact", () => {
    const input = "a\n\nb";
    expect(normalizeDocumentText(input)).toBe("a\n\nb");
  });

  it("does not truncate text within the max length", () => {
    const text = "x".repeat(100);
    expect(normalizeDocumentText(text)).toBe(text);
  });

  it("truncates text beyond max length with an explicit marker", () => {
    const text = "y".repeat(DOCUMENT_MAX_LEN + 100);
    const out = normalizeDocumentText(text);
    // content capped at maxLen, plus the truncation marker suffix
    expect(out.length).toBeLessThanOrEqual(DOCUMENT_MAX_LEN + 20);
    expect(out.includes("\n…[truncated]")).toBe(true);
    expect(out.endsWith("[truncated]")).toBe(true);
  });

  it("honors a custom max length", () => {
    const text = "abcdefghij";
    const out = normalizeDocumentText(text, 5);
    expect(out.startsWith("abcde")).toBe(true);
    expect(out.endsWith("[truncated]")).toBe(true);
  });

  it("never throws on weird input", () => {
    expect(() => normalizeDocumentText("")).not.toThrow();
    expect(() => normalizeDocumentText(BigInt(5))).not.toThrow();
    expect(() => normalizeDocumentText([1, 2, 3])).not.toThrow();
  });
});
