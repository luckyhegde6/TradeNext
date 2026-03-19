// lib/services/worker/worker-service.ts
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { getIndexStocks, syncStocksToDatabase } from "@/lib/index-service";
import { logTaskEvent } from "@/lib/services/worker/task-orchestrator";

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
    await logTaskEvent(taskId, "task_started", `Executing ${taskType}`);
    let result: unknown;

    switch (taskType) {
      // Cron task types
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
      case "market_data_fetch":
        result = await executeMarketDataSync(payload);
        break;
      case "corp_actions_fetch":
        result = await executeCorpActionsSync(payload);
        break;
      case "events_fetch":
        result = await executeEventsSync(payload);
        break;
      case "news_fetch":
        result = await executeNewsSync(payload);
        break;
      case "announcement_fetch":
        result = await executeAnnouncementsSync(payload);
        break;
      case "screener_sync":
        result = await executeScreenerSync(payload);
        break;
      // Async task types
      case "csv_processing":
        result = await executeCsvProcessing(taskId, payload);
        break;
      case "historical_sync":
        result = await executeMarketDataSync(payload);
        break;
      case "data_sync":
        result = await executeStockSync(payload);
        break;
      // Regular task types
      case "password_reset":
        result = await executePasswordReset(taskId, payload);
        break;
      case "notification_broadcast":
        result = await executeNotificationBroadcast(taskId, payload);
        break;
      case "announcement_mgmt":
        result = await executeAnnouncementMgmt(taskId, payload);
        break;
      case "maintenance":
        result = await executeMaintenance(taskId, payload);
        break;
      case "cleanup":
        result = await executeMaintenance(taskId, payload);
        break;
      default:
        throw new Error(`Unknown task type: ${taskType}`);
    }

    await logTaskEvent(taskId, "task_completed", `Task ${taskType} completed successfully`, { result });
    logger.info({ msg: "Task completed successfully", taskId, taskType });
    return { success: true, result };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logTaskEvent(taskId, "task_failed", `Task ${taskType} failed: ${errorMessage}`);
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
/**
 * Parse purpose string to determine action type
 */
function parseActionPurpose(purpose: string): { actionType: string; dividendAmount?: number } {
  const p = (purpose || "").toUpperCase();
  let actionType = "OTHER";
  let dividendAmount: number | undefined = undefined;

  // Check for dividend patterns
  if (p.includes("DIVIDEND") || p.includes("INTERIM DIVIDEND") || p.includes("FINAL DIVIDEND")) {
    actionType = "DIVIDEND";
    // Try to extract dividend amount from purpose
    const match = purpose.match(/Rs\.?\s*([\d,.]+)/i) || purpose.match(/₹\s*([\d,.]+)/i);
    if (match) {
      dividendAmount = parseFloat(match[1].replace(/,/g, ""));
    }
  } else if (p.includes("BONUS")) {
    actionType = "BONUS";
  } else if (p.includes("SPLIT") || p.includes("SUB-DIVISION")) {
    actionType = "SPLIT";
  } else if (p.includes("RIGHTS")) {
    actionType = "RIGHTS";
  } else if (p.includes("BUYBACK")) {
    actionType = "BUYBACK";
  } else if (p.includes("INTEREST")) {
    actionType = "INTEREST";
  } else if (p.includes("DEMERGER")) {
    actionType = "DEMERGER";
  } else if (p.includes("REDEMPTION")) {
    actionType = "REDEMPTION";
  } else if (p.includes("AMALGAMATION") || p.includes("MERGER")) {
    actionType = "MERGER";
  }

  return { actionType, dividendAmount };
}

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
      // Parse the purpose to determine action type
      const { actionType, dividendAmount } = parseActionPurpose(action.purpose || "");
      
      // Parse exDate
      const exDate = action.exDate ? new Date(action.exDate) : null;
      if (!exDate || isNaN(exDate.getTime())) {
        continue; // Skip records without valid exDate
      }

      await prisma.corporateAction.upsert({
        where: {
          symbol_actionType_exDate: {
            symbol: action.symbol,
            actionType: actionType,
            exDate: exDate,
          },
        },
        create: {
          symbol: action.symbol,
          companyName: action.companyName || action.symbol,
          series: action.series || "EQ",
          subject: action.purpose,
          actionType: actionType,
          exDate: exDate,
          recordDate: action.recordDate ? new Date(action.recordDate) : null,
          source: "nse",
          dividendPerShare: dividendAmount,
        },
        update: {
          subject: action.purpose,
          actionType: actionType,
          dividendPerShare: dividendAmount,
        },
      });
      updated++;
    } catch (error) {
      logger.warn({ msg: "Error syncing corporate action", symbol: action.symbol, error });
      created++;
    }
  }

  logger.info({ msg: "Corporate actions sync completed", total: actions.length, created, updated });

  return { total: actions.length, created, updated };
}

