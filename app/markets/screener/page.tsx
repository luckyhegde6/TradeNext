"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";

interface StockFilter {
  // Basic filters
  sector?: string;
  industry?: string;
  price?: { min?: number; max?: number };
  volume?: { min?: number };
  relativeVolume?: { min?: number };
  change?: { min?: number; max?: number };
  
  // Performance filters
  perfWeek?: { min?: number; max?: number };
  perfMonth?: { min?: number; max?: number };
  
  // Fundamental filters
  marketCap?: { min?: number; max?: number };
  peRatio?: { min?: number; max?: number };
  pbRatio?: { min?: number; max?: number };
  dividendYield?: { min?: number };
  roe?: { min?: number };
  debtToEquity?: { max?: number };
  beta?: { min?: number; max?: number };
  
  // Preset filters
  preset?: 'all' | 'nifty50' | 'highVolume' | 'topGainers' | 'topLosers' | 'valueStocks' | 'growthStocks' | 'highDividend';
}

interface Stock {
  symbol: string;
  name: string;
  description: string;
  sector: string;
  industry: string;
  close: number;
  change: number;
  percentChange: number;
  volume: number;
  market_cap: number;
  pe: number;
  pb: number;
  dividend_yield: number;
  technical_rating: string;
  recommendation: string;
  perfW?: number;
  perfM?: number;
  relativeVolume?: number;
  roe?: number;
  beta?: number;
}

const SECTORS = [
  "Automobiles",
  "Banks",
  "Capital Goods",
  "Construction",
  "Consumer Goods",
  "Financial Services",
  "Healthcare",
  "Hospitality",
  "Infrastructure",
  "IT",
  "Media & Entertainment",
  "Metals & Mining",
  "Oil Gas & Consumable Fuels",
  "Pharmaceuticals",
  "Power",
  "Retail",
  "Telecommunications",
  "Textiles",
  "Other"
];

const PRESET_OPTIONS = [
  { value: 'all', label: 'All Stocks' },
  { value: 'highVolume', label: 'High Volume (1.5x+)' },
  { value: 'topGainers', label: 'Top Gainers (3%+)' },
  { value: 'topLosers', label: 'Top Losers (3%-)' },
  { value: 'valueStocks', label: 'Value Stocks (Low P/E, P/B)' },
  { value: 'growthStocks', label: 'Growth Stocks (P/E 15-60)' },
  { value: 'highDividend', label: 'High Dividend (3%+)' },
];

const MARKET_CAP_RANGES = [
  { value: '', label: 'Any' },
  { value: 'largecap', label: 'Large Cap (>20,000 Cr)' },
  { value: 'midcap', label: 'Mid Cap (500-20,000 Cr)' },
  { value: 'smallcap', label: 'Small Cap (<500 Cr)' },
];

