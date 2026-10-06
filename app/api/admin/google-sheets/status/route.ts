import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getStatus } from "@/lib/services/googleSheets/statusService";
import {
  EXCLUDED_TABS,
  getBacklogCounts,
  getUnreadableSeqs,
  readTabCursor,
  SYNC_CONFIRM_THRESHOLD,
  UNREADABLE_REPORT_CAP,
} from "@/lib/services/googleSheets/syncService";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * GET /api/admin/google-sheets/status - Spec 20 §5.C console status
 *
 * SECURITY: admin-only (server-side). The payload carries OAuth *presence*
 * booleans and a masked spreadsheet id, never a client secret, refresh token or
 * full id, so it is safe to render for admins but is not a credential surface.
 * Reads the SQLite mirror only — no Prisma ops, so it works under the P6003 hold.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user || (session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const status = await getStatus();
    const counts = getBacklogCounts();

    return NextResponse.json({
      success: true,
      status,
      // Per-tab drain state, so the console can render the whole queue picture
      // without a second round-trip:
      //   queued  — every row still marked undelivered. NOT purely "work a drain
      //             would send": it also counts marker-write residue (the append
      //             landed, only the `delivered` flag write failed), which is
      //             deliberately never replayed and ages out with retention
      //   retained— every row on disk (drained rows kept for the audit window);
      //             a single number here would mislabel retention as pending work
      //   unreadable — undelivered rows that can never append, so a drain stops
      //   unreadableSeqs — and exactly which seqs, for the "Remove" action
      sync: {
        confirmThreshold: SYNC_CONFIRM_THRESHOLD,
        unreadableCap: UNREADABLE_REPORT_CAP,
        tabs: status.perTab.map((t) => {
          const unreadableSeqs = EXCLUDED_TABS.includes(t.tab) ? [] : getUnreadableSeqs(t.tab);
          const perTab = counts[t.tab];
          return {
            tab: t.tab,
            queued: perTab?.queued ?? 0,
            retained: perTab?.retained ?? 0,
            unreadable: unreadableSeqs.length,
            unreadableSeqs,
            cursor: (() => {
              try {
                const c = readTabCursor(t.tab);
                return c > 0 ? String(c) : null;
              } catch {
                return null;
              }
            })(),
          };
        }),
      },
    });
  } catch (err) {
    logger.error({ msg: "Google Sheets status failed", error: err });
    return NextResponse.json({ error: "Failed to read status" }, { status: 500 });
  }
}
