import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getSqliteFallback } from "@/lib/sqlite";
import { isTrackerTab, type TrackerTab } from "@/lib/services/googleSheets/tabs";
import { ledgerRowIsUnreadable } from "@/lib/services/googleSheets/rows";
import logger from "@/lib/logger";

export const runtime = "nodejs";

/** Upper bound on one delete call. Mirrors the drain cap in syncService so a
 *  stale client cannot hand us a 10k-seq array and force one giant prepared
 *  statement / one giant audit blob. */
const DELETE_MAX_SEQS = 200;

/**
 * DELETE /api/admin/google-sheets/ledger - Spec 20 §5.B "Remove unreadable"
 *
 * Body: { tab: TrackerTab, seqs: number[] }
 *
 * WHY THIS ROUTE IS THE DANGEROUS ONE
 * The ledger is append-only by design: rows are written on export and only ever
 * marked `delivered` on a successful drain. A drain never removes data. This is
 * the single endpoint that can destroy a row, so it is guarded three ways
 * before anything is deleted:
 *
 *   1. ADMIN ONLY, server-side (the console's client redirect is UX, not access
 *      control).
 *   2. The named seqs are READ BACK first. A seq that names nothing, belongs to
 *      another tab, or was already delivered is refused.
 *   3. Every row must be genuinely UNAPPENDABLE (`ledgerRowIsUnreadable`) — i.e.
 *      a row that can never sync, which is the only reason an operator would
 *      want to remove it. A healthy undelivered row is refused even though it is
 *      queued, because deleting it would silently discard data that was never
 *      sent to the sheet.
 *
 * ALL-OR-NOTHING: if any seq in the batch fails a guard, NOTHING is deleted.
 * A partial delete would leave the operator unable to tell which half of the
 * batch survived, and the next drain would still choke on the survivor. The
 * delete is also re-checked against the request size, because the guards and the
 * DELETE are separate statements and a prune/drain can race in between.
 *
 * Status codes: 400 malformed/unknown tab/cross-tab · 401 non-admin · 404 no
 * such seq · 409 a row is protected (delivered, still readable) or the batch
 * changed mid-flight · 503 the SQLite mirror is not ready · 500 unexpected.
 */
export async function DELETE(request: NextRequest) {
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
    tab: z.string(),
    seqs: z.array(z.number().int().positive()).min(1).max(DELETE_MAX_SEQS),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed" }, { status: 400 });
  }

  // An unknown tab is a client bug, not a no-op: fail loudly rather than let an
  // operator believe they cleaned a tab that does not exist.
  const tab = parsed.data.tab;
  if (!isTrackerTab(tab as TrackerTab)) {
    return NextResponse.json({ error: `Unknown tab: ${tab}` }, { status: 400 });
  }

  // Dedupe preserving order. `seq` is a primary key, so a repeat cannot delete
  // twice — but it would inflate `requested` vs `deleted` in the response and
  // misrepresent the batch to the operator and to the audit record.
  const seqs = [...new Set(parsed.data.seqs)];

  const sqlite = getSqliteFallback();
  if (!sqlite) {
    // Fail closed. getGoogleSheetsLedgerRowsBySeq would return [] here and the
    // request would look like "no such seq", which is a misleading reason to
    // refuse when the real problem is an unready mirror.
    return NextResponse.json({ error: "SQLite mirror not ready" }, { status: 503 });
  }

  const rows = sqlite.getGoogleSheetsLedgerRowsBySeq(seqs);
  const bySeq = new Map(rows.map((r) => [r.seq, r]));

  const missing = seqs.filter((s) => !bySeq.has(s));
  if (missing.length > 0) {
    return NextResponse.json({ error: `Unknown ledger seq(s): ${missing.join(", ")}` }, { status: 404 });
  }

  const foreignTab = seqs.filter((s) => bySeq.get(s)!.tab !== tab);
  if (foreignTab.length > 0) {
    return NextResponse.json(
      { error: `seq(s) do not belong to tab ${tab}: ${foreignTab.join(", ")}` },
      { status: 400 },
    );
  }

  // A delivered row already landed on the sheet; its record is the audit trail
  // for that append. Destroying it would erase the only record that the export
  // ever reached the sheet.
  const delivered = seqs.filter((s) => bySeq.get(s)!.delivered);
  if (delivered.length > 0) {
    return NextResponse.json(
      { error: `Already delivered, retained as the append audit trail: ${delivered.join(", ")}` },
      { status: 409 },
    );
  }

  const readable = seqs.filter((s) => !ledgerRowIsUnreadable(bySeq.get(s)!.rowJson));
  if (readable.length > 0) {
    return NextResponse.json(
      { error: `Refusing to delete syncable row(s): ${readable.join(", ")}. Use Sync to drain them.` },
      { status: 409 },
    );
  }

  const deleted = sqlite.deleteGoogleSheetsLedgerRows(tab, seqs);
  if (deleted !== seqs.length) {
    // ALL-OR-NOTHING is enforced up front, but the delete is a separate SQL
    // statement from the read-back, so a prune or a concurrent drain can still
    // steal a row in between. A SHORT delete is the case that would lie to the
    // operator: `deleted > 0` renders as a clean partial removal, while the
    // survivors are still pending and still poison the next drain. Report the
    // shortfall as a conflict so the console can refresh the list and retry.
    return NextResponse.json(
      {
        error: "Ledger changed during deletion",
        requested: seqs.length,
        deleted,
        note: "Some rows were removed; refresh and retry the remainder.",
      },
      { status: 409 },
    );
  }

  logger.info({ msg: "Google Sheets ledger rows deleted", tab, deleted, seqs });

  // Audit is a fire-and-forget side effect; a removal must never fail because of
  // it. Dynamic import keeps the route free of a hard audit dependency.
  try {
    const { createAuditLog } = await import("@/lib/audit");
    await createAuditLog({
      action: "GOOGLE_SHEETS_LEDGER_DELETED",
      resource: "google_sheets_tracker",
      resourceId: tab,
      session,
      metadata: { seqs, deleted },
    });
  } catch (err) {
    logger.warn({ msg: "Google Sheets ledger delete audit failed", tab, error: err });
  }

  return NextResponse.json({ success: true, tab, requested: seqs.length, deleted });
}
