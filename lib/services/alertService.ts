import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import logger from "@/lib/logger";

export type AlertType =
  | "price_above"
  | "price_below"
  | "volume_spike"
  | "price_jump"
  | "piotroski_score"
  | "portfolio_value"
  // Corporate Action Alert Types
  | "dividend_alert"
  | "bonus_alert"
  | "split_alert"
  | "rights_alert"
  | "buyback_alert"
  | "meeting_alert";

export interface AlertCondition {
  symbol?: string;
  threshold?: number;
  period?: string;
  direction?: "above" | "below";
  changePercent?: number;
  // Corporate action specific
  exDateAfter?: string; // ISO date string for filtering
  minDividend?: number;  // Minimum dividend amount
  // Triggered action details (filled when alert is triggered)
  triggeredAction?: string;
  purpose?: string;
  exDate?: string;
}

export interface Alert {
  id: string;
  userId?: number;
  type: AlertType;
  symbol?: string;
  condition: AlertCondition;
  triggered: boolean;
  triggeredAt?: Date;
  seen: boolean;
  createdAt: Date;
}

export async function createAlert(
  userId: number,
  type: AlertType,
  symbol: string | undefined,
  condition: AlertCondition
): Promise<Alert> {
  logger.info({ msg: "Creating alert", userId, type, symbol });

  const alert = await prisma.alert.create({
    data: {
      userId,
      type,
      symbol,
      condition: condition as Prisma.InputJsonValue,
      triggered: false,
      seen: false,
    },
  });

  return {
    id: alert.id,
    userId: alert.userId ?? undefined,
    type: alert.type as AlertType,
    symbol: alert.symbol ?? undefined,
    condition: alert.condition as unknown as AlertCondition,
    triggered: alert.triggered,
    triggeredAt: alert.triggeredAt ?? undefined,
    seen: alert.seen,
    createdAt: alert.createdAt,
  };
}

export async function getUserAlerts(userId: number): Promise<Alert[]> {
  const alerts = await prisma.alert.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  return alerts.map((alert) => ({
    id: alert.id,
    userId: alert.userId ?? undefined,
    type: alert.type as AlertType,
    symbol: alert.symbol ?? undefined,
    condition: alert.condition as unknown as AlertCondition,
    triggered: alert.triggered,
    triggeredAt: alert.triggeredAt ?? undefined,
    seen: alert.seen,
    createdAt: alert.createdAt,
  }));
}

export async function getUnseenAlerts(userId: number): Promise<Alert[]> {
  const alerts = await prisma.alert.findMany({
    where: { userId, seen: false },
    orderBy: { triggeredAt: "desc" },
  });

  return alerts.map((alert) => ({
    id: alert.id,
    userId: alert.userId ?? undefined,
    type: alert.type as AlertType,
    symbol: alert.symbol ?? undefined,
    condition: alert.condition as unknown as AlertCondition,
    triggered: alert.triggered,
    triggeredAt: alert.triggeredAt ?? undefined,
    seen: alert.seen,
    createdAt: alert.createdAt,
  }));
}

export async function markAlertSeen(alertId: string, userId: number): Promise<void> {
  await prisma.alert.updateMany({
    where: { id: alertId, userId },
    data: { seen: true },
  });
}

export async function markAllAlertsSeen(userId: number): Promise<void> {
  await prisma.alert.updateMany({
    where: { userId, seen: false },
    data: { seen: true },
  });
}

export async function deleteAlert(alertId: string, userId: number): Promise<void> {
  await prisma.alert.deleteMany({
    where: { id: alertId, userId },
  });
}

