"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";

type OutboundNotification = {
  id: string;
  createdAt: string;
  updatedAt?: string;
  channel: string;
  chatId?: string | null;
  recipientType?: string | null;
  recipientId?: string | null;
  notificationType: string;
  title?: string | null;
  message: string;
  status: string;
  error?: string | null;
  source?: string | null;
  triggeredBy?: string | null;
  batchId?: string | null;
  attemptCount?: number;
  lastAttemptAt?: string | null;
  sentAt?: string | null;
  deliveredAt?: string | null;
  cancelledAt?: string | null;
  metadata?: Record<string, unknown> | null;
};

type ApiResponse = {
  items?: OutboundNotification[];
  total?: number;
  byStatus?: Record<string, number>;
  error?: string;
};

export default function AdminNotificationsPage() {
  const { status } = useSession();
  const [items, setItems] = useState<OutboundNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState({
    channel: "",
    status: "",
    notificationType: "",
    source: "",
    chatId: "",
    search: "",
  });

  const selected = useMemo(
    () => items.find((i) => i.id === selectedId) || null,
    [items, selectedId]
  );
  const checkedIds = useMemo(
    () => Object.entries(selectedIds).filter(([, v]) => v).map(([id]) => id),
    [selectedIds]
  );

  const fetchItems = async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => {
        if (v) params.set(k, v);
      });
      params.set("limit", "200");
      const res = await fetch(`/api/admin/notifications?${params.toString()}`);
      const data = (await res.json()) as ApiResponse;
      if (!res.ok) throw new Error(data.error || "Failed to fetch notifications");
      setItems(data.items || []);
      setTotal(data.total || 0);
      if (data.items?.length && !selectedId) setSelectedId(data.items[0].id);
    } catch (e: any) {
      setError(e?.message || "Failed to fetch notifications");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (status === "authenticated") fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const runAction = async (action: "retry" | "cancel", ids: string[]) => {
    if (ids.length === 0) return;
    try {
      setBusy(true);
      const res = await fetch("/api/admin/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Action failed");
      await fetchItems();
      if (action === "cancel" || action === "retry") {
        // keep selection
      }
      setSelectedIds({});
    } catch (e: any) {
      setError(e?.message || "Action failed");
    } finally {
      setBusy(false);
    }
  };

  if (status === "loading") return <div className="p-6">Loading...</div>;
  if (status === "unauthenticated") return <div className="p-6">Access denied</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white">Outbound Notifications</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
            Unified per-recipient send history for Telegram, in-app, alerts, announcements, and admin sends.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link href="/admin/alerts" className="px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800">Alerts</Link>
          <Link href="/admin/utils/announcements" className="px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800">Announcements</Link>
          <button onClick={fetchItems} className="px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700">Refresh</button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>
      )}

      <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {([
            ["channel", "Channel"],
            ["status", "Status"],
            ["notificationType", "Type"],
            ["source", "Source"],
            ["chatId", "Chat ID"],
            ["search", "Search"],
          ] as const).map(([key, label]) => (
            <div key={key}>
              <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
              <input
                value={(filters as any)[key]}
                onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm"
                placeholder={label}
              />
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="text-sm text-gray-500">Total: {total} · Selected: {checkedIds.length}</div>
          <div className="flex items-center gap-2">
            <button
              disabled={busy || checkedIds.length === 0}
              onClick={() => runAction("retry", checkedIds)}
              className="px-3 py-2 text-sm rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
            >
              Retry selected
            </button>
            <button
              disabled={busy || checkedIds.length === 0}
              onClick={() => runAction("cancel", checkedIds)}
              className="px-3 py-2 text-sm rounded-lg border border-amber-200 text-amber-700 hover:bg-amber-50 disabled:opacity-50"
            >
              Cancel selected
            </button>
            <button
              onClick={fetchItems}
              className="px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              Apply filters
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-800 font-semibold">Send history</div>
          {loading ? (
            <div className="p-6 text-sm text-gray-500">Loading...</div>
          ) : items.length === 0 ? (
            <div className="p-6 text-sm text-gray-500">No outbound notifications found.</div>
          ) : (
            <div className="overflow-auto max-h-[70vh]">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-slate-800/60 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left w-10"></th>
                    <th className="px-3 py-2 text-left">Time</th>
                    <th className="px-3 py-2 text-left">Channel</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-left">Recipient</th>
                    <th className="px-3 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/40 ${selectedId === item.id ? "bg-blue-50/60 dark:bg-blue-900/10" : ""}`}
                      onClick={() => setSelectedId(item.id)}
                    >
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={!!selectedIds[item.id]}
                          onChange={(e) => setSelectedIds((s) => ({ ...s, [item.id]: e.target.checked }))}
                        />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-500">{new Date(item.createdAt).toLocaleString()}</td>
                      <td className="px-3 py-2">{item.channel}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{item.notificationType}</div>
                        <div className="text-xs text-gray-500 truncate max-w-[220px]">{item.source || ""}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <div>{item.chatId || item.recipientId || "-"}</div>
                        <div className="text-gray-500">{item.recipientType || ""}</div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                          item.status === "sent" || item.status === "delivered" ? "bg-green-100 text-green-700" :
                          item.status === "failed" ? "bg-red-100 text-red-700" :
                          item.status === "cancelled" ? "bg-gray-100 text-gray-700" :
                          item.status === "retry_requested" ? "bg-amber-100 text-amber-700" :
                          "bg-blue-100 text-blue-700"
                        }`}>
                          {item.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-800 font-semibold">Detail / message preview</div>
          {!selected ? (
            <div className="p-6 text-sm text-gray-500">Select a notification to view details.</div>
          ) : (
            <div className="p-4 space-y-4">
              <div className="flex items-center gap-2">
                <button
                  disabled={busy}
                  onClick={() => runAction("retry", [selected.id])}
                  className="px-3 py-2 text-sm rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                >
                  Retry
                </button>
                <button
                  disabled={busy}
                  onClick={() => runAction("cancel", [selected.id])}
                  className="px-3 py-2 text-sm rounded-lg border border-amber-200 text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-gray-500">ID:</span> <span className="font-mono text-xs">{selected.id}</span></div>
                <div><span className="text-gray-500">Status:</span> {selected.status}</div>
                <div><span className="text-gray-500">Channel:</span> {selected.channel}</div>
                <div><span className="text-gray-500">Type:</span> {selected.notificationType}</div>
                <div><span className="text-gray-500">Chat/Recipient:</span> {selected.chatId || selected.recipientId || "-"}</div>
                <div><span className="text-gray-500">Source:</span> {selected.source || "-"}</div>
                <div><span className="text-gray-500">Triggered by:</span> {selected.triggeredBy || "-"}</div>
                <div><span className="text-gray-500">Batch:</span> <span className="font-mono text-xs">{selected.batchId || "-"}</span></div>
                <div><span className="text-gray-500">Attempts:</span> {selected.attemptCount ?? 0}</div>
                <div><span className="text-gray-500">Created:</span> {new Date(selected.createdAt).toLocaleString()}</div>
              </div>

              {selected.title && (
                <div>
                  <div className="text-xs font-semibold text-gray-500 mb-1">Title</div>
                  <div className="text-sm font-medium">{selected.title}</div>
                </div>
              )}

              <div>
                <div className="text-xs font-semibold text-gray-500 mb-1">Message</div>
                <pre className="whitespace-pre-wrap break-words text-sm bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 rounded-lg p-3 max-h-64 overflow-auto">
{selected.message}
                </pre>
              </div>

              {selected.error && (
                <div>
                  <div className="text-xs font-semibold text-red-600 mb-1">Error</div>
                  <pre className="whitespace-pre-wrap break-words text-sm bg-red-50 border border-red-200 rounded-lg p-3">{selected.error}</pre>
                </div>
              )}

              <div>
                <div className="text-xs font-semibold text-gray-500 mb-1">Metadata / audit context</div>
                <pre className="whitespace-pre-wrap break-words text-xs bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 rounded-lg p-3 max-h-64 overflow-auto">
{JSON.stringify(selected.metadata || {}, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
