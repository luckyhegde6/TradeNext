import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { probeAccelerate } from "@/lib/services/accelerateProbe";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * GET /api/admin/accelerate/probe - Spec 28 Accelerate connectivity probe.
 *
 * `?force=1` bypasses the TTL cache (the console's "Test now" button). Without
 * it the route returns the cached answer from the last window (default 60s) —
 * the reaper and the console then share one answer instead of hammering the
 * proxy.
 *
 * SECURITY: admin-only, server-side. The probe is a read ("SELECT 1") and can
 * never modify anything, but it does leak DB reachability (a network-position
 * fact worth keeping out of anonymous hands) and every successful hit is
 * audited, so the route stays behind the admin role.
 *
 * Never 5xx *because of a probe failure*: an unreachable Accelerate is a
 * `state:"unreachable"` response, not an exception. probeAccelerate() only
 * throws on programmer error, which this route converts to a 500.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = request.nextUrl.searchParams.get("force") === "1";

  try {
    const probe = await probeAccelerate({ force });

    // Audit every admin-initiated probe (not the reaper's, which logs at warn).
    try {
      const { createAuditLog } = await import("@/lib/audit");
      await createAuditLog({
        action: "ACCELERATE_PROBE",
        resource: "accelerate",
        session,
        metadata: {
          state: probe.state,
          latencyMs: probe.latencyMs,
          checkedAt: probe.checkedAt,
          probeId: probe.probeId,
          force,
        },
      });
    } catch (auditErr) {
      logger.warn({ msg: "Accelerate probe audit failed", error: auditErr });
    }

    return NextResponse.json({ success: true, probe });
  } catch (err) {
    logger.error({ msg: "Accelerate probe route error", error: err });
    return NextResponse.json({ error: "Probe failed" }, { status: 500 });
  }
}