export async function updateAlert(
  alertId: string,
  userId: number,
  type: AlertType,
  symbol: string | undefined,
  condition: AlertCondition
): Promise<Alert> {
  logger.info({ msg: "Updating alert", alertId, userId, type, symbol });

  const alert = await prisma.alert.updateMany({
    where: { id: alertId, userId },
    data: {
      type,
      symbol,
      condition: condition as Prisma.InputJsonValue,
    },
  });

  const updated = await prisma.alert.findUnique({
    where: { id: alertId },
  });

  if (!updated) {
    throw new Error("Alert not found");
  }

  return {
    id: updated.id,
    userId: updated.userId ?? undefined,
    type: updated.type as AlertType,
    symbol: updated.symbol ?? undefined,
    condition: updated.condition as unknown as AlertCondition,
    triggered: updated.triggered,
    triggeredAt: updated.triggeredAt ?? undefined,
    seen: updated.seen,
    createdAt: updated.createdAt,
  };
}

export async function triggerAlert(alertId: string): Promise<void> {
  logger.info({ msg: "Triggering alert", alertId });

  const triggerTime = new Date();
  
  const alert = await prisma.alert.update({
    where: { id: alertId },
    data: {
      triggered: true,
      triggeredAt: triggerTime,
    },
  });

  // Create a notification record for the user
  if (alert.userId) {
    const title = getAlertTitle(alert.type, alert.symbol);
    const message = getAlertMessage(alert.type, alert.symbol, alert.condition);
    const timeStr = triggerTime.toLocaleString();

    await prisma.notification.create({
      data: {
        userId: alert.userId,
        type: "alert_triggered",
        title,
        message: `${message} (Triggered: ${timeStr})`,
        link: alert.symbol ? `/company/${alert.symbol}` : "/alerts",
      },
    });
  }
}

function getAlertTitle(type: string, symbol?: string | null): string {
  const symbolPrefix = symbol ? `${symbol}: ` : "";
  switch (type) {
    case "price_above": return `${symbolPrefix}Price Target Reached`;
    case "price_below": return `${symbolPrefix}Price Target Reached`;
    case "volume_spike": return `${symbolPrefix}Volume Spike Detected`;
    case "price_jump": return `${symbolPrefix}Significant Price Jump`;
    case "piotroski_score": return `${symbolPrefix}Piotroski Score Change`;
    case "portfolio_value": return `Portfolio Value Alert`;
    // Corporate Action Alerts
    case "dividend_alert": return `${symbolPrefix}Dividend Announced`;
    case "bonus_alert": return `${symbolPrefix}Bonus Shares Announced`;
    case "split_alert": return `${symbolPrefix}Stock Split Announced`;
    case "rights_alert": return `${symbolPrefix}Rights Issue Announced`;
    case "buyback_alert": return `${symbolPrefix}Buyback Announced`;
    case "meeting_alert": return `${symbolPrefix}Shareholder Meeting Scheduled`;
    default: return `Alert Triggered`;
  }
}

function getAlertMessage(type: string, symbol: string | null | undefined, condition: any): string {
  const cond = condition as AlertCondition;
  switch (type) {
    case "price_above": return `${symbol} has crossed above your target price of ${cond.threshold}.`;
    case "price_below": return `${symbol} has crossed below your target price of ${cond.threshold}.`;
    case "volume_spike": return `${symbol} is showing unusual volume spike (${cond.threshold || 5}x average).`;
    case "price_jump": return `${symbol} has jumped by ${cond.changePercent}% in the last period.`;
    case "piotroski_score": return `The Piotroski F-Score for ${symbol} has changed.`;
    case "portfolio_value": return `Your portfolio value has changed by more than ${cond.changePercent}%.`;
    // Corporate Action Alerts
    case "dividend_alert": 
      return cond.triggeredAction 
        ? `${symbol} announced dividend: ${cond.purpose}. Ex-date: ${cond.exDate ? new Date(cond.exDate).toLocaleDateString() : 'TBD'}`
        : `${symbol} has announced a dividend. Check corporate actions for details.`;
    case "bonus_alert": 
      return cond.triggeredAction 
        ? `${symbol} announced bonus shares: ${cond.purpose}. Ex-date: ${cond.exDate ? new Date(cond.exDate).toLocaleDateString() : 'TBD'}`
        : `${symbol} has announced bonus shares. Check corporate actions for details.`;
    case "split_alert": 
      return cond.triggeredAction 
        ? `${symbol} announced stock split: ${cond.purpose}. Ex-date: ${cond.exDate ? new Date(cond.exDate).toLocaleDateString() : 'TBD'}`
        : `${symbol} has announced a stock split. Check corporate actions for details.`;
    case "rights_alert": 
      return cond.triggeredAction 
        ? `${symbol} announced rights issue: ${cond.purpose}. Ex-date: ${cond.exDate ? new Date(cond.exDate).toLocaleDateString() : 'TBD'}`
        : `${symbol} has announced a rights issue. Check corporate actions for details.`;
    case "buyback_alert": 
      return cond.triggeredAction 
        ? `${symbol} announced buyback: ${cond.purpose}. Ex-date: ${cond.exDate ? new Date(cond.exDate).toLocaleDateString() : 'TBD'}`
        : `${symbol} has announced a buyback. Check corporate actions for details.`;
    case "meeting_alert": 
      return cond.triggeredAction 
        ? `${symbol} has scheduled a meeting: ${cond.purpose}. Date: ${cond.exDate ? new Date(cond.exDate).toLocaleDateString() : 'TBD'}`
        : `${symbol} has a shareholder meeting scheduled. Check corporate actions for details.`;
    default: return `An alert condition has been met.`;
  }
}

