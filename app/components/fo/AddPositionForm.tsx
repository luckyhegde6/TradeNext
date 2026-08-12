"use client";

import { useState } from "react";
import { FO_ELIGIBLE_SYMBOLS } from "@/lib/services/foSymbols";

interface AddPositionFormProps {
  onClose: () => void;
  onCreated: () => void;
}

/**
 * Modal form to add a new F&O position (futures/options, long/short).
 * POSTs to /api/fo/positions then refreshes the list.
 */
export default function AddPositionForm({ onClose, onCreated }: AddPositionFormProps) {
  const [symbol, setSymbol] = useState("NIFTY");
  const [type, setType] = useState<"FUTURES" | "CALL" | "PUT">("FUTURES");
  const [direction, setDirection] = useState<"LONG" | "SHORT">("LONG");
  const [quantity, setQuantity] = useState("1");
  const [entryPrice, setEntryPrice] = useState("");
  const [strike, setStrike] = useState("");
  const [expiry, setExpiry] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const qty = parseInt(quantity, 10);
    const price = parseFloat(entryPrice);
    if (!qty || qty <= 0) {
      setError("Quantity must be a positive whole number.");
      return;
    }
    if (!price || price <= 0) {
      setError("Entry price is required.");
      return;
    }
    if ((type === "CALL" || type === "PUT") && !strike) {
      setError("Strike price is required for options.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/fo/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          type,
          direction,
          quantity: qty,
          entryPrice: price,
          strike: type === "FUTURES" ? undefined : parseFloat(strike),
          expiry: expiry || undefined,
          notes: notes || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create position.");
        return;
      }
      onCreated();
    } catch (err) {
      setError("Network error — could not create position.");
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500";
  const labelCls = "block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Add F&O Position</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Symbol</label>
              <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className={inputCls}>
                {FO_ELIGIBLE_SYMBOLS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Type</label>
              <select value={type} onChange={(e) => setType(e.target.value as any)} className={inputCls}>
                <option value="FUTURES">Futures</option>
                <option value="CALL">Call Option</option>
                <option value="PUT">Put Option</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Direction</label>
              <select value={direction} onChange={(e) => setDirection(e.target.value as any)} className={inputCls}>
                <option value="LONG">Long</option>
                <option value="SHORT">Short</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Quantity</label>
              <input type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Entry Price (₹)</label>
              <input type="number" min="0" step="0.05" value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} className={inputCls} placeholder="e.g. 24200" />
            </div>
            {type !== "FUTURES" ? (
              <div key="strike">
                <label className={labelCls}>Strike (₹)</label>
                <input type="number" min="0" step="5" value={strike} onChange={(e) => setStrike(e.target.value)} className={inputCls} placeholder="e.g. 24500" />
              </div>
            ) : (
              <div key="premium">
                <label className={labelCls}>Premium (₹, optional)</label>
                <input type="number" min="0" step="0.05" className={inputCls} disabled placeholder="Futures only" />
              </div>
            )}
          </div>

          <div>
            <label className={labelCls}>Expiry (optional)</label>
            <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={inputCls} />
          </div>

          <div>
            <label className={labelCls}>Notes (optional)</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} placeholder="Strategy, hedge context, etc." />
          </div>

          {error ? (
            <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg p-2">{error}</p>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-medium"
            >
              {saving ? "Saving…" : "Add Position"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
