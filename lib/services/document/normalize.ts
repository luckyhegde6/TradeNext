// lib/services/document/normalize.ts — Raw-text document normalization for Stock Analysis
// Pure helper (server-only BY CONVENTION — only imported by server orchestrator & route;
// no `import "server-only"` because it isn't a declared dependency and would resolve to an
// unrelated parent node_modules + break the Jest loader). NO MarkItDown / no PDF conversion
// (deferred) — raw pasted .md/.txt only.

export const DOCUMENT_MAX_LEN = 50_000;
const TRUNCATE_SUFFIX = "\n…[truncated]";

/**
 * Normalize a user-supplied document string for insertion into the analysis prompt.
 * - Trims leading/trailing whitespace.
 * - Collapses runs of blank lines / horizontal whitespace.
 * - Truncates to `maxLen` with an explicit "[truncated]" marker so the model knows it is partial.
 * - Returns "" for empty / non-string input (treats it as "not provided").
 * Never throws.
 */
export function normalizeDocumentText(content: unknown, maxLen = DOCUMENT_MAX_LEN): string {
  if (typeof content !== "string") return "";
  let text = content.trim();
  if (text.length === 0) return "";

  // Collapse 3+ consecutive newlines to a single blank line, and trailing spaces on lines.
  text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");

  if (text.length > maxLen) {
    text = text.slice(0, maxLen) + TRUNCATE_SUFFIX;
  }
  return text;
}