export async function checkPriceAlerts(
  symbol: string,
  currentPrice: number,
  previousPrice: number
): Promise<void> {
  const alerts = await prisma.alert.findMany({
    where: {
      symbol,
      triggered: false,
      type: {
        in: ["price_above", "price_below", "price_jump"],
      },
    },
  });

  const changePercent = ((currentPrice - previousPrice) / previousPrice) * 100;

  for (const alert of alerts) {
    const condition = alert.condition as unknown as AlertCondition;
    let shouldTrigger = false;

    if (alert.type === "price_above" && condition.threshold) {
      shouldTrigger = currentPrice > condition.threshold;
    } else if (alert.type === "price_below" && condition.threshold) {
      shouldTrigger = currentPrice < condition.threshold;
    } else if (alert.type === "price_jump" && condition.changePercent) {
      shouldTrigger = Math.abs(changePercent) > condition.changePercent;
    }

    if (shouldTrigger) {
      await triggerAlert(alert.id);
      logger.info({ msg: "Price alert triggered", alertId: alert.id, symbol, currentPrice });
    }
  }
}

export async function checkVolumeSpikeAlerts(
  symbol: string,
  currentVolume: bigint,
  averageVolume: number
): Promise<void> {
  const alerts = await prisma.alert.findMany({
    where: {
      symbol,
      triggered: false,
      type: "volume_spike",
    },
  });

  for (const alert of alerts) {
    const condition = alert.condition as unknown as AlertCondition;
    const threshold = condition.threshold ?? 5; // Default 5x average

    if (Number(currentVolume) > averageVolume * threshold) {
      await triggerAlert(alert.id);
      logger.info({ msg: "Volume spike alert triggered", alertId: alert.id, symbol, currentVolume });
    }
  }
}

export async function checkPortfolioValueAlerts(
  userId: number,
  currentValue: number,
  previousValue: number
): Promise<void> {
  const alerts = await prisma.alert.findMany({
    where: {
      userId,
      triggered: false,
      type: "portfolio_value",
    },
  });

  const changePercent = ((currentValue - previousValue) / previousValue) * 100;

  for (const alert of alerts) {
    const condition = alert.condition as unknown as AlertCondition;
    const threshold = condition.changePercent ?? 5; // Default 5% change

    if (Math.abs(changePercent) > threshold) {
      await triggerAlert(alert.id);
      logger.info({
        msg: "Portfolio value alert triggered",
        alertId: alert.id,
        userId,
        currentValue,
        previousValue,
        changePercent
      });
    }
  }
}

export async function getAlertCount(userId: number): Promise<number> {
  return prisma.alert.count({
    where: { userId, seen: false },
  });
}

/**
 * Check corporate action alerts
 * Scans upcoming corporate actions and triggers alerts if user's stock matches
 */
