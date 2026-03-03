"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";

interface WatchlistItem {
  id: string;
  watchlistId: string;
  symbol: string;
  addedAt: string;
}

interface Watchlist {
  id: string;
  userId: number;
  name: string;
  createdAt: string;
  items: WatchlistItem[];
}

interface StockQuote {
  symbol: string;
  lastPrice: number;
  change: number;
  pChange: number;
  volume: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export default function WatchlistPage() {
  const { data: session, status } = useSession();
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [quotes, setQuotes] = useState<Record<string, StockQuote>>({});
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState<string | null>(null);
  const [newWatchlistName, setNewWatchlistName] = useState("");
  const [newSymbol, setNewSymbol] = useState("");
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (status === "authenticated") {
      fetchWatchlists();
    }
  }, [status]);

  useEffect(() => {
    if (watchlists.length > 0 && watchlists.some(w => w.items.length > 0)) {
      fetchQuotes();
    }
  }, [watchlists]);

  const fetchWatchlists = async () => {
    try {
      const response = await fetch("/api/user/watchlist");
      if (response.ok) {
        const data = await response.json();
        setWatchlists(data.watchlists || []);
      }
    } catch (err) {
      console.error("Failed to fetch watchlists:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchQuotes = async () => {
    const symbols = [...new Set(watchlists.flatMap(w => w.items.map(i => i.symbol)))];
    if (symbols.length === 0) return;

    setLoadingQuotes(true);
    try {
      const response = await fetch(`/api/quote?symbols=${symbols.join(",")}`);
      if (response.ok) {
        const data = await response.json();
        const quotesMap: Record<string, StockQuote> = {};
        data.forEach((quote: StockQuote) => {
          quotesMap[quote.symbol] = quote;
        });
        setQuotes(quotesMap);
      }
    } catch (err) {
      console.error("Failed to fetch quotes:", err);
    } finally {
      setLoadingQuotes(false);
    }
  };

  const handleCreateWatchlist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWatchlistName.trim()) return;

    setCreating(true);
    try {
      const response = await fetch("/api/user/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newWatchlistName }),
      });

      if (response.ok) {
        const newWatchlist = await response.json();
        setWatchlists([newWatchlist, ...watchlists]);
        setNewWatchlistName("");
        setShowCreateModal(false);
      }
    } catch (err) {
      console.error("Failed to create watchlist:", err);
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteWatchlist = async (id: string) => {
    if (!confirm("Are you sure you want to delete this watchlist?")) return;

    try {
      const response = await fetch(`/api/user/watchlist?id=${id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setWatchlists(watchlists.filter(w => w.id !== id));
      }
    } catch (err) {
      console.error("Failed to delete watchlist:", err);
    }
  };

  const handleAddSymbol = async (watchlistId: string, e: React.FormEvent) => {
    e.preventDefault();
    if (!newSymbol.trim()) return;

    setAdding(true);
    try {
      const response = await fetch(`/api/user/watchlist/${watchlistId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: newSymbol }),
      });

      if (response.ok) {
        const newItem = await response.json();
        setWatchlists(watchlists.map(w => {
          if (w.id === watchlistId) {
            return { ...w, items: [newItem, ...w.items] };
          }
          return w;
        }));
        setNewSymbol("");
        setShowAddModal(null);
        fetchQuotes();
      } else {
        const error = await response.json();
        alert(error.error || "Failed to add symbol");
      }
    } catch (err) {
      console.error("Failed to add symbol:", err);
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveSymbol = async (watchlistId: string, itemId: string, symbol: string) => {
    try {
      const response = await fetch(`/api/user/watchlist/${watchlistId}?itemId=${itemId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setWatchlists(watchlists.map(w => {
          if (w.id === watchlistId) {
            return { ...w, items: w.items.filter(i => i.id !== itemId) };
          }
          return w;
        }));
      }
    } catch (err) {
      console.error("Failed to remove symbol:", err);
    }
  };

  const formatPrice = (price: number | undefined) => {
    if (price === undefined || price === null) return "—";
    return price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatChange = (change: number | undefined, pChange: number | undefined) => {
    if (change === undefined || change === null || pChange === undefined || pChange === null) return "—";
    const sign = pChange >= 0 ? "+" : "";
    return `${sign}${change.toFixed(2)} (${sign}${pChange.toFixed(2)}%)`;
  };

  if (status === "loading" || loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Watchlist</h1>
        <div className="animate-pulse space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-gray-200 dark:bg-slate-800 h-32 rounded-lg"></div>
          ))}
        </div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Watchlist</h1>
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-8 text-center">
          <p className="text-gray-600 dark:text-gray-400">Please sign in to view your watchlist.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Watchlist</h1>
        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          Create Watchlist
        </button>
      </div>

      {watchlists.length === 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-8 text-center">
          <p className="text-gray-600 dark:text-gray-400 mb-4">You haven't created any watchlists yet.</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Create Your First Watchlist
          </button>
        </div>
      )}

      <div className="grid gap-6">
        {watchlists.map((watchlist) => (
          <div key={watchlist.id} className="bg-white dark:bg-slate-900 rounded-lg shadow overflow-hidden">
            <div className="px-4 py-3 sm:px-6 border-b border-gray-200 dark:border-slate-700 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {watchlist.name}
                <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
                  ({watchlist.items.length} {watchlist.items.length === 1 ? "stock" : "stocks"})
                </span>
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowAddModal(watchlist.id)}
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  + Add Symbol
                </button>
                <button
                  onClick={() => handleDeleteWatchlist(watchlist.id)}
                  className="text-sm text-red-600 dark:text-red-400 hover:underline"
                >
                  Delete
                </button>
              </div>
            </div>

            {watchlist.items.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                No stocks in this watchlist. Click "Add Symbol" to add stocks.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-800">
                  <thead className="bg-gray-50 dark:bg-slate-800/50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Symbol
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Last Price
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Change
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Volume
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Open
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        High
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Low
                      </th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-800">
                    {watchlist.items.map((item) => {
                      const quote = quotes[item.symbol];
                      const isPositive = quote && quote.pChange >= 0;
                      return (
                        <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                          <td className="px-4 py-3">
                            <a
                              href={`/company/${item.symbol}`}
                              className="text-blue-600 dark:text-blue-400 font-medium hover:underline"
                            >
                              {item.symbol}
                            </a>
                          </td>
                          <td className="px-4 py-3 text-right text-gray-900 dark:text-white">
                            {loadingQuotes ? "..." : `₹${formatPrice(quote?.lastPrice)}`}
                          </td>
                          <td className={`px-4 py-3 text-right ${isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                            {loadingQuotes ? "..." : formatChange(quote?.change, quote?.pChange)}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">
                            {loadingQuotes ? "..." : quote?.volume?.toLocaleString("en-IN") || "—"}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">
                            {loadingQuotes ? "..." : `₹${formatPrice(quote?.open)}`}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">
                            {loadingQuotes ? "..." : `₹${formatPrice(quote?.high)}`}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">
                            {loadingQuotes ? "..." : `₹${formatPrice(quote?.low)}`}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => handleRemoveSymbol(watchlist.id, item.id, item.symbol)}
                              className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-screen items-center justify-center p-4">
            <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setShowCreateModal(false)}></div>
            <div className="relative bg-white dark:bg-slate-900 rounded-lg shadow-xl w-full max-w-md p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Create New Watchlist
              </h3>
              <form onSubmit={handleCreateWatchlist}>
                <input
                  type="text"
                  value={newWatchlistName}
                  onChange={(e) => setNewWatchlistName(e.target.value)}
                  placeholder="Watchlist name (e.g., F&O, Bluechip, etc.)"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-800 dark:text-white mb-4"
                  autoFocus
                />
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="bg-gray-500 dark:bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-600 dark:hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creating || !newWatchlistName.trim()}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {creating ? "Creating..." : "Create"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-screen items-center justify-center p-4">
            <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setShowAddModal(null)}></div>
            <div className="relative bg-white dark:bg-slate-900 rounded-lg shadow-xl w-full max-w-md p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Add Symbol to Watchlist
              </h3>
              <form onSubmit={(e) => handleAddSymbol(showAddModal, e)}>
                <input
                  type="text"
                  value={newSymbol}
                  onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                  placeholder="Enter stock symbol (e.g., RELIANCE)"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-800 dark:text-white mb-4"
                  autoFocus
                />
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(null)}
                    className="bg-gray-500 dark:bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-600 dark:hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={adding || !newSymbol.trim()}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {adding ? "Adding..." : "Add"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
