/**
 * Tax Service — Orchestrates capital gains computation.
 *
 * Fetches user transactions from the database, passes them through
 * the FIFO-based tax calculator, and returns structured results.
 */

import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import {
  computeCapitalGains,
  getFYDateRange,
  getFinancialYears,
  DEFAULT_TAX_CONFIG,
  type TaxTradeInput,
  type ComputedTrade,
  type TaxSummary,
  type TaxConfig,
} from "./taxCalculator";

export interface TaxReportData {
  fy: string;
  trades: ComputedTrade[];
  summary: TaxSummary;
  generatedAt: string;
}

export interface TaxConfigData {
  stcgRate: number;
  ltcgRate: number;
  ltcgExemption: number;
}

/**
 * Compute capital gains for a user for a given financial year.
 */
export async function getUserTaxReport(
  userId: number,
  fy: string,
  config?: TaxConfig
): Promise<TaxReportData> {
  const { start, end } = getFYDateRange(fy);

  try {
    // Get user's portfolios with transactions in the date range
    const portfolios = await prisma.portfolio.findMany({
      where: { userId },
      include: {
        transactions: {
          where: {
            tradeDate: { gte: start, lte: end },
          },
          orderBy: { tradeDate: "asc" },
        },
      },
    });

    // Convert to TaxTradeInput format
    const trades: TaxTradeInput[] = [];
    for (const portfolio of portfolios) {
      for (const tx of portfolio.transactions) {
        trades.push({
          tradeDate: tx.tradeDate,
          ticker: tx.ticker,
          side: tx.side as "BUY" | "SELL",
          quantity: Number(tx.quantity),
          price: Number(tx.price),
          fees: tx.fees ? Number(tx.fees) : undefined,
        });
      }
    }

    const result = computeCapitalGains(trades, config || DEFAULT_TAX_CONFIG);

    return {
      fy,
      trades: result.trades,
      summary: result.summary,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error({ msg: "Failed to compute tax report", userId, fy, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Get tax summary data for all users (admin view).
 */
export async function getAllUsersTaxOverview(fy: string): Promise<{
  totalUsers: number;
  usersWithGains: number;
  aggregateSTCG: number;
  aggregateLTCG: number;
  aggregateTaxLiability: number;
}> {
  const { start, end } = getFYDateRange(fy);

  try {
    const users = await prisma.user.findMany({
      include: {
        portfolios: {
          include: {
            transactions: {
              where: {
                side: "SELL",
                tradeDate: { gte: start, lte: end },
              },
              select: { ticker: true, quantity: true, price: true, tradeDate: true },
            },
          },
        },
      },
    });

    let totalSTCG = 0;
    let totalLTCG = 0;
    let usersWithGains = 0;

    for (const user of users) {
      const allTrades: TaxTradeInput[] = [];
      for (const portfolio of user.portfolios) {
        for (const tx of portfolio.transactions) {
          allTrades.push({
            tradeDate: tx.tradeDate,
            ticker: tx.ticker,
            side: "SELL",
            quantity: Number(tx.quantity),
            price: Number(tx.price),
          });
        }
      }

      if (allTrades.length === 0) continue;

      // Get BUY transactions too
      const buyTxs = await prisma.transaction.findMany({
        where: {
          portfolio: { userId: user.id },
          side: "BUY",
        },
        select: { ticker: true, quantity: true, price: true, tradeDate: true },
      });

      for (const portfolio of user.portfolios) {
        const buyTxsForPortfolio = buyTxs.filter(t => true);
        for (const tx of buyTxsForPortfolio) {
          allTrades.push({
            tradeDate: tx.tradeDate,
            ticker: tx.ticker,
            side: "BUY",
            quantity: Number(tx.quantity),
            price: Number(tx.price),
          });
        }
      }

      const result = computeCapitalGains(allTrades, DEFAULT_TAX_CONFIG);
      totalSTCG += result.summary.totalSTCG;
      totalLTCG += result.summary.totalLTCG;
      if (result.trades.length > 0) usersWithGains++;
    }

    return {
      totalUsers: users.length,
      usersWithGains,
      aggregateSTCG: Math.round(totalSTCG * 100) / 100,
      aggregateLTCG: Math.round(totalLTCG * 100) / 100,
      aggregateTaxLiability: Math.round((Math.max(0, totalSTCG) * DEFAULT_TAX_CONFIG.stcgRate +
        Math.max(0, totalLTCG - DEFAULT_TAX_CONFIG.ltcgExemption) * DEFAULT_TAX_CONFIG.ltcgRate) * 100) / 100,
    };
  } catch (error) {
    logger.error({ msg: "Failed to compute admin tax overview", fy, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export { getFinancialYears, getFYDateRange } from "./taxCalculator";
