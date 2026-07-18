/**
 * Portfolio Risk Metrics Service
 *
 * Computes risk/performance metrics from portfolio value history:
 * - Sharpe ratio (annualized)
 * - Maximum drawdown
 * - Annualized volatility
 * - Portfolio beta vs NIFTY 50
 */

import prisma from "@/lib/prisma";
import { getPortfolioValueHistory } from "./portfolioHistoryService";
import logger from "@/lib/logger";

export interface RiskMetrics {
  sharpeRatio: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  annualizedVolatility: number;
  annualizedReturn: number;
  beta: number | null;
  positiveDays: number;
  negativeDays: number;
  totalDays: number;
  winRate: number;
}

/**
 * Compute risk metrics for a user's portfolio.
 */
export async function getPortfolioRiskMetrics(
  userId: number
): Promise<RiskMetrics> {
  try {
    const history = await getPortfolioValueHistory(userId, 500);

    if (history.history.length < 5) {
      return getEmptyMetrics();
    }

    const values = history.history.map((p) => p.value);
    const invested = history.history.map((p) => p.invested);

    // Daily returns from portfolio value
    const dailyReturns: number[] = [];
    for (let i = 1; i < values.length; i++) {
      const prev = values[i - 1];
      if (prev > 0) {
        dailyReturns.push((values[i] - prev) / prev);
      }
    }

    if (dailyReturns.length < 2) {
      return getEmptyMetrics();
    }

    // --- Sharpe Ratio ---
    const sharpeRatio = computeSharpeRatio(dailyReturns);

    // --- Annualized Volatility ---
    const annualizedVol = computeAnnualizedVolatility(dailyReturns);

    // --- Annualized Return ---
    const firstValue = history.history[0]?.value || 0;
    const lastValue = history.history[history.history.length - 1]?.value || 0;
    const firstDate = new Date(history.history[0]?.date || Date.now());
    const lastDate = new Date(history.history[history.history.length - 1]?.date || Date.now());
    const daysElapsed = (lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24);
    const yearsElapsed = daysElapsed / 365.25;
    const annualizedReturn =
      yearsElapsed > 0 && firstValue > 0
        ? (Math.pow(lastValue / firstValue, 1 / yearsElapsed) - 1) * 100
        : 0;

    // --- Max Drawdown ---
    const { maxDrawdown, maxDrawdownPercent } = computeMaxDrawdown(values);

    // --- Win Rate ---
    const positiveDays = dailyReturns.filter((r) => r > 0).length;
    const negativeDays = dailyReturns.filter((r) => r < 0).length;

    // --- Beta vs NIFTY 50 ---
    const beta = await computeBeta(userId, dailyReturns, history.history[0]?.date || "");

    return {
      sharpeRatio: Math.round(sharpeRatio * 100) / 100,
      maxDrawdown: Math.round(maxDrawdown * 100) / 100,
      maxDrawdownPercent: Math.round(maxDrawdownPercent * 100) / 100,
      annualizedVolatility: Math.round(annualizedVol * 100) / 100,
      annualizedReturn: Math.round(annualizedReturn * 100) / 100,
      beta: beta !== null ? Math.round(beta * 100) / 100 : null,
      positiveDays,
      negativeDays,
      totalDays: dailyReturns.length,
      winRate: Math.round((positiveDays / dailyReturns.length) * 10000) / 100,
    };
  } catch (error) {
    logger.error({
      msg: "Failed to compute portfolio risk metrics",
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return getEmptyMetrics();
  }
}

function getEmptyMetrics(): RiskMetrics {
  return {
    sharpeRatio: 0,
    maxDrawdown: 0,
    maxDrawdownPercent: 0,
    annualizedVolatility: 0,
    annualizedReturn: 0,
    beta: null,
    positiveDays: 0,
    negativeDays: 0,
    totalDays: 0,
    winRate: 0,
  };
}

/**
 * Compute annualized Sharpe ratio from daily returns.
 * Assumes risk-free rate = 0.
 */
function computeSharpeRatio(dailyReturns: number[]): number {
  const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
  const variance =
    dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) /
    (dailyReturns.length - 1);
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  return (mean / stdDev) * Math.sqrt(252);
}

/**
 * Compute annualized volatility from daily returns.
 */
function computeAnnualizedVolatility(dailyReturns: number[]): number {
  const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
  const variance =
    dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) /
    (dailyReturns.length - 1);
  const stdDev = Math.sqrt(variance);
  return stdDev * Math.sqrt(252) * 100; // as percentage
}

/**
 * Compute maximum drawdown from portfolio value history.
 */
function computeMaxDrawdown(values: number[]): {
  maxDrawdown: number;
  maxDrawdownPercent: number;
} {
  let peak = values[0] || 0;
  let maxDd = 0;
  let maxDdPct = 0;

  for (const value of values) {
    if (value > peak) peak = value;
    const dd = peak - value;
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;
    if (ddPct > maxDdPct) maxDdPct = ddPct;
  }

  return { maxDrawdown: maxDd, maxDrawdownPercent: maxDdPct };
}

/**
 * Compute portfolio beta against NIFTY 50 index.
 */
async function computeBeta(
  userId: number,
  portfolioDailyReturns: number[],
  startDate: string
): Promise<number | null> {
  try {
    // Fetch NIFTY 50 daily closes for the same period
    const indexData = await prisma.indexClose.findMany({
      where: {
        indexName: "NIFTY 50",
        asOf: { gte: new Date(startDate) },
        close: { not: null },
      },
      orderBy: { asOf: "asc" },
      select: { asOf: true, close: true },
    });

    if (indexData.length < portfolioDailyReturns.length + 1) {
      return null; // not enough index data
    }

    // Compute NIFTY 50 daily returns
    const indexReturns: number[] = [];
    for (let i = 1; i < indexData.length; i++) {
      const prev = Number(indexData[i - 1].close);
      const curr = Number(indexData[i].close);
      if (prev > 0) {
        indexReturns.push((curr - prev) / prev);
      }
    }

    // Align lengths
    const minLen = Math.min(portfolioDailyReturns.length, indexReturns.length);
    if (minLen < 5) return null;

    const pReturns = portfolioDailyReturns.slice(0, minLen);
    const iReturns = indexReturns.slice(0, minLen);

    // Compute beta = Cov(P, I) / Var(I)
    const pMean = pReturns.reduce((s, r) => s + r, 0) / pReturns.length;
    const iMean = iReturns.reduce((s, r) => s + r, 0) / iReturns.length;

    let covariance = 0;
    let variance = 0;
    for (let i = 0; i < minLen; i++) {
      covariance += (pReturns[i] - pMean) * (iReturns[i] - iMean);
      variance += (iReturns[i] - iMean) ** 2;
    }

    if (variance === 0) return null;
    return covariance / variance;
  } catch (error) {
    logger.warn({
      msg: "Failed to compute beta",
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
