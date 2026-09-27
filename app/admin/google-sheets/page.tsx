"use client";

/**
 * Spec 20 §5.C — Google Sheets tracking console.
 *
 * Deliberately a thin renderer: every decision (is tracking on, which header is
 * on the sheet, what a drain would append) comes from the server via
 * /api/admin/google-sheets/{status,config,sync}, which are themselves admin
 * role-checked. The page mirrors the repo's other admin pages by redirecting
 * non-admins client-side, but that is UX only — it is NOT the security boundary.
 */

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

type HeaderState = "match" | "mismatch" | "empty" | "unreadable" | "absent" | "unknown";
type TabName = "swing" | "daily-rec" | "screener" | "custom" | "decisions" | "metrics";

interface TabStatus {
  tab: TabName;
  headerState: HeaderState;
  detail?: string;
}
interface SheetsStatus {
  envEnabled: boolean;
  dbConfigured: boolean;
  sheetIdMasked: string | null;
  oauthConfigured: { clientId: boolean; clientSecret: boolean; refreshToken: boolean };
  trackingEnabled: boolean;
  perTab: TabStatus[];
}
interface SyncTabState {
  tab: TabName;
  /** Rows still marked undelivered. NOT purely "work a drain will send": it is
   *  the undelivered set, which also contains marker-write residue (the append
   *  landed, only the `delivered` flag write failed) that is deliberately never
   *  replayed. See the ledger explainer below. */
  queued: number;
  /** Every row on disk, including drained ones kept for the audit window. */
  retained: number;
  /** Undelivered rows that can never append — a drain stops on these. */
  unreadable: number;
  /** The exact seqs, for the "Remove unreadable" action. */
  unreadableSeqs: number[];
  cursor: string | null;
}
interface StatusResponse {
  success: boolean;
  status: SheetsStatus;
  sync: {
    confirmThreshold: number;
    unreadableCap: number;
    tabs: SyncTabState[];
  };
}
interface ConfigResponse {
  success: boolean;
  config: {
    sheetIdMasked: string | null;
    displayName: string | null;
    enabled: boolean;
    lastSyncAt: string | null;
  };
}
interface SyncTabResult {
  tab: TabName;
  status: string;
  rows: number;
  remaining: number;
  cursor: string | null;
  detail?: string;
}
interface SyncResponse {
  success: boolean;
  status: string;
  tabs: SyncTabResult[];
  error?: string;
}

/** Mirrors the 11-column `metrics` row contract. */
interface MetricsSnapshot {
  snapshotAt: string;
  totalTracked: number;
  active: number;
  targetAchieved: number;
  stopLossHit: number;
  expired: number;
  /** Percent 0..100, or null when there is nothing decided yet. */
  winRate: number | null;
  netPnlAbs: number | null;
  netPnlPct: number | null;
  avgReturnPct: number | null;
  grossPnlAbs: number | null;
}
interface MetricsResponse {
  success: boolean;
  /** false when the snapshot could not be computed (e.g. DB held). */
  ok: boolean;
  reason?: string;
  snapshot: MetricsSnapshot | null;
  appended?: number;
  error?: string;
}
interface RescanResponse {
  success: boolean;
  tab: TabName;
  appended: number;
  total: number;
  delegatedExport: boolean;
  executionMs: number;
  rowLimit: number;
  reason?: string;
  error?: string;
}
interface LedgerDeleteResponse {
  success?: boolean;
  deleted?: number;
  requested?: number;
  note?: string;
  error?: string;
}

