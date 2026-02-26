"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";

interface StockFilter {
  sector?: string;
  marketCap?: { min?: number; max?: number };
  peRatio?: { min?: number; max?: number };
  price?: { min?: number; max?: number };
  volume?: { min?: number };
  change?: { min?: number; max?: number };
  dividendYield?: { min?: number };
  stockType?: 'all' | 'nifty50' | 'nifty100' | 'nifty200' | 'nifty500';
}

interface Stock {
  symbol: string;
  companyName: string;
  sector: string;
  lastPrice: number;
  change: number;
  percentChange: number;
  volume: number;
  marketCap: number;
  peRatio: number;
}

const SECTORS = [
  "Automobiles",
  "Banks",
  "Capital Goods",
  "Consumer Goods",
  "Financial Services",
  "Healthcare",
  "IT",
  "Metals",
  "Oil & Gas",
  "Pharmaceuticals",
  "Power",
  "Telecommunications",
  "Textiles",
  "Other"
];

export default function StockScreener() {
  const { data: session } = useSession();
  const [filters, setFilters] = useState<StockFilter>({});
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [sortBy, setSortBy] = useState('symbol');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [savedScreens, setSavedScreens] = useState<{ id: number; name: string; filters: StockFilter }[]>([]);
  const [screenName, setScreenName] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  useEffect(() => {
    fetchStocks();
    if (session) {
      fetchSavedScreens();
    }
  }, [filters, page, sortBy, sortOrder]);

  const fetchStocks = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '50',
      });

      const res = await fetch(`/api/screener?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters, sortBy, sortOrder })
      });

      const data = await res.json();
      if (data.stocks) {
        setStocks(data.stocks);
        setTotalPages(data.pagination?.totalPages || 1);
      }
    } catch (error) {
      console.error('Failed to fetch stocks:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSavedScreens = async () => {
    try {
      const res = await fetch('/api/screener/saved');
      const data = await res.json();
      if (data.savedScreens) {
        setSavedScreens(data.savedScreens);
      }
    } catch (error) {
      console.error('Failed to fetch saved screens:', error);
    }
  };

  const saveScreen = async () => {
    if (!screenName.trim()) return;
    try {
      const res = await fetch('/api/screener/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: screenName, filters })
      });
      if (res.ok) {
        setShowSaveDialog(false);
        setScreenName('');
        fetchSavedScreens();
      }
    } catch (error) {
      console.error('Failed to save screen:', error);
    }
  };

  const loadScreen = (screen: { filters: StockFilter }) => {
    setFilters(screen.filters);
    setPage(1);
  };

  const deleteScreen = async (id: number) => {
    try {
      await fetch(`/api/screener/saved?id=${id}`, { method: 'DELETE' });
      fetchSavedScreens();
    } catch (error) {
      console.error('Failed to delete screen:', error);
    }
  };

  const updateFilter = (key: keyof StockFilter, value: unknown) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const clearFilters = () => {
    setFilters({});
    setPage(1);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Stock Screener</h1>
          <button
            onClick={() => setShowSaveDialog(true)}
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90"
          >
            Save Screen
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-1 space-y-4">
            <div className="bg-card border border-border rounded-lg p-4">
              <h3 className="font-semibold mb-4">Filters</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Sector</label>
                  <select
                    className="w-full p-2 border border-border rounded bg-background"
                    value={filters.sector || ''}
                    onChange={(e) => updateFilter('sector', e.target.value || undefined)}
                  >
                    <option value="">All Sectors</option>
                    {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Price Range</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="Min"
                      className="w-full p-2 border border-border rounded bg-background text-sm"
                      value={filters.price?.min || ''}
                      onChange={(e) => updateFilter('price', { ...filters.price, min: e.target.value ? Number(e.target.value) : undefined })}
                    />
                    <input
                      type="number"
                      placeholder="Max"
                      className="w-full p-2 border border-border rounded bg-background text-sm"
                      value={filters.price?.max || ''}
                      onChange={(e) => updateFilter('price', { ...filters.price, max: e.target.value ? Number(e.target.value) : undefined })}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">P/E Ratio</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="Min"
                      className="w-full p-2 border border-border rounded bg-background text-sm"
                      value={filters.peRatio?.min || ''}
                      onChange={(e) => updateFilter('peRatio', { ...filters.peRatio, min: e.target.value ? Number(e.target.value) : undefined })}
                    />
                    <input
                      type="number"
                      placeholder="Max"
                      className="w-full p-2 border border-border rounded bg-background text-sm"
                      value={filters.peRatio?.max || ''}
                      onChange={(e) => updateFilter('peRatio', { ...filters.peRatio, max: e.target.value ? Number(e.target.value) : undefined })}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Volume (Min)</label>
                  <input
                    type="number"
                    className="w-full p-2 border border-border rounded bg-background text-sm"
                    value={filters.volume?.min || ''}
                    onChange={(e) => updateFilter('volume', { min: e.target.value ? Number(e.target.value) : undefined })}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">% Change</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="Min"
                      className="w-full p-2 border border-border rounded bg-background text-sm"
                      value={filters.change?.min || ''}
                      onChange={(e) => updateFilter('change', { ...filters.change, min: e.target.value ? Number(e.target.value) : undefined })}
                    />
                    <input
                      type="number"
                      placeholder="Max"
                      className="w-full p-2 border border-border rounded bg-background text-sm"
                      value={filters.change?.max || ''}
                      onChange={(e) => updateFilter('change', { ...filters.change, max: e.target.value ? Number(e.target.value) : undefined })}
                    />
                  </div>
                </div>

                <button
                  onClick={clearFilters}
                  className="w-full py-2 text-sm border border-border rounded hover:bg-muted"
                >
                  Clear Filters
                </button>
              </div>
            </div>

            {savedScreens.length > 0 && (
              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="font-semibold mb-4">Saved Screens</h3>
                <div className="space-y-2">
                  {savedScreens.map(screen => (
                    <div key={screen.id} className="flex justify-between items-center p-2 bg-muted rounded">
                      <button
                        onClick={() => loadScreen(screen)}
                        className="text-sm hover:underline"
                      >
                        {screen.name}
                      </button>
                      <button
                        onClick={() => deleteScreen(screen.id)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="lg:col-span-3">
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="p-4 border-b border-border flex justify-between items-center">
                <div className="flex gap-2 items-center">
                  <span className="text-sm">Sort by:</span>
                  <select
                    className="p-2 border border-border rounded bg-background text-sm"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                  >
                    <option value="symbol">Symbol</option>
                    <option value="lastPrice">Price</option>
                    <option value="change">Change</option>
                    <option value="percentChange">% Change</option>
                    <option value="volume">Volume</option>
                    <option value="marketCap">Market Cap</option>
                  </select>
                  <button
                    onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                    className="p-2 border border-border rounded"
                  >
                    {sortOrder === 'asc' ? '↑' : '↓'}
                  </button>
                </div>
                <span className="text-sm text-muted-foreground">
                  {stocks.length} stocks
                </span>
              </div>

              {loading ? (
                <div className="p-8 text-center">Loading...</div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-muted">
                        <tr>
                          <th className="p-3 text-left text-sm font-medium">Symbol</th>
                          <th className="p-3 text-left text-sm font-medium">Sector</th>
                          <th className="p-3 text-right text-sm font-medium">Price</th>
                          <th className="p-3 text-right text-sm font-medium">Change</th>
                          <th className="p-3 text-right text-sm font-medium">Volume</th>
                          <th className="p-3 text-right text-sm font-medium">P/E</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stocks.map(stock => (
                          <tr key={stock.symbol} className="border-t border-border hover:bg-muted/50">
                            <td className="p-3">
                              <a href={`/company/${stock.symbol}`} className="font-medium hover:underline">
                                {stock.symbol}
                              </a>
                              <p className="text-xs text-muted-foreground truncate max-w-[150px]">
                                {stock.companyName}
                              </p>
                            </td>
                            <td className="p-3 text-sm">{stock.sector || '-'}</td>
                            <td className="p-3 text-right">₹{stock.lastPrice?.toLocaleString() || '-'}</td>
                            <td className={`p-3 text-right ${(stock.change || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                              {stock.change >= 0 ? '+' : ''}{stock.change?.toFixed(2) || '-'}
                              <span className="text-xs ml-1">({stock.percentChange >= 0 ? '+' : ''}{stock.percentChange?.toFixed(2) || '-'}%)</span>
                            </td>
                            <td className="p-3 text-right text-sm">{(stock.volume || 0).toLocaleString()}</td>
                            <td className="p-3 text-right text-sm">{stock.peRatio?.toFixed(2) || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="p-4 border-t border-border flex justify-center gap-2">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="px-3 py-1 border border-border rounded disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <span className="px-3 py-1 text-sm">
                      Page {page} of {totalPages}
                    </span>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="px-3 py-1 border border-border rounded disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {showSaveDialog && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-card p-6 rounded-lg w-96">
              <h3 className="text-lg font-semibold mb-4">Save Screen</h3>
              <input
                type="text"
                placeholder="Screen name"
                className="w-full p-2 border border-border rounded mb-4"
                value={screenName}
                onChange={(e) => setScreenName(e.target.value)}
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowSaveDialog(false)}
                  className="px-4 py-2 border border-border rounded"
                >
                  Cancel
                </button>
                <button
                  onClick={saveScreen}
                  className="px-4 py-2 bg-primary text-white rounded"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
