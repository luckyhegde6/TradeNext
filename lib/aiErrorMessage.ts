// lib/aiErrorMessage.ts
//
// Single source of truth for turning an unknown thrown value into a
// user-facing error string. Pure + zero-dependency so it can be unit-tested
// without mounting any UI.
//
// Handles the shapes we actually produce / receive:
//   - string                               → itself
//   - Error                                → .message
//   - { error: string }                    → .error          (/api/ai/query 400s)
//   - { error: { message: string } }       → .error.message  (/api/ai/query 500 body shape)
//   - { message: string }                  → .message
//   - anything else (null, undefined, …)   → fallback

export function extractErrorMessage(err: unknown, fallback = "AI analysis failed"): string {
  if (typeof err === "string") return err || fallback;
  if (err instanceof Error) return err.message || fallback;
  if (err !== null && typeof err === "object") {
    const e = err as { error?: unknown; message?: unknown };
    if (typeof e.error === "string" && e.error) return e.error;
    if (e.error !== null && typeof e.error === "object") {
      const nested = e.error as { message?: unknown };
      if (typeof nested.message === "string" && nested.message) return nested.message;
    }
    if (typeof e.message === "string" && e.message) return e.message;
  }
  return fallback;
}