export async function checkCorporateActionAlerts(): Promise<{ checked: number; triggered: number }> {
  logger.info({ msg: "Checking corporate action alerts" });

  // Get all active corporate action alerts that are not triggered
  const corpActionAlerts = await prisma.alert.findMany({
    where: {
      triggered: false,
      symbol: { not: null },
      type: {
        in: ["dividend_alert", "bonus_alert", "split_alert", "rights_alert", "buyback_alert", "meeting_alert"],
      },
    },
  });

  if (corpActionAlerts.length === 0) {
    return { checked: 0, triggered: 0 };
  }

  // Get unique symbols from alerts
  const alertSymbols = [...new Set(corpActionAlerts.map(a => a.symbol).filter(Boolean))] as string[];

  // Get upcoming corporate actions for these symbols (exDate in future)
  const now = new Date();
  const corporateActions = await prisma.corporateAction.findMany({
    where: {
      symbol: { in: alertSymbols },
      exDate: { gte: now },
    },
  });

  if (corporateActions.length === 0) {
    return { checked: corpActionAlerts.length, triggered: 0 };
  }

  // Map actions by symbol for quick lookup
  const actionsBySymbol = new Map<string, typeof corporateActions>();
  for (const action of corporateActions) {
    const existing = actionsBySymbol.get(action.symbol) || [];
    existing.push(action);
    actionsBySymbol.set(action.symbol, existing);
  }

  let triggeredCount = 0;

  // Check each alert against corporate actions
  for (const alert of corpActionAlerts) {
    if (!alert.symbol) continue;

    const actions = actionsBySymbol.get(alert.symbol);
    if (!actions || actions.length === 0) continue;

    const condition = alert.condition as unknown as AlertCondition;
    let triggered = false;
    let triggeredAction: typeof corporateActions[0] | null = null;

    // Check if any action matches the alert type
    for (const action of actions) {
      const actionType = (action.actionType || "").toUpperCase();
      
      switch (alert.type) {
        case "dividend_alert":
          if (actionType.includes("DIVIDEND") || actionType.includes("DISTRIBUTION")) {
            // Optional: check minimum dividend amount
            if (condition.minDividend && action.dividendPerShare) {
              if (Number(action.dividendPerShare) >= condition.minDividend) {
                triggered = true;
                triggeredAction = action;
              }
            } else {
              triggered = true;
              triggeredAction = action;
            }
          }
          break;
          
        case "bonus_alert":
          if (actionType.includes("BONUS")) {
            triggered = true;
            triggeredAction = action;
          }
          break;
          
        case "split_alert":
          if (actionType.includes("SPLIT")) {
            triggered = true;
            triggeredAction = action;
          }
          break;
          
        case "rights_alert":
          if (actionType.includes("RIGHTS")) {
            triggered = true;
            triggeredAction = action;
          }
          break;
          
        case "buyback_alert":
          if (actionType.includes("BUYBACK")) {
            triggered = true;
            triggeredAction = action;
          }
          break;
          
        case "meeting_alert":
          if (actionType.includes("MEETING") || actionType.includes("AGM") || actionType.includes("EGM")) {
            triggered = true;
            triggeredAction = action;
          }
          break;
      }

      if (triggered && triggeredAction) break;
    }

    if (triggered && triggeredAction) {
      await triggerAlert(alert.id);
      
      // Update alert with action details
      await prisma.alert.update({
        where: { id: alert.id },
        data: {
          condition: {
            ...condition,
            triggeredAction: triggeredAction.actionType,
            exDate: triggeredAction.exDate?.toISOString(),
            purpose: triggeredAction.subject,
          } as any,
        },
      });
      
      triggeredCount++;
      logger.info({ 
        msg: "Corporate action alert triggered", 
        alertId: alert.id, 
        symbol: alert.symbol, 
        actionType: triggeredAction.actionType 
      });
    }
  }

  logger.info({ 
    msg: "Corporate action alerts check completed", 
    checked: corpActionAlerts.length, 
    triggered: triggeredCount 
  });

  return { checked: corpActionAlerts.length, triggered: triggeredCount };
}
