// lib/services/worker/worker-service.ts
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { getIndexStocks, syncStocksToDatabase } from "@/lib/index-service";

/**
 * Worker Service - Handles execution of various worker tasks
 */

export interface WorkerTaskData {
  taskType: string;
  payload?: Record<string, unknown>;
}

/**
 * Execute a worker task based on its type
 */
export async function executeTask(taskId: string, taskType: string, payload?: Record<string, unknown>): Promise<{ success: boolean; result?: unknown; error?: string }> {
  logger.info({ msg: "Executing task", taskId, taskType });

  try {
    let result: unknown;

    switch (taskType) {
      case "stock_sync":
        result = await executeStockSync(payload);
        break;
      case "corp_actions":
        result = await executeCorpActionsSync(payload);
        break;
      case "alert_check":
        result = await executeAlertCheck(payload);
        break;
      case "screener":
        result = await executeScreener(payload);
        break;
      case "recommendations":
        result = await executeRecommendations(payload);
        break;
      case "market_data":
        result = await executeMarketDataSync(payload);
        break;
      default:
        throw new Error(`Unknown task type: ${taskType}`);
    }

    logger.info({ msg: "Task completed successfully", taskId, taskType });
    return { success: true, result };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ msg: "Task execution failed", taskId, taskType, error: errorMessage });
    return { success: false, error: errorMessage };
  }
}

/**
 * Daily Stock Sync - Syncs stocks from NIFTY TOTAL MARKET
 */
async function executeStockSync(payload?: Record<string, unknown>): Promise<unknown> {
  const indexName = (payload?.indexName as string) || "NIFTY TOTAL MARKET";
  
  logger.info({ msg: "Starting stock sync", indexName });
  
  // Fetch stocks from NSE
  const stocks = await getIndexStocks(indexName);
  
  if (!stocks || stocks.length === 0) {
    throw new Error("No stocks fetched from NSE");
  }

  // Sync to database
  const syncResult = await syncStocksToDatabase(stocks);
  
  if (!syncResult.success) {
    throw new Error(syncResult.message || "Stock sync failed");
  }
  
  logger.info({ msg: "Stock sync completed", count: stocks.length, synced: syncResult.synced });
  
  return {
    indexName,
    totalFetched: stocks.length,
    synced: syncResult.synced,
    errors: syncResult.errors,
    total: syncResult.total,
  };
}

/**
 * Corporate Actions Sync - Syncs corporate actions from NSE
 */
async function executeCorpActionsSync(payload?: Record<string, unknown>): Promise<unknown> {
  const { getIndexCorporateActions } = await import("@/lib/index-service");
  
  logger.info({ msg: "Starting corporate actions sync" });
  
  // Use NIFTY 50 as default index for corporate actions
  const indexName = (payload?.indexName as string) || "NIFTY 50";
  const actions = await getIndexCorporateActions(indexName);
  
  // Save to database
  let created = 0;
  let updated = 0;
  
  for (const action of actions) {
    try {
      await prisma.corporateAction.upsert({
        where: {
          symbol_actionType_exDate: {
            symbol: action.symbol,
            actionType: action.purpose || "OTHER",
            exDate: action.exDate ? new Date(action.exDate) : new Date(0),
          },
        },
        create: {
          symbol: action.symbol,
          companyName: action.companyName || action.symbol,
          series: action.series || "EQ",
          subject: action.purpose,
          actionType: action.purpose || "OTHER",
          exDate: action.exDate ? new Date(action.exDate) : null,
          source: "nse",
        },
        update: {
          subject: action.purpose,
        },
      });
      updated++;
    } catch {
      created++;
    }
  }
  
  logger.info({ msg: "Corporate actions sync completed", total: actions.length, created, updated });
  
  return { total: actions.length, created, updated };
}

/**
 * Alert Check - Batch checks user alerts against current prices
 */
async function executeAlertCheck(payload?: Record<string, unknown>): Promise<unknown> {
  const batchSize = (payload?.batchSize as number) || 100;
  
  logger.info({ msg: "Starting alert check", batchSize });
  
  // Get active alerts
  const alerts = await prisma.userAlert.findMany({
    where: { status: "active" },
    take: batchSize,
  });

  if (alerts.length === 0) {
    return { checked: 0, triggered: 0, message: "No active alerts" };
  }

  // Get unique symbols from alerts
  const symbols = [...new Set(alerts.map((a) => a.symbol).filter(Boolean))];
  
  // Get current prices (from stock snapshots)
  const snapshots = await prisma.stockSnapshot.findMany({
    where: {
      symbol: { in: symbols as string[] },
    },
    orderBy: { capturedAt: "desc" },
    distinct: ["symbol"],
  });

  const priceMap = new Map(snapshots.map((s) => [s.symbol, s.lastPrice?.toNumber() || 0]));
  
  let triggered = 0;
  
  for (const alert of alerts) {
    if (!alert.symbol || !priceMap.has(alert.symbol)) continue;
    
    const currentPrice = priceMap.get(alert.symbol) || 0;
    const targetPrice = alert.targetPrice?.toNumber() || 0;
    
    let shouldTrigger = false;
    
    switch (alert.alertType) {
      case "price_above":
        shouldTrigger = currentPrice > targetPrice;
        break;
      case "price_below":
        shouldTrigger = currentPrice < targetPrice;
        break;
      case "volume_spike":
        // Would need volume data - skip for now
        break;
    }
    
    if (shouldTrigger) {
      await prisma.userAlert.update({
        where: { id: alert.id },
        data: {
          status: "triggered",
          triggeredAt: new Date(),
          currentPrice: currentPrice,
        },
      });
      triggered++;
    }
  }
  
  logger.info({ msg: "Alert check completed", checked: alerts.length, triggered });
  
  return { checked: alerts.length, triggered };
}

