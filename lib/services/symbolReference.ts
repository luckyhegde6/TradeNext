// lib/services/symbolReference.ts
//
// Thin wiring layer over the committed NSE scrip-list constant
// (lib/services/nseScripList.ts — generated from the NSE "Securities
// available for trading (Equity)" CSV). Keeps symbol autocomplete/search
// consumers thin and pure — no Prisma/auth deps here, so mergeSymbolSuggestions
// is directly unit-testable.

import type { NseScrip } from "@/lib/services/nseScripList";

/** One autocomplete row — shape shared by constant matches and DB rows. */
export interface SymbolSuggestion {
  symbol: string;
  companyName: string;
}

/**
 * Merge constant-scrip matches (SYMBOL-prefix priority over the full 2,570
 * scrip list) with DB rows, deduped by symbol — constant first, DB as
 * supplement — capped at `limit`.
 */
export function mergeSymbolSuggestions(
  constantMatches: NseScrip[],
  dbMatches: { symbol: string; companyName?: string | null }[],
  limit = 15,
): SymbolSuggestion[] {
  const seen = new Set<string>();
  const out: SymbolSuggestion[] = [];
  for (const c of constantMatches) {
    const s = c.symbol.toUpperCase();
    if (seen.has(s)) continue;
    seen.add(s);
    out.push({ symbol: s, companyName: c.companyName });
  }
  for (const d of dbMatches) {
    const s = d.symbol.toUpperCase().trim();
    if (seen.has(s)) continue;
    seen.add(s);
    out.push({ symbol: s, companyName: d.companyName ?? "" });
  }
  return out.slice(0, limit);
}