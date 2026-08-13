// lib/services/ipoIssueSize.ts
//
// PURE helpers for IPO Issue Size (lot size → shares per lot → ₹ per lot).
// Zero imports — client-safe. Importing this module must never pull
// prisma/pg/node builtins into a browser bundle.
//
// (nseIpoService.ts re-exports these for server-side callers + tests.)

/** Parse a number out of a string like "154 Equity Shares and in multiples thereof". */
export function parseSharesPerLot(text: string | undefined | null): number | null {
  if (!text) return null;
  const match = text.match(/\d[\d,]*/);
  if (!match) return null;
  const n = parseFloat(match[0].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Parse the LOWER end of an NSE price range into a Rupee number.
 * Handles "Rs. 92 to Rs. 97 per Equity Share", "Rs. 92 - 97", "92-97", "₹92".
 * Returns null when the low band cannot be found.
 */
export function parsePriceBandLow(priceRange: string | undefined | null): number | null {
  if (!priceRange) return null;
  const matches = priceRange.match(/(\d[\d,]*(?:\.\d+)?)/g);
  if (!matches || matches.length === 0) return null;
  const low = parseFloat(matches[0].replace(/,/g, ""));
  return Number.isFinite(low) && low > 0 ? low : null;
}

/** ₹ amount per lot at the lower end of the price band (sharesPerLot × low band). */
export function perLotInvestment(detail: {
  sharesPerLot: number | null;
  priceRange?: string | null;
}): number | null {
  const shares = detail.sharesPerLot;
  if (!shares) return null;
  const low = parsePriceBandLow(detail.priceRange);
  if (!low) return null;
  const total = shares * low;
  return Number.isFinite(total) ? total : null;
}

/** Minimal shape needed to format an Issue Size from a parsed detail. */
export type IssueSizeInput = {
  sharesPerLot?: number | null;
  priceRange?: string | null;
  issueSizeText?: string;
};

/**
 * Human "Issue Size" string for a parsed IPO detail — lot size + shares per
 * lot + ₹ per lot. e.g.
 * "154 shares per lot · ₹14,168 per lot"
 * Falls back to the raw share count when no detail is available.
 */
export function formatIssueSize(detail: IssueSizeInput | null | undefined): string {
  if (!detail) return "";
  const perLot = perLotInvestment({
    sharesPerLot: detail.sharesPerLot ?? null,
    priceRange: detail.priceRange,
  });
  const parts: string[] = [];
  if (detail.sharesPerLot) {
    parts.push(`${detail.sharesPerLot.toLocaleString("en-IN")} shares per lot`);
  }
  if (perLot) {
    parts.push(`₹${perLot.toLocaleString("en-IN")} per lot`);
  }
  if (parts.length === 0 && detail.issueSizeText) {
    return detail.issueSizeText;
  }
  return parts.join(" · ");
}