/**
 * Screener - Runs stock screener filters
 */
async function executeScreener(payload?: Record<string, unknown>): Promise<unknown> {
  const configId = payload?.configId as string;
  const filters = payload?.filters as Record<string, unknown>;
  
  logger.info({ msg: "Starting screener", configId, filters });
  
  // Get stocks from latest snapshot
  const snapshots = await prisma.stockSnapshot.findMany({
    where: {
      capturedAt: {
        gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
      },
    },
    orderBy: { lastPrice: "desc" },
    take: 500,
  });

  // Apply filters (simplified)
  let filtered = snapshots;
  
  if (filters) {
    if (filters.minPrice) {
      filtered = filtered.filter((s) => (s.lastPrice?.toNumber() || 0) >= (filters.minPrice as number));
    }
    if (filters.maxPrice) {
      filtered = filtered.filter((s) => (s.lastPrice?.toNumber() || 0) <= (filters.maxPrice as number));
    }
    if (filters.minVolume) {
      filtered = filtered.filter((s) => (s.volume || 0) >= (filters.minVolume as number));
    }
    if (filters.sector) {
      filtered = filtered.filter((s) => s.sector === filters.sector);
    }
  }

  // Save results
  if (configId) {
    // Delete old results
    await prisma.screenerResult.deleteMany({ where: { configId } });
    
    // Insert new results
    await prisma.screenerResult.createMany({
      data: filtered.map((s) => ({
        configId,
        symbol: s.symbol,
        companyName: s.companyName || s.symbol,
        lastPrice: s.lastPrice,
        change: s.change,
        pChange: s.pChange,
        volume: s.volume,
        marketCap: s.marketCap,
        peRatio: s.pe,
        pbRatio: s.pb,
        dividendYield: s.dividendYield,
        sector: s.sector,
        industry: s.industry,
      })),
    });
    
    // Update config
    await prisma.screenerConfig.update({
      where: { id: configId },
      data: {
        lastRun: new Date(),
        lastResultCount: filtered.length,
      },
    });
  }
  
  logger.info({ msg: "Screener completed", total: snapshots.length, filtered: filtered.length });
  
  return { total: snapshots.length, filtered: filtered.length };
}

/**
 * Recommendations - Generate stock recommendations
 */
async function executeRecommendations(payload?: Record<string, unknown>): Promise<unknown> {
  logger.info({ msg: "Starting recommendations generation" });
  
  // This would typically analyze stock data and generate recommendations
  // For now, return a placeholder
  
  return { message: "Recommendations generation not yet implemented" };
}

/**
 * Market Data Sync - Syncs full market data including quotes
 */
async function executeMarketDataSync(payload?: Record<string, unknown>): Promise<unknown> {
  const indexName = (payload?.indexName as string) || "NIFTY 50";
  
  logger.info({ msg: "Starting market data sync", indexName });
  
  const stocks = await getIndexStocks(indexName);
  
  const now = new Date();
  let synced = 0;
  
  for (const stock of stocks) {
    try {
      await prisma.stockSnapshot.upsert({
        where: {
          symbol_capturedAt: {
            symbol: stock.symbol,
            capturedAt: now,
          },
        },
        create: {
          symbol: stock.symbol,
          companyName: stock.meta?.companyName || stock.symbol,
          lastPrice: stock.lastPrice ? parseFloat(stock.lastPrice) : null,
          change: stock.change ? parseFloat(stock.change) : null,
          pChange: stock.pChange ? parseFloat(stock.pChange) : null,
          open: stock.open ? parseFloat(stock.open) : null,
          high: stock.dayHigh ? parseFloat(stock.dayHigh) : null,
          low: stock.dayLow ? parseFloat(stock.dayLow) : null,
          previousClose: stock.previousClose ? parseFloat(stock.previousClose) : null,
          volume: stock.totalTradedVolume ? BigInt(stock.totalTradedVolume) : null,
          yearHigh: stock.yearHigh ? parseFloat(stock.yearHigh) : null,
          yearLow: stock.yearLow ? parseFloat(stock.yearLow) : null,
          capturedAt: now,
        },
        update: {
          lastPrice: stock.lastPrice ? parseFloat(stock.lastPrice) : null,
          change: stock.change ? parseFloat(stock.change) : null,
          pChange: stock.pChange ? parseFloat(stock.pChange) : null,
          volume: stock.totalTradedVolume ? BigInt(stock.totalTradedVolume) : null,
        },
      });
      synced++;
    } catch (error) {
      logger.warn({ msg: "Failed to sync stock", symbol: stock.symbol, error });
    }
  }
  
  logger.info({ msg: "Market data sync completed", indexName, synced });
  
  return { indexName, total: stocks.length, synced };
}
