/**
 * Alert Evaluation Engine — evaluates AlertRule conditions against live market data.
 *
 * Reuses the FilterGroup condition tree from Phase 1 (Advanced Screener) for
 * multi-condition alert logic. Supports:
 *   - FilterGroup-based conditions (price > 2500 AND RSI > 70)
 *   - Schedule restrictions (active hours, days)
 *   - Cooldown periods (prevent alert spam)
 *   - Escalation rules
 */

import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { evaluateFilterGroup, resolveFieldValue } from "@/lib/screener/filter-engine";
import type { FilterGroup, FilterField } from "@/lib/screener/condition-tree";
import { getStockQuote } from "@/lib/stock-service";
import { deliverAlert, acknowledgeAlert } from "./delivery";
import type { AlertContext } from "./delivery";

// ============================================================
// Types
// ============================================================

export interface AlertSchedule {
  /** Active hours in "HH:MM" format (24h), e.g., { start: "09:15", end: "15:30" } */
  activeHours?: { start: string; end: string };
  /** Active days: 0=Sunday, 1=Monday ... 6=Saturday */
  activeDays?: number[];
  /** Cooldown in minutes between alerts (default 60) */
  cooldownMinutes?: number;
}

export interface EscalationRule {
  enabled: boolean;
  /** Minutes to wait before escalating */
  delayMinutes: number;
  /** Channel IDs to escalate to (more urgent) */
  escalateToChannelIds: string[];
}

export interface AlertAction {
  type: "none" | "buy" | "sell" | "paper_trade";
  quantity?: number;
  price?: number;
  symbol?: string;
}

export interface AlertEvalResult {
  ruleId: string;
  ruleName: string;
  triggered: boolean;
  symbol?: string;
  price?: number;
  change?: number;
  pChange?: number;
  message?: string;
}

// ============================================================
// Evaluation Engine
// ============================================================

/**
 * Evaluate a single alert rule against current market data.
 */
