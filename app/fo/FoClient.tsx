"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { FOComputedPosition, OptionGreeks, computeGreeks, timeToExpiry } from "@/lib/services/foPnlService";
import FOPnlSummary from "../components/fo/FOPnlSummary";
import FOPositionTable from "../components/fo/FOPositionTable";
import AddPositionForm from "../components/fo/AddPositionForm";
import GreekCards from "../components/fo/GreekCards";
import OptionChainViewer from "../components/fo/OptionChainViewer";
import ExpiryCalendar from "../components/fo/ExpiryCalendar";

interface Summary {
  totalPositions: number;
  openPositions: number;
  closedPositions: number;
  totalPnl: number;
  longCount: number;
  shortCount: number;
  futuresCount: number;
  optionsCount: number;
}

type Tab = "positions" | "chain" | "expiries";

const TABS: { id: Tab; label: string }[] = [
  { id: "positions", label: "Positions" },
  { id: "chain", label: "Option Chain" },
  { id: "expiries", label: "Expiry Calendar" },
];

export default function FoClient() {
  const { status } = useSession();
  const [tab, setTab] = useState<Tab>("positions");
  const [positions, setPositions] = useState<FOComputedPosition[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chainSymbol, setChainSymbol] = useState("NIFTY");

  const fetchPositions = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch("/api/fo/positions");
      if (res.status === 401) {
        setError("Please sign in to view your F&O positions.");
        return;
      }
      if (!res.ok) throw new Error("Failed to fetch positions");
      const data = await res.json();
      setPositions(data.computed || []);
      setSummary(data.summary || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch positions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") fetchPositions();
    else setLoading(status === "loading");
  }, [status, fetchPositions]);

  const selected = positions.find((p) => p.id === selectedId) || positions.find((p) => p.status === "OPEN") || null;

  const computeSelectedGreeks = (): OptionGreeks | null => {
    if (!selected || (selected.type !== "CALL" && selected.type !== "PUT")) return null;
    if (selected.strike == null || selected.expiry == null) return null;
    const T = timeToExpiry(selected.expiry);
    if (T <= 0) return null;
    const S = selected.currentPrice ?? selected.entryPrice;
    return computeGreeks(selected.type as "CALL" | "PUT", S, selected.strike, T);
  };

  const handleClose = async (id: string, currentPrice: number) => {
    if (!confirm(`Close this position at ₹${currentPrice}?`)) return;
    try {
      const res = await fetch(`/api/fo/positions/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CLOSED", closePrice: currentPrice, closeDate: new Date().toISOString() }),
      });
      if (res.ok) fetchPositions();
    } catch (err) {
      console.error("Failed to close position:", err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this position? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/fo/positions/${id}`, { method: "DELETE" });
      if (res.ok) {
        if (selectedId === id) setSelectedId(null);
        fetchPositions();
      }
    } catch (err) {
      console.error("Failed to delete position:", err);
    }
  };

  const greeks = computeSelectedGreeks();

  return (
    <div className="space-y-6">
      {/* Tab strip */}
      <div className="flex flex-wrap gap-2 border-b border-gray-200 dark:border-slate-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
              tab === t.id
                ? "text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400"
                : "text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "positions" && (
        <div className="space-y-6">
          <FOPnlSummary positions={positions} />

          {summary ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Open Positions" value={String(summary.openPositions)} />
              <Stat label="Closed" value={String(summary.closedPositions)} />
              <Stat label="Futures / Options" value={`${summary.futuresCount} / ${summary.optionsCount}`} />
              <Stat label="Long / Short" value={`${summary.longCount} / ${summary.shortCount}`} />
            </div>
          ) : null}

          {greeks && selected ? (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                Greeks — {selected.symbol} {selected.type} {selected.strike} ({selected.direction})
              </h3>
              <GreekCards greeks={greeks} direction={(selected.direction as "LONG" | "SHORT")} />
            </div>
          ) : null}

          {error && !loading ? (
            <p className="text-center py-8 text-red-600 dark:text-red-400">{error}</p>
          ) : null}

          <div className="flex justify-end">
            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
            >
              + Add Position
            </button>
          </div>

          <FOPositionTable positions={positions} loading={loading} onClose={handleClose} onDelete={handleDelete} />
        </div>
      )}

      {tab === "chain" && (
        <OptionChainViewer symbol={chainSymbol} onSymbolChange={setChainSymbol} />
      )}

      {tab === "expiries" && <ExpiryCalendar />}

      {showAddModal && (
        <AddPositionForm
          onClose={() => setShowAddModal(false)}
          onCreated={() => {
            setShowAddModal(false);
            fetchPositions();
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-3">
      <p className="text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-lg font-bold text-gray-900 dark:text-white mt-0.5">{value}</p>
    </div>
  );
}