const HEADER_BADGE: Record<HeaderState, { label: string; cls: string }> = {
  match: { label: "header ok", cls: "bg-green-100 dark:bg-emerald-500/15 text-green-800 dark:text-emerald-300" },
  mismatch: { label: "header mismatch", cls: "bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  empty: { label: "header written", cls: "bg-blue-100 dark:bg-blue-500/15 text-blue-800 dark:text-blue-300" },
  unreadable: { label: "unreadable", cls: "bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  absent: { label: "tab missing", cls: "bg-red-100 dark:bg-red-500/15 text-red-800 dark:text-red-300" },
  unknown: { label: "unknown", cls: "bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-200" },
};

export default function AdminGoogleSheetsPage() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();

  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [config, setConfig] = useState<ConfigResponse["config"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheetId, setSheetId] = useState("");
  const [displayName, setDisplayName] = useState("");
  // Keyed by tab so two tabs can never share an in-flight/disabled state, and
  // so a row's spinner is tied to the row that is actually running.
  const [busyTab, setBusyTab] = useState<TabName | null>(null);
  const [configIds, setConfigIds] = useState<Record<string, string>>({});
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);

  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (!session?.user || (session.user as { role?: string }).role !== "admin") {
      router.push("/admin/access-denied");
    }
  }, [session, sessionStatus, router]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, c] = await Promise.all([
        fetch("/api/admin/google-sheets/status"),
        fetch("/api/admin/google-sheets/config"),
      ]);
      if (!s.ok) throw new Error(`status ${s.status}`);
      const sj = (await s.json()) as StatusResponse;
      setStatus(sj);
      if (c.ok) {
        const cj = (await c.json()) as ConfigResponse;
        setConfig(cj.config);
        setDisplayName(cj.config.displayName ?? "");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionStatus === "authenticated") load();
  }, [sessionStatus, load]);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/google-sheets/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(sheetId.trim() ? { sheetId: sheetId.trim() } : {}),
          ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error ?? `config ${res.status}`);
      setNotice("Saved. Reloading status…");
      setSheetId("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [sheetId, displayName, load]);

  const toggle = useCallback(async () => {
    if (!config) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/google-sheets/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !config.enabled }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error ?? `config ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [config, load]);

  const sync = useCallback(
    async (confirmed: boolean) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const res = await fetch("/api/admin/google-sheets/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(confirmed ? { confirmed: true } : {}),
        });
        const body = (await res.json()) as SyncResponse;
        if (!res.ok) throw new Error(body.error ?? `sync ${res.status}`);
        const drained = body.tabs.filter((t) => t.rows > 0).length;
        const failed = body.tabs.filter((t) => t.status === "failed").length;
        const needConfirm = body.tabs.filter((t) => t.status === "needs-confirmation").length;
        setNotice(
          needConfirm > 0
            ? `${needConfirm} tab(s) have a large backlog — confirm to append.`
            : `Drained ${drained} tab(s)${failed > 0 ? `, ${failed} failed` : ""}.`,
        );
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  /**
   * Run a scan and queue its results. Distinct from Sync: Sync drains rows that
   * were already captured, Rescan produces NEW ones. The two are separate
   * buttons because merging them would make a drain click fire network scans.
   */
  const rescan = useCallback(
    async (tab: TabName) => {
      const configId = (configIds[tab] ?? "").trim();
      if (tab === "custom" && !configId) {
        setError("Enter the saved config id to re-scan the custom tab.");
        return;
      }
      setBusyTab(tab);
      setError(null);
      setNotice(null);
      try {
        const res = await fetch("/api/admin/google-sheets/rescan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tab === "custom" ? { tab, configId } : { tab }),
        });
        const body = (await res.json()) as RescanResponse;
        if (!res.ok || !body.success) {
          throw new Error(body.error ?? `rescan ${res.status}`);
        }
        // The screener path appends fire-and-forget from inside the producer, so
        // its count is "queued", not "delivered" — say so, or the operator will
        // look for rows that have not landed yet.
        setNotice(
          body.appended === 0
            ? `Re-scan of ${tab} matched nothing.`
            : `Re-scan of ${tab} queued ${body.appended} row(s)${
                body.total > body.appended ? ` of ${body.total} matches (cap ${body.rowLimit})` : ""
              }.${body.delegatedExport ? " Sync to append them." : ""}`,
        );
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyTab(null);
      }
    },
    [configIds, load],
  );

  /**
   * Delete the rows that can never be appended. This is the only destructive
   * action in the subsystem, so it is confirmed inline with the exact count and
   * the exact seqs — the server re-checks every row regardless, but an
   * operator should never delete rows they have not seen.
   */
  const removeUnreadable = useCallback(
    async (tab: TabName) => {
      const seqs = status?.sync.tabs.find((x) => x.tab === tab)?.unreadableSeqs ?? [];
      if (seqs.length === 0) return;
      if (
        !window.confirm(
          `Delete ${seqs.length} unreadable row(s) from "${tab}"?\n\n` +
            `These can never reach the sheet, so Sync will keep failing until they are gone.\n` +
            `seqs: ${seqs.join(", ")}`,
        )
      ) {
        return;
      }
      setBusyTab(tab);
      setError(null);
      setNotice(null);
      try {
        const res = await fetch("/api/admin/google-sheets/ledger", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tab, seqs }),
        });
        const body = (await res.json()) as LedgerDeleteResponse;
        if (!res.ok || !body.success) {
          // A 409 can be a mid-flight change, so always reload the seq list.
          throw new Error(body.error ?? `remove ${res.status}`);
        }
        setNotice(`Removed ${body.deleted} unreadable row(s) from ${tab}.`);
        await load();
      } catch (e) {
        // Reload FIRST, then surface the reason. `load()` clears `error` on
        // entry, so setting it before the await wipes the server's explanation —
        // and this is the one destructive action in the subsystem, where losing
        // the reason (which seq tripped the mid-flight re-check) is the worst
        // possible outcome. The refresh itself is still required: a 409 means
        // the seq list is stale.
        await load();
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyTab(null);
      }
    },
    [status, load],
  );

  /** Load the metrics projection. Safe to call while the DB is held. */
  const loadMetrics = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/google-sheets/metrics");
      const body = (await res.json()) as MetricsResponse;
      if (!res.ok) throw new Error(body.error ?? `metrics ${res.status}`);
      setMetrics(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const appendMetrics = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/google-sheets/metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      });
      const body = (await res.json()) as MetricsResponse;
      if (!res.ok || !body.success) throw new Error(body.error ?? `metrics ${res.status}`);
      setNotice(body.appended ? "Metrics snapshot appended to the sheet queue." : "Nothing appended.");
      await Promise.all([load(), loadMetrics()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [load, loadMetrics]);

  if (loading) {
    return <div className="p-6 text-gray-600 dark:text-slate-300">Loading Google Sheets status…</div>;
  }

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Google Sheets Tracking</h1>
          <p className="text-sm text-gray-600 dark:text-slate-300">
            Append-only export of recommendations, screeners and decisions to a spreadsheet you own.
          </p>
        </div>
        <button
          onClick={load}
          className="rounded border border-gray-300 dark:border-slate-700 px-3 py-1.5 text-sm hover:bg-gray-50 dark:bg-slate-900"
        >
          Refresh
        </button>
      </header>

      {error && (
        <div className="rounded border border-red-300 dark:border-red-500/40 bg-red-50 dark:bg-red-500/10 p-3 text-sm text-red-800 dark:text-red-300" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded border border-blue-300 dark:border-blue-500/40 bg-blue-50 dark:bg-blue-500/10 p-3 text-sm text-blue-800 dark:text-blue-300" role="status">
          {notice}
        </div>
      )}

      {status && (
        <section className="rounded border border-gray-200 dark:border-slate-800 p-4">
          <h2 className="mb-3 text-lg font-semibold">Status</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <div>
              <dt className="text-gray-500 dark:text-slate-400">Tracking</dt>
              <dd className="font-mono font-semibold">
                {status.status.trackingEnabled ? "ON" : "OFF"}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500 dark:text-slate-400">Env master</dt>
              <dd className="font-mono">{status.status.envEnabled ? "true" : "false"}</dd>
            </div>
            <div>
              <dt className="text-gray-500 dark:text-slate-400">Configured</dt>
              <dd className="font-mono">{status.status.dbConfigured ? "yes" : "no"}</dd>
            </div>
            <div>
              <dt className="text-gray-500 dark:text-slate-400">Spreadsheet</dt>
              <dd className="font-mono">{status.status.sheetIdMasked ?? "—"}</dd>
            </div>
          </dl>
          <div className="mt-3 text-sm text-gray-600 dark:text-slate-300">
            OAuth: client id {status.status.oauthConfigured.clientId ? "✓" : "✗"} · client secret{" "}
            {status.status.oauthConfigured.clientSecret ? "✓" : "✗"} · refresh token{" "}
            {status.status.oauthConfigured.refreshToken ? "✓" : "✗"}
          </div>
          {!status.status.trackingEnabled && (
            <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">
              Tracking cannot write yet. It needs the env master flag, a configured spreadsheet id, and
              valid OAuth credentials.
            </p>
          )}
        </section>
      )}

      {config && (
        <section className="rounded border border-gray-200 dark:border-slate-800 p-4">
          <h2 className="mb-3 text-lg font-semibold">Configuration</h2>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="block text-gray-500 dark:text-slate-400">Spreadsheet id</span>
              <input
                value={sheetId}
                onChange={(e) => setSheetId(e.target.value)}
                placeholder={config.sheetIdMasked ?? "1AbCd…"}
                className="w-72 rounded border border-gray-300 dark:border-slate-700 px-2 py-1.5 font-mono text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="block text-gray-500 dark:text-slate-400">Display name</span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Tracker"
                className="w-56 rounded border border-gray-300 dark:border-slate-700 px-2 py-1.5 text-sm"
              />
            </label>
            <button
              onClick={save}
              disabled={busy}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={toggle}
              disabled={busy || !status?.status.envEnabled}
              title={
                status?.status.envEnabled
                  ? undefined
                  : "The GOOGLE_SHEETS_TRACKING_ENABLED env master is off; the switch cannot be turned on here."
              }
              className="rounded border border-gray-300 dark:border-slate-700 px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {config.enabled ? "Turn off" : "Turn on"}
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
            Last sync: {config.lastSyncAt ? new Date(config.lastSyncAt).toLocaleString() : "never"}
          </p>
        </section>
      )}

      <section className="rounded border border-gray-200 dark:border-slate-800 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Tabs &amp; queue</h2>
          <div className="flex gap-2">
            <button
              onClick={() => sync(false)}
              disabled={busy}
              className="rounded bg-green-600 dark:bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              Sync now
            </button>
            <button
              onClick={() => sync(true)}
              disabled={busy}
              title="Appends a backlog larger than the confirmation threshold."
              className="rounded border border-gray-300 dark:border-slate-700 px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Sync all (confirm)
            </button>
          </div>
        </div>

        {status ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-gray-500 dark:text-slate-400">
                <tr>
                  <th className="py-2 pr-3">Tab</th>
                  <th className="py-2 pr-3">Header</th>
                  <th className="py-2 pr-3">Queued</th>
                  <th className="py-2 pr-3">Retained</th>
                  <th className="py-2 pr-3">Unreadable</th>
                  <th className="py-2 pr-3">Cursor</th>
                  <th className="py-2 pr-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {status.status.perTab.map((t) => {
                  const badge = HEADER_BADGE[t.headerState] ?? HEADER_BADGE.unknown;
                  const row = status.sync.tabs.find((x) => x.tab === t.tab);
                  const queued = row?.queued ?? 0;
                  const unreadableSeqs = row?.unreadableSeqs ?? [];
                  const rescanable = t.tab === "screener" || t.tab === "custom";
                  const rowBusy = busyTab === t.tab;
                  return (
                    <tr key={t.tab} className="border-t border-gray-100 dark:border-slate-800 align-top">
                      <td className="py-2 pr-3 font-mono">{t.tab}</td>
                      <td className="py-2 pr-3">
                        <span className={`rounded px-2 py-0.5 text-xs ${badge.cls}`}>{badge.label}</span>
                        {t.detail && <span className="ml-2 text-xs text-gray-500 dark:text-slate-400">{t.detail}</span>}
                      </td>
                      {/* Retained is shown separately from queued on purpose: the
                          two differ by the drained-but-kept audit window, and
                          collapsing them into one number mislabels old rows as
                          pending work. */}
                      <td className="py-2 pr-3 font-semibold">{queued}</td>
                      <td className="py-2 pr-3 text-gray-500 dark:text-slate-400">{row?.retained ?? 0}</td>
                      <td className="py-2 pr-3">
                        {unreadableSeqs.length > 0 ? (
                          <details>
                            <summary className="cursor-pointer text-amber-700 dark:text-amber-400">
                              {unreadableSeqs.length} row(s)
                            </summary>
                            <div className="mt-1 max-w-xs break-all font-mono text-xs text-gray-600 dark:text-slate-300">
                              {unreadableSeqs.join(", ")}
                            </div>
                          </details>
                        ) : (
                          <span className="text-gray-400 dark:text-slate-500">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 font-mono text-gray-600 dark:text-slate-300">{row?.cursor ?? "—"}</td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {rescanable && (
                            <>
                              {t.tab === "custom" && (
                                <input
                                  value={configIds[t.tab] ?? ""}
                                  onChange={(e) =>
                                    setConfigIds((prev) => ({ ...prev, [t.tab]: e.target.value }))
                                  }
                                  placeholder="config id"
                                  aria-label={`Saved config id to re-scan into the ${t.tab} tab`}
                                  className="w-32 rounded border border-gray-300 dark:border-slate-700 px-2 py-1 font-mono text-xs"
                                />
                              )}
                              <button
                                onClick={() => rescan(t.tab)}
                                disabled={rowBusy}
                                title={
                                  t.tab === "custom"
                                    ? "Re-runs this saved config and queues the results."
                                    : "Forces a fresh unified-screener pass and queues the results."
                                }
                                className="rounded border border-gray-300 dark:border-slate-700 px-2 py-1 text-xs disabled:opacity-50"
                              >
                                {rowBusy ? "…" : "Rescan"}
                              </button>
                            </>
                          )}
                          {unreadableSeqs.length > 0 && (
                            <button
                              onClick={() => removeUnreadable(t.tab)}
                              disabled={rowBusy}
                              title="Delete rows that can never be appended. This is the only destructive action here."
                              className="rounded border border-red-300 dark:border-red-500/40 px-2 py-1 text-xs text-red-700 dark:text-red-400 disabled:opacity-50"
                            >
                              Remove unreadable
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-600 dark:text-slate-300">No status available.</p>
        )}

        <p className="mt-3 text-xs text-gray-500 dark:text-slate-400">
          <strong>Queued</strong> is every row still marked undelivered; <strong>retained</strong> is
          everything on disk, including rows already appended and kept for the audit window. The two
          differ by the drained-but-kept audit window, so collapsing them would mislabel old rows as
          pending work.
        </p>
        <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
          Most queued rows are sent by the next drain, but not all — so a non-zero queue is not
          necessarily a stuck queue. A row can be counted yet never replayed when the append already
          reached the sheet and only the delivered-marker write failed. Re-sending it would duplicate
          it, so the cursor is advanced regardless and the row ages out with the retention window.
          The exception is a corrupt row, which parks the drain and must be removed with{" "}
          <strong>Remove unreadable</strong> before the rows behind it can be sent. A drain can only
          replay rows that were captured in the first place; it cannot re-create history that never
          was. Backlogs over {status?.sync.confirmThreshold ?? 100} rows need explicit confirmation.
        </p>
      </section>

      <section className="rounded border border-gray-200 dark:border-slate-800 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Metrics</h2>
          <div className="flex gap-2">
            <button
              onClick={loadMetrics}
              className="rounded border border-gray-300 dark:border-slate-700 px-3 py-1.5 text-sm hover:bg-gray-50 dark:bg-slate-900"
            >
              Preview
            </button>
            <button
              onClick={appendMetrics}
              disabled={busy || !metrics?.ok}
              title={
                metrics?.ok === false
                  ? metrics.reason === "db_unavailable"
                    ? "The database is held, so the projection cannot be computed."
                    : "No snapshot to append."
                  : undefined
              }
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              Append snapshot
            </button>
          </div>
        </div>

        {metrics === null ? (
          <p className="text-sm text-gray-600 dark:text-slate-300">Preview to compute the current projection.</p>
        ) : !metrics.ok ? (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            {metrics.reason === "db_unavailable"
              ? "The database is held (plan limit), so the projection cannot be computed. No row is queued."
              : `Could not compute the projection${metrics.reason ? `: ${metrics.reason}` : ""}.`}
          </p>
        ) : (
          <MetricsTable snapshot={metrics.snapshot!} />
        )}

        <p className="mt-3 text-xs text-gray-500 dark:text-slate-400">
          A snapshot is appended as a single row so the sheet keeps a history of how the tracker
          performs over time. Appends are queued like any other run — Sync writes them.
        </p>
      </section>
    </main>
  );
}

/** Renders one metrics snapshot. A null KPI is shown as "—", never as 0:
 *  "no closed picks yet" and "zero return" are different facts. */
function MetricsTable({ snapshot }: { snapshot: MetricsSnapshot }) {
  const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)}%`);
  const abs = (v: number | null) => (v === null ? "—" : `₹${v.toFixed(2)}`);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-gray-500 dark:text-slate-400">
          <tr>
            <th className="py-2 pr-3">Snapshot</th>
            <th className="py-2 pr-3">Tracked</th>
            <th className="py-2 pr-3">Active</th>
            <th className="py-2 pr-3">Target hit</th>
            <th className="py-2 pr-3">Stop hit</th>
            <th className="py-2 pr-3">Expired</th>
            <th className="py-2 pr-3">Win rate</th>
            <th className="py-2 pr-3">Net P&amp;L</th>
            <th className="py-2 pr-3">Net %</th>
            <th className="py-2 pr-3">Avg return</th>
            <th className="py-2 pr-3">Gross P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-gray-100 dark:border-slate-800">
            <td className="py-2 pr-3 font-mono text-xs">
              {new Date(snapshot.snapshotAt).toLocaleString()}
            </td>
            <td className="py-2 pr-3">{snapshot.totalTracked}</td>
            <td className="py-2 pr-3">{snapshot.active}</td>
            <td className="py-2 pr-3">{snapshot.targetAchieved}</td>
            <td className="py-2 pr-3">{snapshot.stopLossHit}</td>
            <td className="py-2 pr-3">{snapshot.expired}</td>
            <td className="py-2 pr-3">{pct(snapshot.winRate)}</td>
            <td className="py-2 pr-3">{abs(snapshot.netPnlAbs)}</td>
            <td className="py-2 pr-3">{pct(snapshot.netPnlPct)}</td>
            <td className="py-2 pr-3">{pct(snapshot.avgReturnPct)}</td>
            <td className="py-2 pr-3">{abs(snapshot.grossPnlAbs)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
