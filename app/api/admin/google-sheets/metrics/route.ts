import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getMetrics } from "@/lib/services/googleSheets/metricsService";
import { exportMetricsSnapshot } from "@/lib/services/googleSheets/exporter";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * GET/POST /api/admin/google-sheets/metrics - Spec 20 "Performance & Metrics"
 *
 * GET  -> the read-only KPI preview the console renders.
 * POST -> "Append KPI snapshot": encodes the current snapshot and appends ONE
 *         row to the `metrics` tab.
 *
 * Append-only by construction: there is no request field for a row, a range, or
 * a value. The server computes the snapshot and the encoder lays it out
 * positionally, so this endpoint cannot write anything but a KPI row, and there
 * is deliberately no clear/overwrite verb on it.
 *
 * SECURITY: admin-only (server-side). Unlike status, this DOES read Prisma —
 * `RecommendationTracker` is not in the SQLite mirror, so a preview is
 * impossible while the plan-limit hold is open. That surfaces as
 * `200 { ok: false, reason: "db_unavailable" }` rather than a 500, so the
 * console keeps rendering every other panel and can explain the gap.
 */
async function isAdmin() {
  const session = await auth();
  return session?.user && (session.user as { role?: string }).role === "admin" ? session : null;
}

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await getMetrics();
  if (!result.ok) {
    return NextResponse.json({ success: true, ok: false, reason: result.reason, snapshot: null });
  }
  return NextResponse.json({ success: true, ok: true, snapshot: result.snapshot });
}

const schema = z.object({
  /** Exposed so the console can say "the 200-row drain cap applies" before asking. */
  confirmed: z.boolean().optional(),
});

export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown = {};
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed" }, { status: 400 });
  }

  // A snapshot with nothing in it is not a KPI, it is an absence. Appending one
  // would put a row of blanks in the user's sheet and quietly distort the series.
  const result = await getMetrics();
  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.reason === "db_unavailable" ? "Database unavailable" : "Metrics failed" },
      { status: 503 },
    );
  }
  if (result.snapshot.totalTracked === 0) {
    return NextResponse.json(
      { success: false, error: "No tracked recommendations to snapshot yet" },
      { status: 409 },
    );
  }

  // Awaited (not fire-and-forget): this is the manual operator action, and the
  // console must show whether the row landed. The exporter itself still records
  // the outcome in the ledger either way, so a failure here is retryable.
  const outcome = await exportMetricsSnapshot(result.snapshot);
  logger.info({ msg: "Google Sheets metrics snapshot appended", outcome });

  return NextResponse.json({
    success: outcome !== "failed",
    tab: "metrics",
    outcome,
    snapshot: result.snapshot,
  });
}
