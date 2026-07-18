"use client";

import { useState } from "react";
import type { FilterGroup } from "@/lib/screener/condition-tree";

interface BacktestConfig {
  profitTarget: number;
  stopLoss: number;
  trailingStop: number;
  maxHoldingBars: number;
  initialCapital: number;
  positionSizePercent: number;
}

interface BacktestTrade {
  entryDate: string;
  exitDate: string | null;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  exitReason: string;
}

interface BacktestMetrics {
  totalTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  totalReturn: number;
  totalReturnPercent: number;
}

interface BacktestResult {
  run: {
    id: string;
    name: string;
    status: string;
    totalTrades: number;
    winRate: number;
    totalPnl: number;
    maxDrawdown: number;
    sharpeRatio: number;
  };
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  barCount: number;
}

interface BacktestDialogProps {
  symbol: string;
  entryFilter?: FilterGroup;
  onClose: () => void;
}

export default function BacktestDialog({ symbol, entryFilter, onClose }: BacktestDialogProps) {
  const [config, setConfig] = useState<BacktestConfig>({
    profitTarget: 5,
    stopLoss: 3,
    trailingStop: 0,
    maxHoldingBars: 20,
    initialCapital: 100000,
    positionSizePercent: 25,
  });

  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"metrics" | "trades">("metrics");

  const updateConfig = (key: keyof BacktestConfig, value: number) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const runBacktest = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Get the entry filter — if none provided, use a simple "close > 0" (always true) filter
      const filter = entryFilter || {
        id: "bt_default",
        logic: "AND" as const,
        conditions: [{ id: "bt_c1", field: "close" as any, condition: { operator: "gt" as any, value: 0 } }],
        groups: [],
      };

      const res = await fetch("/api/backtest/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          entryFilter: filter,
          profitTarget: config.profitTarget,
          stopLoss: config.stopLoss,
          trailingStop: config.trailingStop || undefined,
          maxHoldingBars: config.maxHoldingBars,
          initialCapital: config.initialCapital,
          positionSizePercent: config.positionSizePercent,
          name: `Backtest: ${symbol} - ${new Date().toLocaleDateString()}`,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Backtest failed");
      }

      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backtest failed");
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (val: number): string => {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(val);
  };

  const formatPercent = (val: number): string => {
    return (val >= 0 ? "+" : "") + val.toFixed(2) + "%";
  };

  const MetricCard = ({ label, value, isGood, isBad }: { label: string; value: string; isGood?: boolean; isBad?: boolean }) => (
    <div className="bg-card border border-border rounded-lg p-3">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={`text-lg font-bold mt-0.5 ${isGood ? "text-green-600" : isBad ? "text-red-600" : ""}`}>
        {value}
      </div>
    </div>
  );

  // Compute mini equity curve
  const equityCurve = result?.trades?.reduce<{ trade: number; equity: number }[]>((acc, t, i) => {
    const prev = i > 0 ? acc[i - 1].equity : config.initialCapital;
    acc.push({ trade: i + 1, equity: prev + t.pnl });
    return acc;
  }, []) || [];

  const maxEq = Math.max(...equityCurve.map((e) => e.equity), config.initialCapital);
  const minEq = Math.min(...equityCurve.map((e) => e.equity), config.initialCapital);
  const eqRange = maxEq - minEq || 1;
  const chartHeight = 120;
  const chartWidth = 400;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">Backtest: {symbol}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Run a historical simulation against DailyPrice data
          </p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 py-2 text-xs font-medium text-red-700 bg-red-50 dark:bg-red-950 rounded-lg border border-red-200">
          {error}
        </div>
      )}

      {/* Config form (hidden after results) */}
      {!result && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Profit Target (%)</label>
            <input
              type="number"
              className="w-full mt-1 p-2 text-sm border border-border rounded-lg bg-background"
              value={config.profitTarget}
              onChange={(e) => updateConfig("profitTarget", Number(e.target.value))}
              step={0.5}
              min={0}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Stop Loss (%)</label>
            <input
              type="number"
              className="w-full mt-1 p-2 text-sm border border-border rounded-lg bg-background"
              value={config.stopLoss}
              onChange={(e) => updateConfig("stopLoss", Number(e.target.value))}
              step={0.5}
              min={0}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Trailing Stop (%)</label>
            <input
              type="number"
              className="w-full mt-1 p-2 text-sm border border-border rounded-lg bg-background"
              value={config.trailingStop}
              onChange={(e) => updateConfig("trailingStop", Number(e.target.value))}
              step={0.5}
              min={0}
              placeholder="0 = disabled"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Max Holding (bars)</label>
            <input
              type="number"
              className="w-full mt-1 p-2 text-sm border border-border rounded-lg bg-background"
              value={config.maxHoldingBars}
              onChange={(e) => updateConfig("maxHoldingBars", Number(e.target.value))}
              min={1}
              max={500}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Initial Capital (₹)</label>
            <input
              type="number"
              className="w-full mt-1 p-2 text-sm border border-border rounded-lg bg-background"
              value={config.initialCapital}
              onChange={(e) => updateConfig("initialCapital", Number(e.target.value))}
              step={10000}
              min={10000}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Position Size (%)</label>
            <input
              type="number"
              className="w-full mt-1 p-2 text-sm border border-border rounded-lg bg-background"
              value={config.positionSizePercent}
              onChange={(e) => updateConfig("positionSizePercent", Number(e.target.value))}
              min={1}
              max={100}
            />
          </div>
        </div>
      )}

      {/* Run button */}
      {!result && (
        <button
          onClick={runBacktest}
          disabled={loading}
          className="w-full py-2.5 text-sm font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading ? "Running backtest..." : "▶ Run Backtest"}
        </button>
      )}

      {/* Loading */}
      {loading && (
        <div className="py-8 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent mb-2" />
          <p className="text-xs text-muted-foreground">Fetching historical data and simulating trades...</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Run again button */}
          <button
            onClick={() => { setResult(null); setError(null); }}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            ← Change parameters & re-run
          </button>

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <MetricCard
              label="Total Return"
              value={formatPercent(result.metrics.totalReturnPercent)}
              isGood={result.metrics.totalReturnPercent > 0}
              isBad={result.metrics.totalReturnPercent < 0}
            />
            <MetricCard
              label="Win Rate"
              value={result.metrics.winRate.toFixed(1) + "%"}
              isGood={result.metrics.winRate >= 50}
              isBad={result.metrics.winRate < 40}
            />
            <MetricCard
              label="Total Trades"
              value={String(result.metrics.totalTrades)}
            />
            <MetricCard
              label="Max Drawdown"
              value={result.metrics.maxDrawdownPercent.toFixed(1) + "%"}
              isBad={result.metrics.maxDrawdownPercent > 20}
            />
            <MetricCard
              label="Avg Win"
              value={formatCurrency(result.metrics.avgWin)}
              isGood={true}
            />
            <MetricCard
              label="Avg Loss"
              value={formatCurrency(result.metrics.avgLoss)}
              isBad={true}
            />
            <MetricCard
              label="Sharpe Ratio"
              value={result.metrics.sharpeRatio.toFixed(2)}
              isGood={result.metrics.sharpeRatio >= 1}
              isBad={result.metrics.sharpeRatio < 0}
            />
            <MetricCard
              label="Net P&L"
              value={formatCurrency(result.metrics.totalReturn)}
              isGood={result.metrics.totalReturn > 0}
              isBad={result.metrics.totalReturn < 0}
            />
          </div>

          {/* Equity Curve (simple SVG) */}
          {equityCurve.length > 1 && (
            <div className="bg-card border border-border rounded-lg p-3">
              <div className="text-xs font-medium text-muted-foreground mb-2">Equity Curve</div>
              <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-[120px]" preserveAspectRatio="none">
                <rect width={chartWidth} height={chartHeight} fill="transparent" />
                {/* Area fill */}
                <path
                  d={`M0,${chartHeight - ((equityCurve[0].equity - minEq) / eqRange) * chartHeight} ${equityCurve.map((e, i) =>
                    `L${(i / (equityCurve.length - 1)) * chartWidth},${chartHeight - ((e.equity - minEq) / eqRange) * chartHeight}`
                  ).join(" ")} L${chartWidth},${chartHeight} L0,${chartHeight} Z`}
                  fill="url(#eqGradient)"
                  opacity={0.3}
                />
                {/* Line */}
                <path
                  d={`M0,${chartHeight - ((equityCurve[0].equity - minEq) / eqRange) * chartHeight} ${equityCurve.map((e, i) =>
                    `L${(i / (equityCurve.length - 1)) * chartWidth},${chartHeight - ((e.equity - minEq) / eqRange) * chartHeight}`
                  ).join(" ")}`}
                  fill="none"
                  stroke="rgb(59, 130, 246)"
                  strokeWidth={2}
                />
                {/* Start/End markers */}
                <circle cx={0} cy={chartHeight - ((equityCurve[0].equity - minEq) / eqRange) * chartHeight} r={4} fill="rgb(59, 130, 246)" />
                <circle cx={chartWidth} cy={chartHeight - ((equityCurve[equityCurve.length - 1].equity - minEq) / eqRange) * chartHeight} r={4} fill={result.metrics.totalReturn >= 0 ? "rgb(22, 163, 74)" : "rgb(220, 38, 38)"} />
                <defs>
                  <linearGradient id="eqGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(59, 130, 246)" />
                    <stop offset="100%" stopColor="rgb(59, 130, 246)" stopOpacity={0} />
                  </linearGradient>
                </defs>
              </svg>
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>Trade 1</span>
                <span>Trade {equityCurve.length}</span>
              </div>
            </div>
          )}

          {/* Tabs: Metrics Summary / Trade List */}
          <div className="border-b border-border">
            <div className="flex gap-4">
              <button
                onClick={() => setActiveTab("metrics")}
                className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === "metrics"
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                Summary
              </button>
              <button
                onClick={() => setActiveTab("trades")}
                className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === "trades"
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                Trades ({result.trades.length})
              </button>
            </div>
          </div>

          {activeTab === "metrics" ? (
            /* Summary view */
            <div className="bg-card border border-border rounded-lg p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Number of bars analyzed</span>
                <span className="font-medium">{result.barCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Avg trade duration (bars)</span>
                <span className="font-medium">
                  {result.trades.length > 0
                    ? (result.trades.reduce((s, t) => s + (t.exitDate ? 1 : 0), 0) / result.trades.length).toFixed(1)
                    : "-"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Position size per trade</span>
                <span className="font-medium">{formatCurrency(config.initialCapital * config.positionSizePercent / 100)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Profit target / Stop loss</span>
                <span className="font-medium">{config.profitTarget}% / {config.stopLoss}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Max consecutive bars held</span>
                <span className="font-medium">{config.maxHoldingBars}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Exit reasons breakdown</span>
                <span className="font-medium">
                  {(() => {
                    const reasons: Record<string, number> = {};
                    result.trades.forEach((t) => {
                      reasons[t.exitReason] = (reasons[t.exitReason] || 0) + 1;
                    });
                    return Object.entries(reasons)
                      .map(([r, c]) => `${r}: ${c}`)
                      .join(", ");
                  })()}
                </span>
              </div>
            </div>
          ) : (
            /* Trade list */
            <div className="overflow-x-auto border border-border rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 text-left font-semibold text-muted-foreground">#</th>
                    <th className="p-2 text-left font-semibold text-muted-foreground">Entry</th>
                    <th className="p-2 text-left font-semibold text-muted-foreground">Exit</th>
                    <th className="p-2 text-right font-semibold text-muted-foreground">Entry Price</th>
                    <th className="p-2 text-right font-semibold text-muted-foreground">Exit Price</th>
                    <th className="p-2 text-right font-semibold text-muted-foreground">Qty</th>
                    <th className="p-2 text-right font-semibold text-muted-foreground">P&L</th>
                    <th className="p-2 text-right font-semibold text-muted-foreground">P&L%</th>
                    <th className="p-2 text-right font-semibold text-muted-foreground">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {result.trades.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-4 text-center text-muted-foreground">No trades generated</td>
                    </tr>
                  ) : (
                    result.trades.map((trade, idx) => (
                      <tr key={idx} className="border-t border-border/60 hover:bg-muted/30">
                        <td className="p-2 text-muted-foreground">{idx + 1}</td>
                        <td className="p-2">{new Date(trade.entryDate).toLocaleDateString()}</td>
                        <td className="p-2">{trade.exitDate ? new Date(trade.exitDate).toLocaleDateString() : "-"}</td>
                        <td className="p-2 text-right font-medium">₹{trade.entryPrice.toFixed(1)}</td>
                        <td className="p-2 text-right font-medium">₹{trade.exitPrice.toFixed(1)}</td>
                        <td className="p-2 text-right">{trade.quantity}</td>
                        <td className={`p-2 text-right font-bold ${trade.pnl >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {trade.pnl >= 0 ? "+" : ""}{formatCurrency(trade.pnl)}
                        </td>
                        <td className={`p-2 text-right font-bold ${trade.pnlPercent >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {trade.pnlPercent >= 0 ? "+" : ""}{trade.pnlPercent.toFixed(2)}%
                        </td>
                        <td className="p-2 text-right">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                            trade.exitReason === "profit_target"
                              ? "bg-green-100 dark:bg-green-900 text-green-700"
                              : trade.exitReason === "stop_loss"
                                ? "bg-red-100 dark:bg-red-900 text-red-700"
                                : trade.exitReason === "trailing_stop"
                                  ? "bg-orange-100 dark:bg-orange-900 text-orange-700"
                                  : "bg-gray-100 dark:bg-gray-800 text-gray-600"
                          }`}>
                            {trade.exitReason.replace(/_/g, " ")}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