export async function evaluateAlertRule(
  rule: {
    id: string;
    name: string;
    userId: number;
    condition: any;
    channels: string[];
    schedule?: any;
    escalation?: any;
    action?: any;
    isActive: boolean;
    lastTriggeredAt?: Date | null;
    triggerCount: number;
  },
  testData?: Record<string, unknown>
): Promise<AlertEvalResult> {
  if (!rule.isActive) {
    return { ruleId: rule.id, ruleName: rule.name, triggered: false };
  }

  // 1. Parse condition as FilterGroup
  let filterGroup: FilterGroup;
  try {
    filterGroup =
      typeof rule.condition === "string"
        ? JSON.parse(rule.condition)
        : (rule.condition as FilterGroup);
  } catch {
    logger.error({
      msg: "Invalid alert rule condition",
      ruleId: rule.id,
    });
    return { ruleId: rule.id, ruleName: rule.name, triggered: false };
  }

  // 2. Check schedule restrictions
  if (rule.schedule) {
    const schedule = typeof rule.schedule === "string" ? JSON.parse(rule.schedule) : rule.schedule as AlertSchedule;
    if (!isWithinSchedule(schedule)) {
      return { ruleId: rule.id, ruleName: rule.name, triggered: false };
    }
  }

  // 3. Check cooldown
  if (rule.lastTriggeredAt) {
    const schedule = rule.schedule ? (typeof rule.schedule === "string" ? JSON.parse(rule.schedule) : rule.schedule as AlertSchedule) : undefined;
    const cooldownMinutes = schedule?.cooldownMinutes ?? 60;
    const cooldownEnd = new Date(rule.lastTriggeredAt.getTime() + cooldownMinutes * 60 * 1000);
    if (new Date() < cooldownEnd) {
      return { ruleId: rule.id, ruleName: rule.name, triggered: false };
    }
  }

  // 4. Fetch live data or use test data
  const symbols = extractSymbolsFromCondition(filterGroup);
  const results: AlertEvalResult[] = [];

  for (const symbol of symbols) {
    let stockData: Record<string, unknown>;

    if (testData) {
      stockData = testData;
    } else {
      try {
        const quote = await getStockQuote(symbol);
        if (!quote) {
          logger.warn({ msg: "No quote data for alert symbol", symbol, ruleId: rule.id });
          continue;
        }
        stockData = buildStockRecord(symbol, quote);
      } catch (error) {
        logger.error({
          msg: "Failed to fetch stock data for alert",
          symbol,
          ruleId: rule.id,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    // 5. Evaluate condition
    const triggered = evaluateFilterGroup(filterGroup, stockData);

    if (triggered) {
      const price = asNumber(stockData.close) || asNumber(stockData.lastPrice) || 0;
      const change = asNumber(stockData.change) || 0;
      const pChange = asNumber(stockData.percentChange) || asNumber(stockData.pChange) || 0;

      results.push({
        ruleId: rule.id,
        ruleName: rule.name,
        triggered: true,
        symbol,
        price,
        change,
        pChange,
        message: buildAlertMessage(rule.name, symbol, price, change, pChange),
      });
    }
  }

  // If no symbols in condition, evaluate against a generic empty record
  // (for alerts about broad market conditions)
  if (symbols.length === 0 && testData) {
    const triggered = evaluateFilterGroup(filterGroup, testData);
    if (triggered) {
      results.push({
        ruleId: rule.id,
        ruleName: rule.name,
        triggered: true,
        message: "Alert condition met",
      });
    }
  }

  return results[0] || { ruleId: rule.id, ruleName: rule.name, triggered: false };
}

/**
 * Evaluate multiple rules and trigger deliveries for matched ones.
 */
export async function evaluateAndDeliver(
  ruleIds?: string[],
  userId?: number
): Promise<AlertEvalResult[]> {
  const where: any = { isActive: true };
  if (ruleIds) where.id = { in: ruleIds };
  if (userId) where.userId = userId;

  const rules = await prisma.alertRule.findMany({ where });
  const allResults: AlertEvalResult[] = [];

  for (const rule of rules) {
    try {
      const result = await evaluateAlertRule(rule);
      allResults.push(result);

      if (result.triggered) {
        // Update rule trigger stats
        await prisma.alertRule.update({
          where: { id: rule.id },
          data: {
            lastTriggeredAt: new Date(),
            triggerCount: { increment: 1 },
          },
        });

        // Deliver via channels
        const context: AlertContext = {
          ruleId: rule.id,
          ruleName: rule.name,
          symbol: result.symbol,
          price: result.price,
          change: result.change,
          pChange: result.pChange,
          message: result.message || "Alert condition triggered",
          link: result.symbol ? `/company/${result.symbol}` : "/alerts",
          metadata: { triggeredAt: new Date().toISOString() },
        };

        await deliverAlert(context, rule.channels, rule.userId);

        // Check escalation
        if (rule.escalation) {
          const escalation = typeof rule.escalation === "string" ? JSON.parse(rule.escalation) : rule.escalation as unknown as EscalationRule;
          if (escalation?.enabled) {
            // Escalation is handled by a background worker checking for unacknowledged events
            await scheduleEscalation(rule.id, escalation, rule.userId);
          }
        }
      }
    } catch (error) {
      logger.error({
        msg: "Error evaluating alert rule",
        ruleId: rule.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return allResults;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Check if current time falls within the schedule.
 */
function isWithinSchedule(schedule: AlertSchedule): boolean {
  const now = new Date();

  // Check day of week
  if (schedule.activeDays && schedule.activeDays.length > 0) {
    if (!schedule.activeDays.includes(now.getDay())) {
      return false;
    }
  }

  // Check active hours
  if (schedule.activeHours?.start && schedule.activeHours?.end) {
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = schedule.activeHours.start.split(":").map(Number);
    const [endH, endM] = schedule.activeHours.end.split(":").map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (currentMinutes < startMinutes || currentMinutes > endMinutes) {
      return false;
    }
  }

  return true;
}

/**
 * Extract unique stock symbols from a FilterGroup condition tree.
 */
function extractSymbolsFromCondition(group: FilterGroup): string[] {
  const symbols = new Set<string>();

  function walk(g: FilterGroup) {
    for (const condition of g.conditions) {
      if (condition.field === ("symbol" as FilterField) || condition.field === ("ticker" as FilterField)) {
        const val = (condition.condition as any).value;
        if (typeof val === "string") {
          symbols.add(val.toUpperCase());
        } else if (Array.isArray(val)) {
          for (const v of val) symbols.add(String(v).toUpperCase());
        }
      }
    }
    for (const sub of g.groups) walk(sub);
  }

  walk(group);
  return Array.from(symbols);
}

/**
 * Build a stock data record from a quote object.
 */
function buildStockRecord(symbol: string, quote: any): Record<string, unknown> {
  return {
    symbol,
    ticker: symbol,
    close: quote.lastPrice,
    lastPrice: quote.lastPrice,
    open: quote.open,
    high: quote.dayHigh,
    low: quote.dayLow,
    change: quote.change,
    pChange: quote.pChange,
    percentChange: quote.pChange,
    volume: quote.totalTradedVolume,
    market_cap_basic: quote.marketCap,
    price_earnings_ttm: quote.peRatio,
    price_book_ratio: quote.pbRatio,
    dividend_yield_recent: quote.dividendYield,
    sector: quote.sector,
    industry: quote.industry,
    "52_week_high": quote.yearHigh,
    "52_week_low": quote.yearLow,
  };
}

function asNumber(val: unknown): number | null {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = parseFloat(val);
    return isNaN(n) ? null : n;
  }
  return null;
}

function buildAlertMessage(
  ruleName: string,
  symbol: string,
  price: number,
  change: number,
  pChange: number
): string {
  const direction = change >= 0 ? "up" : "down";
  return `${ruleName}: ${symbol} is at ₹${price.toLocaleString("en-IN")}, ${direction} ${Math.abs(change).toFixed(2)} (${pChange >= 0 ? "+" : ""}${pChange.toFixed(2)}%)`;
}

/**
 * Schedule escalation check — creates a worker task or logs for later pickup.
 */
async function scheduleEscalation(
  ruleId: string,
  escalation: EscalationRule,
  userId: number
): Promise<void> {
  // For now, log the escalation trigger. A background worker will check for
  // unacknowledged events after the delay period and escalate.
  logger.info({
    msg: "Escalation scheduled",
    ruleId,
    delayMinutes: escalation.delayMinutes,
    escalateToChannels: escalation.escalateToChannelIds,
  });

  // Create a notification about pending escalation
  await prisma.notification.create({
    data: {
      userId,
      type: "alert_triggered",
      title: "Alert Escalation Pending",
      message: `Alert rule has escalation enabled. Will escalate in ${escalation.delayMinutes} minutes if not acknowledged.`,
      link: "/alerts",
    },
  });
}

export { acknowledgeAlert };
