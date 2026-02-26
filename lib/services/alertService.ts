import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import logger from "@/lib/logger";

export type AlertType = 
  | "price_above"
  | "price_below"
  | "volume_spike"
  | "price_jump"
  | "piotroski_score"
  | "portfolio_value";

export interface AlertCondition {
  symbol?: string;
  threshold?: number;
  period?: string;
  direction?: "above" | "below";
  changePercent?: number;
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

export async function triggerAlert(alertId: string): Promise<void> {
  logger.info({ msg: "Triggering alert", alertId });
  
  await prisma.alert.update({
    where: { id: alertId },
    data: {
      triggered: true,
      triggeredAt: new Date(),
    },
  });
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
