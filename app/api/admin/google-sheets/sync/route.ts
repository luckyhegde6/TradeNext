import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { syncTabs } from "@/lib/services/googleSheets/syncService";
import { isTrackerTab, TRACKER_TAB_KEYS, type TrackerTab } from "@/lib/services/googleSheets/tabs";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * POST /api/admin/google-sheets/sync - Spec 20 §5.B "Sync now"
 *
 * Body: { tabs?: string[], confirmed?: boolean }
 * Omitting `tabs` drains every syncable tab, sequentially.
 *
 * SECURITY: admin-only (server-side). This route is a privileged action on two
 * counts — it appends rows to an external spreadsheet and it drains a durable
 * local queue — so it is role-checked and zod-validated. It is deliberately
 * POST-only: a GET would let a prefetch, a crawler or a browser retry trigger
 * an outbound append.
 *
 * `confirmed` is required to exceed SYNC_CONFIRM_THRESHOLD rows for a tab. An
 * unconfirmed large drain reports "needs-confirmation" and appends nothing, so a
 * double-click cannot bulk-push a backlog.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown = {};
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const schema = z.object({
    tabs: z.array(z.string()).max(10).optional(),
    confirmed: z.boolean().optional(),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed" }, { status: 400 });
  }

  // An unknown tab is a client bug, not a no-op: fail loudly rather than
  // silently syncing fewer tabs than the operator asked for.
  const requested = parsed.data.tabs;
  let tabs: TrackerTab[];
  if (requested && requested.length > 0) {
    const bad = requested.filter((t) => !isTrackerTab(t as TrackerTab));
    if (bad.length > 0) {
      return NextResponse.json({ error: `Unknown tab(s): ${bad.join(", ")}` }, { status: 400 });
    }
    tabs = requested as TrackerTab[];
  } else {
    tabs = [...TRACKER_TAB_KEYS];
  }

  try {
    const result = await syncTabs(tabs, parsed.data.confirmed ?? false);
    return NextResponse.json({ success: result.status !== "failed", ...result });
  } catch (err) {
    logger.error({ msg: "Google Sheets sync failed", error: err });
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
