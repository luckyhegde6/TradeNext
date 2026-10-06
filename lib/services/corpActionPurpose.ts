// ─── Corporate-action purpose parser (shared) ───────────────────────────────
//
// Extracted verbatim from `worker/worker-service.ts` so the degraded executor
// (`worker/degradedExecutor.ts`) can parse NSE `purpose` strings WITHOUT
// importing `worker-service` — which pulls in the Prisma client at module load.
// During a plan-limit hold the degraded path must not even construct that
// dependency, let alone call it (Lesson 155: a "safe" type that reaches Prisma
// is the failure mode this subsystem keeps hitting).
//
// Pure string parsing: no imports, no I/O, no clock.

/** Classify an NSE corporate-action `purpose` string and extract its amount. */
export function parseActionPurpose(purpose: string): {
  actionType: string;
  dividendAmount?: number;
} {
  const p = (purpose || "").toUpperCase();
  let actionType = "OTHER";
  let dividendAmount: number | undefined = undefined;

  // Check for dividend patterns
  if (p.includes("DIVIDEND") || p.includes("INTERIM DIVIDEND") || p.includes("FINAL DIVIDEND")) {
    actionType = "DIVIDEND";
    // Try to extract dividend amount from purpose
    const match = purpose.match(/Rs\.?\s*([\d,.]+)/i) || purpose.match(/₹\s*([\d,.]+)/i);
    if (match) {
      dividendAmount = parseFloat(match[1].replace(/,/g, ""));
    }
  } else if (p.includes("BONUS")) {
    actionType = "BONUS";
  } else if (p.includes("SPLIT") || p.includes("SUB-DIVISION")) {
    actionType = "SPLIT";
  } else if (p.includes("RIGHTS")) {
    actionType = "RIGHTS";
  } else if (p.includes("BUYBACK")) {
    actionType = "BUYBACK";
  } else if (p.includes("INTEREST")) {
    actionType = "INTEREST";
  } else if (p.includes("DEMERGER")) {
    actionType = "DEMERGER";
  } else if (p.includes("REDEMPTION")) {
    actionType = "REDEMPTION";
  } else if (p.includes("AMALGAMATION") || p.includes("MERGER")) {
    actionType = "MERGER";
  }

  return { actionType, dividendAmount };
}