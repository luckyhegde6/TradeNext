import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  getConfig,
  setEnabled,
  setSheetId,
  setDisplayName,
  maskSheetId,
} from "@/lib/services/googleSheets/configService";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * GET /api/admin/google-sheets/config - Spec 20 §5.B console configuration
 * POST /api/admin/google-sheets/config - update it
 *
 * SECURITY: admin-only (server-side). Writing this config is what links a live
 * export to an external spreadsheet and what the per-tab drain cursors hang off,
 * so it is a privileged write: role-checked, zod-validated, and audited. The
 * stored id is never echoed back in full.
 *
 * The `enabled` switch is deliberately RESTRICTIVE-ONLY: it can turn tracking off
 * but never on. Arming requires the GOOGLE_SHEETS_TRACKING_ENABLED env master,
 * which a runtime request cannot set — otherwise any admin session could
 * exfiltrate data to a spreadsheet of its choosing.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user || (session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const config = getConfig();
  return NextResponse.json({
    success: true,
    config: {
      sheetIdMasked: maskSheetId(config.sheetId),
      displayName: config.displayName,
      enabled: config.dbEnabled,
      lastSyncAt: config.lastSyncAt,
      tabMarks: config.tabMarks,
    },
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const schema = z
    .object({
      // A Google spreadsheet id: the long opaque key from the /d/ segment.
      sheetId: z
        .string()
        .trim()
        .min(10, "sheetId is too short to be a spreadsheet id")
        .max(200)
        .regex(/^[A-Za-z0-9-_]+$/, "sheetId contains invalid characters")
        .optional(),
      displayName: z.string().trim().max(120).optional(),
      enabled: z.boolean().optional(),
    })
    .refine((v) => v.sheetId !== undefined || v.displayName !== undefined || v.enabled !== undefined, {
      message: "Provide at least one of: sheetId, displayName, enabled",
    });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    );
  }

  try {
    if (parsed.data.sheetId !== undefined) await setSheetId(parsed.data.sheetId);
    if (parsed.data.displayName !== undefined) await setDisplayName(parsed.data.displayName);
    if (parsed.data.enabled !== undefined) await setEnabled(parsed.data.enabled);

    const config = getConfig();
    return NextResponse.json({
      success: true,
      config: {
        sheetIdMasked: maskSheetId(config.sheetId),
        displayName: config.displayName,
        enabled: config.dbEnabled,
        lastSyncAt: config.lastSyncAt,
      },
    });
  } catch (err) {
    logger.error({ msg: "Google Sheets config update failed", error: err });
    return NextResponse.json({ error: "Failed to update configuration" }, { status: 500 });
  }
}