export default function StockScreener() {
  const { data: session } = useSession();
  const [filters, setFilters] = useState<StockFilter>({ preset: 'all' });
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [sortBy, setSortBy] = useState('market_cap');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [savedScreens, setSavedScreens] = useState<{ id: number; name: string; filters: StockFilter }[]>([]);
  const [screenName, setScreenName] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    fetchStocks();
  }, [filters, page, sortBy, sortOrder]);

  useEffect(() => {
    if (session) {
      fetchSavedScreens();
    }
  }, [session]);

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
        setTotalCount(data.pagination?.total || 0);
        setLastSynced(data.lastSyncedAt);
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

  const handleMarketCapRange = (range: string) => {
    if (!range) {
      updateFilter('marketCap', undefined);
    } else if (range === 'largecap') {
      updateFilter('marketCap', { min: 20000 });
    } else if (range === 'midcap') {
      updateFilter('marketCap', { min: 500, max: 20000 });
    } else if (range === 'smallcap') {
      updateFilter('marketCap', { max: 500 });
    }
  };

  const clearFilters = () => {
    setFilters({ preset: 'all' });
    setPage(1);
  };

  const activeFilterCount = Object.entries(filters).filter(([key, val]) => {
    if (key === 'preset') return false;
    if (typeof val === 'object' && val !== null) {
      return Object.values(val).some(v => v !== undefined);
    }
    return val !== undefined;
  }).length;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-6">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold">Stock Screener</h1>
            {lastSynced && (
              <p className="text-xs text-muted-foreground">
                Last synced from TradingView: {new Date(lastSynced).toLocaleString()}
              </p>
            )}
          </div>
          <button
            onClick={() => setShowSaveDialog(true)}
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90"
          >
            Save Screen
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-1 space-y-4">
            {/* Preset Filters */}
            <div className="bg-card border border-border rounded-lg p-4">
              <h3 className="font-semibold mb-4">Quick Filters</h3>
              <div className="space-y-2">
                {PRESET_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => updateFilter('preset', opt.value as StockFilter['preset'])}
                    className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                      filters.preset === opt.value 
                        ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-medium' 
                        : 'hover:bg-muted'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Basic Filters */}
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold">Basic Filters</h3>
                {activeFilterCount > 0 && (
                  <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">
                    {activeFilterCount} active
                  </span>
                )}
              </div>

              <div className="space-y-4">
                {/* Market Cap Range */}
                <div>
                  <label className="block text-sm font-medium mb-1">Market Cap</label>
                  <select
                    className="w-full p-2 border border-border rounded bg-background text-sm"
                    value={
                      filters.marketCap?.min
                        ? filters.marketCap.max
                          ? filters.marketCap.min >= 20000 ? 'largecap' : filters.marketCap.max <= 500 ? 'smallcap' : 'midcap'
                          : 'largecap'
                        : filters.marketCap?.max !== undefined && filters.marketCap.max <= 500 ? 'smallcap' : ''
                    }
                    onChange={(e) => handleMarketCapRange(e.target.value)}
                  >
                    {MARKET_CAP_RANGES.map(r => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>

                {/* Sector */}
                <div>
                  <label className="block text-sm font-medium mb-1">Sector</label>
                  <select
                    className="w-full p-2 border border-border rounded bg-background text-sm"
                    value={filters.sector || ''}
                    onChange={(e) => updateFilter('sector', e.target.value || undefined)}
                  >
                    <option value="">All Sectors</option>
                    {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                {/* Price Range */}
                <div>
                  <label className="block text-sm font-medium mb-1">Price (₹)</label>
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

                {/* P/E Ratio */}
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

                {/* % Change */}
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

                {/* Volume */}
                <div>
                  <label className="block text-sm font-medium mb-1">Volume (Min)</label>
                  <input
                    type="number"
                    placeholder="e.g. 1000000"
                    className="w-full p-2 border border-border rounded bg-background text-sm"
                    value={filters.volume?.min || ''}
                    onChange={(e) => updateFilter('volume', { min: e.target.value ? Number(e.target.value) : undefined })}
                  />
                </div>

                {/* Relative Volume */}
                <div>
                  <label className="block text-sm font-medium mb-1">Rel. Volume (Min)</label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="e.g. 1.5"
                    className="w-full p-2 border border-border rounded bg-background text-sm"
                    value={filters.relativeVolume?.min || ''}
                    onChange={(e) => updateFilter('relativeVolume', { min: e.target.value ? Number(e.target.value) : undefined })}
                  />
                </div>

                <button
                  onClick={clearFilters}
                  className="w-full py-2 text-sm border border-border rounded hover:bg-muted"
                >
                  Clear All Filters
                </button>
              </div>
            </div>

            {/* Advanced Filters - Collapsible */}
            <div className="bg-card border border-border rounded-lg p-4">
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="w-full flex justify-between items-center font-semibold mb-4"
              >
                <span>Advanced Filters</span>
                <span className="text-muted-foreground">{showAdvanced ? '▲' : '▼'}</span>
              </button>

              {showAdvanced && (
                <div className="space-y-4">
                  {/* P/B Ratio */}
                  <div>
                    <label className="block text-sm font-medium mb-1">P/B Ratio</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        step="0.1"
                        placeholder="Min"
                        className="w-full p-2 border border-border rounded bg-background text-sm"
                        value={filters.pbRatio?.min || ''}
                        onChange={(e) => updateFilter('pbRatio', { ...filters.pbRatio, min: e.target.value ? Number(e.target.value) : undefined })}
                      />
                      <input
                        type="number"
                        step="0.1"
                        placeholder="Max"
                        className="w-full p-2 border border-border rounded bg-background text-sm"
                        value={filters.pbRatio?.max || ''}
                        onChange={(e) => updateFilter('pbRatio', { ...filters.pbRatio, max: e.target.value ? Number(e.target.value) : undefined })}
                      />
                    </div>
                  </div>

                  {/* Dividend Yield */}
                  <div>
                    <label className="block text-sm font-medium mb-1">Div. Yield (%) Min</label>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="e.g. 2"
                      className="w-full p-2 border border-border rounded bg-background text-sm"
                      value={filters.dividendYield?.min || ''}
                      onChange={(e) => updateFilter('dividendYield', { min: e.target.value ? Number(e.target.value) : undefined })}
                    />
                  </div>

                  {/* ROE */}
                  <div>
                    <label className="block text-sm font-medium mb-1">ROE (%) Min</label>
                    <input
                      type="number"
                      step="1"
                      placeholder="e.g. 15"
                      className="w-full p-2 border border-border rounded bg-background text-sm"
                      value={filters.roe?.min || ''}
                      onChange={(e) => updateFilter('roe', { min: e.target.value ? Number(e.target.value) : undefined })}
                    />
                  </div>

                  {/* Debt/Equity */}
                  <div>
                    <label className="block text-sm font-medium mb-1">D/E Max</label>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="e.g. 2"
                      className="w-full p-2 border border-border rounded bg-background text-sm"
                      value={filters.debtToEquity?.max || ''}
                      onChange={(e) => updateFilter('debtToEquity', { max: e.target.value ? Number(e.target.value) : undefined })}
                    />
                  </div>

                  {/* Beta */}
                  <div>
                    <label className="block text-sm font-medium mb-1">Beta</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        step="0.1"
                        placeholder="Min"
                        className="w-full p-2 border border-border rounded bg-background text-sm"
                        value={filters.beta?.min || ''}
                        onChange={(e) => updateFilter('beta', { ...filters.beta, min: e.target.value ? Number(e.target.value) : undefined })}
                      />
                      <input
                        type="number"
                        step="0.1"
                        placeholder="Max"
                        className="w-full p-2 border border-border rounded bg-background text-sm"
                        value={filters.beta?.max || ''}
                        onChange={(e) => updateFilter('beta', { ...filters.beta, max: e.target.value ? Number(e.target.value) : undefined })}
                      />
                    </div>
                  </div>

                  {/* Weekly Performance */}
                  <div>
                    <label className="block text-sm font-medium mb-1">Weekly Perf. (%)</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        step="0.1"
                        placeholder="Min"
                        className="w-full p-2 border border-border rounded bg-background text-sm"
                        value={filters.perfWeek?.min || ''}
                        onChange={(e) => updateFilter('perfWeek', { ...filters.perfWeek, min: e.target.value ? Number(e.target.value) : undefined })}
                      />
                      <input
                        type="number"
                        step="0.1"
                        placeholder="Max"
                        className="w-full p-2 border border-border rounded bg-background text-sm"
                        value={filters.perfWeek?.max || ''}
                        onChange={(e) => updateFilter('perfWeek', { ...filters.perfWeek, max: e.target.value ? Number(e.target.value) : undefined })}
                      />
                    </div>
                  </div>

                  {/* Monthly Performance */}
                  <div>
                    <label className="block text-sm font-medium mb-1">Monthly Perf. (%)</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        step="0.1"
                        placeholder="Min"
                        className="w-full p-2 border border-border rounded bg-background text-sm"
                        value={filters.perfMonth?.min || ''}
                        onChange={(e) => updateFilter('perfMonth', { ...filters.perfMonth, min: e.target.value ? Number(e.target.value) : undefined })}
                      />
                      <input
                        type="number"
                        step="0.1"
                        placeholder="Max"
                        className="w-full p-2 border border-border rounded bg-background text-sm"
                        value={filters.perfMonth?.max || ''}
                        onChange={(e) => updateFilter('perfMonth', { ...filters.perfMonth, max: e.target.value ? Number(e.target.value) : undefined })}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Saved Screens */}
            {savedScreens.length > 0 && (
              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="font-semibold mb-4">Saved Screens</h3>
                <div className="space-y-2">
                  {savedScreens.map(screen => (
                    <div key={screen.id} className="flex justify-between items-center p-2 bg-muted rounded">
                      <button
                        onClick={() => loadScreen(screen)}
                        className="text-sm hover:underline text-left flex-1 truncate"
                      >
                        {screen.name}
                      </button>
                      <button
                        onClick={() => deleteScreen(screen.id)}
                        className="text-xs text-red-500 hover:text-red-700 ml-2"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Results Table */}
          <div className="lg:col-span-3">
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="p-4 border-b border-border flex justify-between items-center flex-wrap gap-4">
                <div className="flex gap-2 items-center">
                  <span className="text-sm">Sort by:</span>
                  <select
                    className="p-2 border border-border rounded bg-background text-sm"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                  >
                    <option value="symbol">Symbol</option>
                    <option value="close">Price</option>
                    <option value="change">Change</option>
                    <option value="percentChange">% Change</option>
                    <option value="volume">Volume</option>
                    <option value="market_cap">Market Cap</option>
                    <option value="pe">P/E Ratio</option>
                    <option value="pb">P/B Ratio</option>
                    <option value="dividend_yield">Div. Yield</option>
                    <option value="perfWeek">Weekly Perf</option>
                    <option value="perfMonth">Monthly Perf</option>
                    <option value="roe">ROE</option>
                    <option value="beta">Beta</option>
                  </select>
                  <button
                    onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                    className="p-2 border border-border rounded"
                    title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
                  >
                    {sortOrder === 'asc' ? '↑' : '↓'}
                  </button>
                </div>
                <span className="text-sm text-muted-foreground">
                  {totalCount.toLocaleString()} stocks
                </span>
              </div>

              {loading ? (
                <div className="p-8 text-center text-sm text-muted-foreground animate-pulse">Fetching latest scanner data...</div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-muted">
                        <tr>
                          <th className="p-3 text-left text-xs font-bold uppercase tracking-wider">Symbol</th>
                          <th className="p-3 text-right text-xs font-bold uppercase tracking-wider">Market Cap</th>
                          <th className="p-3 text-right text-xs font-bold uppercase tracking-wider">Price</th>
                          <th className="p-3 text-right text-xs font-bold uppercase tracking-wider">Change</th>
                          <th className="p-3 text-right text-xs font-bold uppercase tracking-wider">P/E</th>
                          <th className="p-3 text-right text-xs font-bold uppercase tracking-wider">P/B</th>
                          <th className="p-3 text-right text-xs font-bold uppercase tracking-wider">Div.Yld</th>
                          <th className="p-3 text-right text-xs font-bold uppercase tracking-wider">Vol</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stocks.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="p-8 text-center text-sm text-muted-foreground">
                              No stocks match your filters. Try adjusting your criteria.
                            </td>
                          </tr>
                        ) : (
                          stocks.map(stock => (
                            <tr key={stock.symbol} className="border-t border-border hover:bg-muted/50 transition-colors">
                              <td className="p-3">
                                <a 
                                  href={`/company/${stock.symbol.split(':')[1] || stock.symbol}`} 
                                  className="font-bold text-blue-600 dark:text-blue-400 hover:underline"
                                >
                                  {stock.symbol.split(':')[1] || stock.symbol}
                                </a>
                                <p className="text-[10px] text-muted-foreground truncate max-w-[150px]" title={stock.description}>
                                  {stock.description}
                                </p>
                              </td>
                              <td className="p-3 text-right">
                                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                                  ₹{((stock.market_cap ?? 0) / 10000000).toFixed(0)} Cr
                                </span>
                              </td>
                              <td className="p-3 text-right font-medium text-slate-900 dark:text-white">
                                ₹{(stock.close ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                              </td>
                              <td className={`p-3 text-right font-bold ${
                                (stock.percentChange ?? stock.change ?? 0) >= 0 
                                  ? 'text-green-600' 
                                  : 'text-red-600'
                              }`}>
                                <div className="flex flex-col items-end">
                                  <span>
                                    {(stock.percentChange ?? stock.change ?? 0) >= 0 ? '+' : ''}
                                    {(stock.percentChange ?? stock.change ?? 0).toFixed(2)}
                                  </span>
                                  <span className="text-[10px] opacity-75">
                                    {(stock.percentChange ?? 0) >= 0 ? '+' : ''}
                                    {(stock.percentChange ?? 0).toFixed(2)}%
                                  </span>
                                </div>
                              </td>
                              <td className="p-3 text-right">
                                <span className={`text-xs font-medium ${
                                  (stock.pe ?? 0) > 0 && (stock.pe ?? 0) <= 25 
                                    ? 'text-green-600' 
                                    : (stock.pe ?? 0) > 60 
                                      ? 'text-red-600' 
                                      : 'text-slate-600 dark:text-slate-400'
                                }`}>
                                  {(stock.pe ?? 0) > 0 ? stock.pe.toFixed(1) : '-'}
                                </span>
                              </td>
                              <td className="p-3 text-right">
                                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                                  {(stock.pb ?? 0) > 0 ? stock.pb.toFixed(1) : '-'}
                                </span>
                              </td>
                              <td className="p-3 text-right">
                                <span className={`text-xs font-medium ${
                                  (stock.dividend_yield ?? 0) >= 3 
                                    ? 'text-green-600' 
                                    : (stock.dividend_yield ?? 0) >= 1.5
                                      ? 'text-yellow-600'
                                      : 'text-slate-600 dark:text-slate-400'
                                }`}>
                                  {(stock.dividend_yield ?? 0) > 0 ? `${stock.dividend_yield.toFixed(1)}%` : '-'}
                                </span>
                              </td>
                              <td className="p-3 text-right">
                                <span className="text-xs font-medium text-slate-500">
                                  {((stock.volume ?? 0) / 1000000).toFixed(1)}M
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="p-4 border-t border-border flex justify-center gap-2 bg-slate-50/50 dark:bg-slate-900/50">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="px-4 py-1.5 text-sm font-bold border border-border rounded-xl disabled:opacity-50 hover:bg-white dark:hover:bg-slate-800 transition-all"
                    >
                      Prev
                    </button>
                    <div className="flex items-center px-4 bg-white dark:bg-slate-800 border border-border rounded-xl shadow-sm">
                      <span className="text-xs font-bold text-blue-600">
                        Page {page} of {totalPages}
                      </span>
                    </div>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages || totalPages === 0}
                      className="px-4 py-1.5 text-sm font-bold border border-border rounded-xl disabled:opacity-50 hover:bg-white dark:hover:bg-slate-800 transition-all"
                    >
                      Next
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Save Screen Dialog */}
        {showSaveDialog && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
            <div className="bg-card border border-border p-8 rounded-2xl w-[400px] shadow-2xl">
              <h3 className="text-xl font-black mb-2">Save Screen</h3>
              <p className="text-sm text-muted-foreground mb-6 font-medium">Create a shortcut for these filter parameters.</p>
              <input
                type="text"
                placeholder="Screen name (e.g. Midcap Value)"
                className="w-full p-3 border border-border rounded-xl mb-6 bg-slate-50/50 dark:bg-slate-900 focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold"
                value={screenName}
                onChange={(e) => setScreenName(e.target.value)}
              />
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowSaveDialog(false)}
                  className="px-6 py-2.5 font-bold text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveScreen}
                  className="px-8 py-2.5 bg-blue-600 text-white font-black rounded-xl shadow-lg shadow-blue-500/20 hover:bg-blue-700 active:scale-95 transition-all"
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
