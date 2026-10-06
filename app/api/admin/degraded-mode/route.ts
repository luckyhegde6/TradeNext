import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  DEGRADED_MODE_SETTINGS,
  getDegradedModeSetting,
  getDegradedState,
  setDegradedMode,
  type DegradedModeSetting,
} from "@/lib/services/degradedMode";
import { getDegradedQueueStatus } from "@/lib/services/worker/degradedQueue";
import { degradedLeaseHolder } from "@/lib/services/degradedLeader";
import { createAuditLog } from "@/lib/audit";
import { getSqliteFallback } from "@/lib/sqlite";
import logger from "@/lib/logger";

export const runtime = "nodejs";

const MODE_INPUT_SCHEMA = z.object({
  // The enum is derived from the same tuple the service validates against, so a
  // value the UI can send is by construction a value the service accepts. The
  // audit log below still records the raw string for forensics.
  mode: z.enum(DEGRADED_MODE_SETTINGS),
});

/** Rejects any session that is not an admin. Returns the user id, or null. */
async function requireAdmin(): Promise<{ userId: string; email?: string } | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  if ((session.user as { role?: string }).role !== "admin") return null;
  return {
    userId: session.user.id,
    email: session.user.email ?? undefined,
  };
}

/**
 * GET /api/admin/degraded-mode - Spec 21 §6 console visibility
 *
 * Reports WHY degraded mode is on or off, not just that it is. During a hold an
 * operator has to tell "the plan limit genuinely tripped" from "someone flipped
 * the kill-switch", because the remedy is different — one waits, the other
 * flips a switch back.
 *
 * Reads SQLite + the ops counter only (no Prisma), so the console stays
 * answerable during the very outage it exists to explain.
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const state = getDegradedState();

    // The holder is only meaningful while engaged; showing a holder while
    // inactive would read as "someone is driving degraded work" when nobody is.
    let leaseHolder: string | null = null;
    if (state.active) {
      try {
        leaseHolder = degradedLeaseHolder();
      } catch (err) {
        // A Blob/lease failure must not blank the whole panel — the operator
        // still needs to see that the mode is active even if we cannot say who
        // is currently executing.
        logger.warn({ msg: "Degraded lease holder read failed", error: err });
      }
    }

    return NextResponse.json({
      success: true,
      mode: getDegradedModeSetting(),
      state,
      leaseHolder,
      queue: getDegradedQueueStatus(),
      mirrorReady: Boolean(getSqliteFallback()?.isReady()),
      // Surfaced so the console can explain the decision to an operator instead
      // of showing a bare on/off switch with no rationale.
      modes: DEGRADED_MODE_SETTINGS.map((m) => ({
        value: m,
        label: m === "auto" ? "Auto (plan-limit driven)" : m === "force" ? "Force on" : "Off (kill-switch)",
      })),
    });
  } catch (err) {
    logger.error({ msg: "Degraded mode status failed", error: err });
    return NextResponse.json({ error: "Failed to read degraded mode" }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/degraded-mode - set the operator mode.
 *
 * Persists to SQLite `_degraded_state` so the choice survives a deploy, and is
 * re-applied at boot by instrumentation.ts. `active` is deliberately NOT
 * persisted: it carries hysteresis (stay engaged until usage falls below the
 * exit ratio), which is a property of the live counter, not of the setting.
 */
export async function PATCH(req: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let mode: DegradedModeSetting;
  try {
    const body = await req.json();
    const parsed = MODE_INPUT_SCHEMA.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "mode must be one of auto | force | off" },
        { status: 400 },
      );
    }
    mode = parsed.data.mode;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    setDegradedMode(mode);

    // userId is typed number but the Auth.js session carries a string id;
    // parseInt (audit.ts does the same for `session`) keeps the row attributable.
    const numericUserId = Number.parseInt(admin.userId, 10);
    await createAuditLog({
      action: "DEGRADED_MODE_SET",
      ...(Number.isFinite(numericUserId) ? { userId: numericUserId } : {}),
      userEmail: admin.email,
      metadata: { mode },
    }).catch((err: unknown) => {
      // The setting already took effect; failing the request here would tell the
      // operator it failed when it in fact applied — and the kill-switch is
      // exactly the moment where a misleading response is most dangerous.
      logger.error({ msg: "Degraded mode audit log failed", mode, error: err });
    });

    return NextResponse.json({
      success: true,
      mode: getDegradedModeSetting(),
      state: getDegradedState(),
    });
  } catch (err) {
    logger.error({ msg: "Degraded mode change failed", mode, error: err });
    return NextResponse.json({ error: "Failed to set degraded mode" }, { status: 500 });
  }
}