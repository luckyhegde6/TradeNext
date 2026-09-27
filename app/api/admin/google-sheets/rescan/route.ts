import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isTrackerTab, type TrackerTab } from "@/lib/services/googleSheets/tabs";
import { RESCAN_ROW_LIMIT, rescanCustomConfig, rescanScreener } from "@/lib/services/googleSheets/rescanService";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/**
 * POST /api/admin/google-sheets/rescan - Spec 20 "Re-scan" per tab.
 *
 * Body: { tab: "screener" | "custom", configId?: string, categoryId?: string }
 *
 * This is the console's "go get fresh data" action, and it is deliberately
 * NOT the same thing as Sync:
 *   - Sync drains the ledger (moves already-produced rows to the sheet).
 *   - Rescan runs a scan and produces NEW rows.
 * They cannot be merged, because merging them would make a drain click trigger
 * network scans the user did not ask for.
 *
 * ONLY `screener` and `custom` are re-scannable. `swing` and `daily-rec` are
 * produced by the market-open cron (an AI pipeline over NIFTY constituents) and
 * `metrics` is a projection of the tracker table — re-running any of them from a
 * button would fabricate data rather than refresh it, so they are rejected with
 * a 400 that names the reason instead of silently doing nothing.
 *
 * SECURITY: admin-only, server-side. A rescan is expensive (a full-universe
 * TradingView scan, or a Chartink + TV fallback pass) and writes to an external
 * system, so the client-side redirect is UX, not access control.
 *
 * Audited, and AWAITED: unlike a producer's fire-and-forget export, this is an
 * explicit operator action whose outcome the console displays, so the audit and
 * the response must agree.
 */
const schema = z.object({
  tab: z.string(),
  /** Required for `custom`; ignored for `screener`. */
  configId: z.string().min(1).optional(),
  /** Optional filter for the `screener` pass. */
  categoryId: z.string().min(1).optional(),
  templateIds: z.array(z.string().min(1)).min(1).max(50).optional(),
});

/** Tabs with a producer that can legitimately be re-run on demand. */
const RESCANABLE: TrackerTab[] = ["screener", "custom"];

/** HTTP status per failure reason — the console branches on the code, not the text. */
const STATUS: Record<string, number> = {
  not_found: 404,
  no_filter_group: 409,
  db_unavailable: 503,
  error: 500,
};

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
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed" }, { status: 400 });
  }

  const { tab, configId, categoryId, templateIds } = parsed.data;
  if (!isTrackerTab(tab as TrackerTab)) {
    return NextResponse.json({ error: `Unknown tab: ${tab}` }, { status: 400 });
  }
  if (!RESCANABLE.includes(tab as TrackerTab)) {
    return NextResponse.json(
      {
        error:
          `Tab "${tab}" has no on-demand producer. Only ${RESCANABLE.join(" and ")} can be re-scanned; ` +
          "swing and daily-rec come from the scheduled AI pipeline, and metrics is derived from the tracker table.",
      },
      { status: 400 },
    );
  }
  // Checked here as well as inside the service: a `custom` rescan with no config
  // would otherwise fail deep in Prisma with a confusing "not found" for `undefined`.
  if (tab === "custom" && !configId) {
    return NextResponse.json({ error: "configId is required for a custom re-scan" }, { status: 400 });
  }

  const startedAt = Date.now();
  const result =
    tab === "custom"
      ? await rescanCustomConfig(configId as string)
      : await rescanScreener({ categoryId, templateIds });

  if (!result.ok) {
    logger.warn({ msg: "Google Sheets re-scan failed", tab, reason: result.reason, error: result.error });
    return NextResponse.json(
      { success: false, tab, reason: result.reason, error: result.error },
      { status: STATUS[result.reason] ?? 500 },
    );
  }

  // The audit must not be able to fail the operator's action, and it must not be
  // fire-and-forget either: the console shows a result, so the record of that
  // result should exist by the time the response is sent.
  try {
    const { createAuditLog } = await import("@/lib/audit");
    await createAuditLog({
      action: "GOOGLE_SHEETS_RESCAN",
      resource: "google_sheets_tracker",
      resourceId: tab,
      session,
      metadata: {
        tab,
        configId: configId ?? null,
        categoryId: categoryId ?? null,
        appended: result.appended,
        total: result.total,
        rowLimit: RESCAN_ROW_LIMIT,
      },
    });
  } catch (err) {
    logger.warn({ msg: "Google Sheets re-scan audit failed", tab, error: err });
  }

  return NextResponse.json({
    success: true,
    tab,
    appended: result.appended,
    total: result.total,
    delegatedExport: result.delegatedExport,
    executionMs: result.executionMs,
    elapsedMs: Date.now() - startedAt,
    rowLimit: RESCAN_ROW_LIMIT,
  });
}