/**
 * Screener Sync - Full TradingView scan status daily snapshot
 */
async function executeScreenerSync(payload?: Record<string, unknown>): Promise<unknown> {
  const { syncDailyScreener } = await import("@/lib/services/worker/screener-service");
  logger.info({ msg: "Starting full screener sync task" });

  const result = await syncDailyScreener();

  if (!result.success) {
    throw new Error(result.message || "Screener sync failed");
  }

  return { recordCount: result.recordCount, message: result.message };
}

/**
 * Alert Check - Batch checks all alert types against current prices
 */
async function executeAlertCheck(payload?: Record<string, unknown>): Promise<unknown> {
  const batchSize = (payload?.batchSize as number) || 100;
  logger.info({ msg: "Starting alert check", batchSize });

  // 1. Process UserAlerts (User-defined specific targets)
  const userAlerts = await prisma.userAlert.findMany({
    where: { status: "active" },
    take: batchSize,
  });

  // 2. Process basic Alerts (System/automatic alerts)
  const systemAlerts = await prisma.alert.findMany({
    where: { triggered: false, symbol: { not: null } },
    take: batchSize,
  });

  if (userAlerts.length === 0 && systemAlerts.length === 0) {
    return { checked: 0, triggered: 0, message: "No active alerts in this batch" };
  }

  // Get unique symbols from both sets
  const symbols = [...new Set([
    ...userAlerts.map(a => a.symbol),
    ...systemAlerts.map(a => a.symbol)
  ].filter(Boolean) as string[])];

  // Get current prices
  const snapshots = await prisma.stockSnapshot.findMany({
    where: { symbol: { in: symbols } },
    orderBy: { capturedAt: "desc" },
    distinct: ["symbol"],
  });

  const priceMap = new Map(snapshots.map(s => [
    s.symbol,
    {
      price: s.lastPrice?.toNumber() || 0,
      change: s.change?.toNumber() || 0,
      volume: s.volume ? Number(s.volume) : 0
    }
  ]));

  let triggeredCount = 0;

  // Process UserAlerts
  for (const alert of userAlerts) {
    if (!alert.symbol || !priceMap.has(alert.symbol)) continue;
    const { price } = priceMap.get(alert.symbol)!;
    const target = alert.targetPrice?.toNumber() || 0;

    let triggered = false;
    if (alert.alertType === "price_above") triggered = price > target;
    else if (alert.alertType === "price_below") triggered = price < target;

    if (triggered) {
      const now = new Date();
      await prisma.userAlert.update({
        where: { id: alert.id },
        data: { status: "triggered", triggeredAt: now, currentPrice: price },
      });

      // Create notification
      await prisma.notification.create({
        data: {
          userId: alert.userId,
          type: "alert_triggered",
          title: `Alert Triggered: ${alert.symbol}`,
          message: `${alert.symbol} hit your target of ${target}. Current price: ${price}`,
          link: `/company/${alert.symbol}`,
        }
      });

      triggeredCount++;
    }
  }

  // Process System Alerts
  const { triggerAlert } = await import("@/lib/services/alertService");
  for (const alert of systemAlerts) {
    if (!alert.symbol || !priceMap.has(alert.symbol)) continue;
    const { price, change } = priceMap.get(alert.symbol)!;
    const condition = alert.condition as any;
    const prevPrice = price - change;
    const pChange = prevPrice > 0 ? (change / prevPrice) * 100 : 0;

    let triggered = false;
    if (alert.type === "price_above" && condition.threshold) triggered = price > condition.threshold;
    else if (alert.type === "price_below" && condition.threshold) triggered = price < condition.threshold;
    else if (alert.type === "price_jump" && condition.changePercent) triggered = Math.abs(pChange) > condition.changePercent;

    if (triggered) {
      await triggerAlert(alert.id);
      triggeredCount++;
    }
  }

  logger.info({
    msg: "Alert check completed",
    userAlertsChecked: userAlerts.length,
    systemAlertsChecked: systemAlerts.length,
    totalTriggered: triggeredCount
  });

  return {
    userAlertsChecked: userAlerts.length,
    systemAlertsChecked: systemAlerts.length,
    triggered: triggeredCount
  };
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

/**
 * Events Sync - Fetches market events from NSE
 */
async function executeEventsSync(payload?: Record<string, unknown>): Promise<unknown> {
  const { getEventCalendar } = await import("@/lib/index-service");
  logger.info({ msg: "Starting events sync" });

  const events = await getEventCalendar();
  // Implementation of storing events would go here
  return { total: events.length, message: "Events fetched and processed" };
}

/**
 * News Sync - Fetches market news
 */
async function executeNewsSync(payload?: Record<string, unknown>): Promise<unknown> {
  logger.info({ msg: "Starting news sync" });
  // Mocking news fetch for now
  return { message: "News fetching not fully implemented yet" };
}

/**
 * Announcements Sync - Fetches corporate announcements from NSE
 */
async function executeAnnouncementsSync(payload?: Record<string, unknown>): Promise<unknown> {
  const { getCorporateAnnouncements } = await import("@/lib/index-service");
  logger.info({ msg: "Starting announcements sync" });

  const announcements = await getCorporateAnnouncements();
  return { total: announcements.length, message: "Announcements processed" };
}

/**
 * CSV Processing — processes an uploaded CSV file and inserts into daily_prices
 */
async function executeCsvProcessing(taskId: string, payload?: Record<string, unknown>): Promise<unknown> {
  const filePath = payload?.filePath as string;
  const fileName = payload?.fileName as string;

  logger.info({ msg: "Starting CSV processing", taskId, filePath, fileName });

  if (!filePath) {
    throw new Error("No filePath provided in task payload");
  }

  // Dynamic import to avoid circular dependencies
  const { runIngestion } = await import("@/lib/services/ingestService");
  const result = await runIngestion(filePath);

  if (result.status === "error") {
    throw new Error(result.error || "CSV ingestion failed");
  }

  await logTaskEvent(taskId, "csv_row_processed", `Processed ${result.rows} rows from ${fileName || filePath}`, {
    rows: result.rows,
    fileName,
  });

  logger.info({ msg: "CSV processing completed", taskId, rows: result.rows });

  return { rows: result.rows, fileName, status: result.status };
}

/**
 * Password Reset — handles password reset task tracking
 * The actual reset is handled by auth routes; this tracks the admin action.
 */
async function executePasswordReset(taskId: string, payload?: Record<string, unknown>): Promise<unknown> {
  const userId = payload?.userId as number;
  const userEmail = payload?.userEmail as string;

  logger.info({ msg: "Processing password reset task", taskId, userId, userEmail });

  if (!userId && !userEmail) {
    throw new Error("userId or userEmail required for password reset");
  }

  // Find the user
  const where = userId ? { id: userId } : { email: userEmail };
  const user = await prisma.user.findFirst({ where });

  if (!user) {
    throw new Error(`User not found: ${userId || userEmail}`);
  }

  // Increment token version to invalidate all existing sessions
  await prisma.user.update({
    where: { id: user.id },
    data: { tokenVersion: { increment: 1 } },
  });

  return { userId: user.id, email: user.email, message: "Token version incremented, all sessions invalidated" };
}

/**
 * Notification Broadcast — sends notifications to target users
 */
async function executeNotificationBroadcast(taskId: string, payload?: Record<string, unknown>): Promise<unknown> {
  const title = payload?.title as string;
  const message = payload?.message as string;
  const type = (payload?.type as string) || "system";
  const target = (payload?.target as string) || "all"; // "all" | specific userId
  const link = payload?.link as string | undefined;

  logger.info({ msg: "Broadcasting notification", taskId, title, target });

  if (!title || !message) {
    throw new Error("title and message are required for notification broadcast");
  }

  let targetUserIds: number[] = [];

  if (target === "all") {
    const users = await prisma.user.findMany({ select: { id: true } });
    targetUserIds = users.map((u) => u.id);
  } else {
    targetUserIds = [parseInt(target)];
  }

  let sent = 0;
  for (const uid of targetUserIds) {
    try {
      await prisma.notification.create({
        data: {
          userId: uid,
          type,
          title,
          message,
          link: link ?? null,
        },
      });
      sent++;
    } catch (error) {
      logger.warn({ msg: "Failed to create notification for user", userId: uid, error });
    }
  }

  await logTaskEvent(taskId, "notification_sent", `Sent ${sent}/${targetUserIds.length} notifications`, {
    title,
    sent,
    total: targetUserIds.length,
  });

  return { sent, total: targetUserIds.length, title };
}

/**
 * Announcement Management — creates or updates admin announcements
 */
async function executeAnnouncementMgmt(taskId: string, payload?: Record<string, unknown>): Promise<unknown> {
  const action = (payload?.action as string) || "create";
  const title = payload?.title as string;
  const message = payload?.message as string;
  const type = (payload?.type as string) || "info";
  const announcementTarget = (payload?.target as string) || "all";
  const createdBy = (payload?.createdBy as number) || 1;

  logger.info({ msg: "Managing announcement", taskId, action, title });

  if (action === "create") {
    if (!title || !message) {
      throw new Error("title and message are required for creating an announcement");
    }

    const announcement = await prisma.adminAnnouncement.create({
      data: {
        title,
        message,
        type,
        target: announcementTarget,
        createdBy,
      },
    });

    return { action: "created", id: announcement.id, title };
  }

  if (action === "deactivate") {
    const id = payload?.id as number;
    if (!id) throw new Error("id required for deactivating announcement");

    await prisma.adminAnnouncement.update({
      where: { id },
      data: { isActive: false },
    });

    return { action: "deactivated", id };
  }

  throw new Error(`Unknown announcement action: ${action}`);
}

/**
 * Maintenance / Cleanup — cleans old data from various tables
 */
async function executeMaintenance(taskId: string, payload?: Record<string, unknown>): Promise<unknown> {
  const daysToKeep = (payload?.daysToKeep as number) || 30;
  const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);

  logger.info({ msg: "Starting maintenance cleanup", taskId, daysToKeep, cutoff: cutoff.toISOString() });

  // Clean old completed/failed tasks
  const { count: tasksDeleted } = await prisma.workerTask.deleteMany({
    where: {
      status: { in: ["completed", "failed", "cancelled"] },
      completedAt: { lt: cutoff },
    },
  });

  // Clean old task events
  const { count: eventsDeleted } = await (prisma as any).taskEvent.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  // Clean old API request logs
  const { count: logsDeleted } = await (prisma as any).aPIRequestLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  const result = { tasksDeleted, eventsDeleted, logsDeleted, cutoffDate: cutoff.toISOString() };
  logger.info({ msg: "Maintenance cleanup completed", taskId, ...result });

  return result;
}
