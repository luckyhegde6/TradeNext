"use client";

import { useState, useEffect, useCallback } from "react";

interface AlertEvent {
  id: string;
  ruleId: string;
  ruleName: string;
  symbol: string | null;
  status: "delivered" | "failed" | "pending";
  message: string;
  triggeredAt: string;
  acknowledgedAt: string | null;
  deliveryChannels: { channelId: string; channelType: string; success: boolean; error?: string }[];
}

const STATUS_COLORS: Record<string, string> = {
  delivered: "text-green-600 bg-green-50 dark:bg-green-900/20",
  failed: "text-red-600 bg-red-50 dark:bg-red-900/20",
  pending: "text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20",
};

export default function EventHistory() {
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const limit = 25;

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(page * limit),
      });
      if (statusFilter) params.set("status", statusFilter);

      const res = await fetch(`/api/alerts/events?${params}`);
      if (!res.ok) throw new Error("Failed to fetch events");
      const data = await res.json();
      setEvents(data.events || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load events");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const acknowledgeAll = async () => {
    // Acknowledge all events for the current filter
    // We do one at a time or ask user to select
    if (!confirm("Mark all events in current view as acknowledged?")) return;
    try {
      const uniqueRuleIds = [...new Set(events.map((e) => e.ruleId))];
      for (const ruleId of uniqueRuleIds) {
        await fetch("/api/alerts/events?action=acknowledge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ruleId }),
        });
      }
      fetchEvents();
    } catch (err) {
      console.error("Failed to acknowledge events:", err);
    }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground">{total} events</p>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(0);
            }}
            className="p-1.5 text-sm border border-border rounded bg-background"
          >
            <option value="">All Status</option>
            <option value="delivered">Delivered</option>
            <option value="failed">Failed</option>
            <option value="pending">Pending</option>
          </select>
        </div>
        <button
          onClick={acknowledgeAll}
          className="px-3 py-1.5 text-sm border border-border rounded hover:bg-muted"
        >
          Acknowledge All
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded mb-4 text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-center py-8 text-muted-foreground">Loading events...</div>
      )}

      {/* Empty */}
      {!loading && events.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg mb-2">No events yet</p>
          <p className="text-sm">Events will appear here when alerts are triggered</p>
        </div>
      )}

      {/* Events list */}
      {!loading && events.length > 0 && (
        <>
          <div className="space-y-3">
            {events.map((ev) => (
              <div
                key={ev.id}
                className={`bg-card border rounded-lg p-4 ${
                  !ev.acknowledgedAt ? "border-l-4 border-l-blue-500" : "border-border"
                }`}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-1.5 py-0.5 text-xs rounded font-medium ${STATUS_COLORS[ev.status] || ""}`}
                      >
                        {ev.status}
                      </span>
                      <span className="font-semibold text-sm">{ev.ruleName}</span>
                      {ev.symbol && (
                        <span className="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200 rounded">
                          {ev.symbol}
                        </span>
                      )}
                      {!ev.acknowledgedAt && (
                        <span className="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">
                          New
                        </span>
                      )}
                    </div>
                    <p className="text-sm mt-1">{ev.message}</p>

                    {/* Delivery channels */}
                    {ev.deliveryChannels && ev.deliveryChannels.length > 0 && (
                      <div className="flex items-center gap-2 mt-2">
                        {ev.deliveryChannels.map((dc, i) => (
                          <span
                            key={i}
                            className={`text-xs px-1.5 py-0.5 rounded ${
                              dc.success
                                ? "bg-green-50 text-green-700 dark:bg-green-900/20"
                                : "bg-red-50 text-red-700 dark:bg-red-900/20"
                            }`}
                          >
                            {dc.channelType === "email" ? "📧" : "🔗"} {dc.success ? "✓" : "✗"}
                            {dc.error && ` (${dc.error})`}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="text-xs text-muted-foreground mt-2">
                      Triggered: {new Date(ev.triggeredAt).toLocaleString()}
                      {ev.acknowledgedAt && (
                        <> • Acknowledged: {new Date(ev.acknowledgedAt).toLocaleString()}</>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-2 mt-6">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="px-3 py-1 text-sm border border-border rounded hover:bg-muted disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-sm text-muted-foreground">
                Page {page + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                disabled={page >= totalPages - 1}
                className="px-3 py-1 text-sm border border-border rounded hover:bg-muted disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
