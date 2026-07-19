import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

export type EventType = 'telegram' | 'ai_agent' | 'screener' | 'system_health' | 'audit';
export type Severity = 'info' | 'warning' | 'critical';

export interface CreateEventInput {
  eventType: EventType;
  eventSubtype: string;
  source: string;
  userId?: number;
  symbol?: string;
  severity?: Severity;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface EventRecord {
  id: string;
  eventType: string;
  eventSubtype: string;
  source: string;
  userId: number | null;
  symbol: string | null;
  severity: string;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export async function recordEvent(input: CreateEventInput): Promise<string> {
  try {
    const event = await prisma.unifiedEvent.create({
      data: {
        eventType: input.eventType,
        eventSubtype: input.eventSubtype,
        source: input.source,
        userId: input.userId ?? null,
        symbol: input.symbol ?? null,
        severity: input.severity || 'info',
        message: input.message,
        metadata: (input.metadata || {}) as unknown as Record<string, string>,
      },
    });
    return event.id;
  } catch (error) {
    logger.error({ msg: "Failed to record unified event", error: error instanceof Error ? error.message : String(error), eventType: input.eventType, eventSubtype: input.eventSubtype });
    return '';
  }
}

export async function queryEvents(options: {
  eventType?: EventType;
  eventSubtype?: string;
  source?: string;
  userId?: number;
  severity?: Severity;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
} = {}): Promise<{ events: EventRecord[]; total: number }> {
  try {
    const where: Record<string, unknown> = {};
    if (options.eventType) where.eventType = options.eventType;
    if (options.eventSubtype) where.eventSubtype = options.eventSubtype;
    if (options.source) where.source = options.source;
    if (options.userId !== undefined) where.userId = options.userId;
    if (options.severity) where.severity = options.severity;
    if (options.startDate || options.endDate) {
      where.createdAt = {};
      if (options.startDate) (where.createdAt as Record<string, unknown>).gte = options.startDate;
      if (options.endDate) (where.createdAt as Record<string, unknown>).lte = options.endDate;
    }

    const [events, total] = await Promise.all([
      prisma.unifiedEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: options.limit ?? 50,
        skip: options.offset ?? 0,
      }),
      prisma.unifiedEvent.count({ where }),
    ]);

    return { events: events as unknown as EventRecord[], total };
  } catch (error) {
    logger.error({ msg: "Failed to query unified events", error: error instanceof Error ? error.message : String(error) });
    return { events: [], total: 0 };
  }
}

export async function getEventStats(options: {
  startDate?: Date;
  endDate?: Date;
  eventType?: EventType;
} = {}): Promise<{
  total: number;
  byType: Record<string, number>;
  bySeverity: Record<Severity, number>;
  bySource: Record<string, number>;
}> {
  try {
    const where: Record<string, unknown> = {};
    if (options.eventType) where.eventType = options.eventType;
    if (options.startDate || options.endDate) {
      where.createdAt = {};
      if (options.startDate) (where.createdAt as Record<string, unknown>).gte = options.startDate;
      if (options.endDate) (where.createdAt as Record<string, unknown>).lte = options.endDate;
    }

    const events = await prisma.unifiedEvent.findMany({
      where,
      select: { eventType: true, severity: true, source: true },
    });

    const byType: Record<string, number> = {};
    const bySeverity: Record<Severity, number> = { info: 0, warning: 0, critical: 0 };
    const bySource: Record<string, number> = {};

    for (const event of events) {
      const et = event.eventType;
      byType[et] = (byType[et] || 0) + 1;
      const sev = event.severity as Severity;
      if (sev in bySeverity) bySeverity[sev] += 1;
      const src = event.source;
      bySource[src] = (bySource[src] || 0) + 1;
    }

    return { total: events.length, byType, bySeverity, bySource };
  } catch (error) {
    logger.error({ msg: "Failed to get event stats", error: error instanceof Error ? error.message : String(error) });
    return { total: 0, byType: {}, bySeverity: { info: 0, warning: 0, critical: 0 }, bySource: {} };
  }
}

export async function detectAnomalies(options: {
  hours?: number;
} = {}): Promise<{
  anomalies: { type: string; severity: Severity; message: string; details: unknown }[];
}> {
  const hours = options.hours ?? 24;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const anomalies: { type: string; severity: Severity; message: string; details: unknown }[] = [];

  try {
    // Accuracy drop: AI agent success rate < 40%
    const aiEvents = await prisma.unifiedEvent.findMany({
      where: {
        eventType: 'ai_agent',
        createdAt: { gte: since },
        eventSubtype: { in: ['success', 'failure'] },
      },
    });

    if (aiEvents.length >= 10) {
      const failures = aiEvents.filter((e: { eventSubtype: string }) => e.eventSubtype === 'failure').length;
      const successRate = ((aiEvents.length - failures) / aiEvents.length) * 100;
      if (successRate < 40) {
        anomalies.push({
          type: 'accuracy_drop',
          severity: 'critical',
          message: `AI agent success rate dropped to ${successRate.toFixed(1)}% (${failures}/${aiEvents.length} failures)`,
          details: { successRate: parseFloat(successRate.toFixed(1)), failures, total: aiEvents.length },
        });
      }
    }

    // Delivery failures: > 10% of telegram events failed
    const telegramEvents = await prisma.unifiedEvent.findMany({
      where: {
        eventType: 'telegram',
        createdAt: { gte: since },
        eventSubtype: { in: ['broadcast', 'command'] },
      },
    });

    if (telegramEvents.length >= 10) {
      const failedDeliveries = telegramEvents.filter((e: { metadata: unknown }) => {
        const meta = e.metadata as Record<string, unknown> | null;
        return meta?.success === false;
      }).length;
      const failureRate = (failedDeliveries / telegramEvents.length) * 100;
      if (failureRate > 10) {
        anomalies.push({
          type: 'delivery_failure',
          severity: 'warning',
          message: `Telegram delivery failure rate at ${failureRate.toFixed(1)}% (${failedDeliveries}/${telegramEvents.length})`,
          details: { failureRate: parseFloat(failureRate.toFixed(1)), failedDeliveries, total: telegramEvents.length },
        });
      }
    }

    // Provider outage: 3+ consecutive AI agent failures
    const recentAiFailures = await prisma.unifiedEvent.findMany({
      where: {
        eventType: 'ai_agent',
        eventSubtype: 'failure',
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    if (recentAiFailures.length >= 3) {
      const threeMinWindow = Date.now() - 3 * 60 * 1000;
      const recentThree = recentAiFailures.filter((e: { createdAt: Date }) => e.createdAt.getTime() > threeMinWindow);
      if (recentThree.length >= 3) {
        anomalies.push({
          type: 'provider_outage',
          severity: 'critical',
          message: `AI provider may be down: ${recentThree.length} consecutive failures in last 3 minutes`,
          details: { consecutiveFailures: recentThree.length, windowMinutes: 3 },
        });
      }
    }
  } catch (error) {
    logger.error({ msg: "Failed to detect anomalies", error: error instanceof Error ? error.message : String(error) });
  }

  return { anomalies };
}

export async function recordTelegramEvent(
  subtype: string,
  message: string,
  userId?: number,
  metadata?: Record<string, unknown>
): Promise<string> {
  return recordEvent({
    eventType: 'telegram',
    eventSubtype: subtype,
    source: 'telegram_bot',
    userId,
    message,
    metadata,
  });
}

export async function recordAIEvent(
  subtype: string,
  message: string,
  metadata?: Record<string, unknown>
): Promise<string> {
  return recordEvent({
    eventType: 'ai_agent',
    eventSubtype: subtype,
    source: 'recommendation_agent',
    message,
    metadata,
  });
}

export async function recordScreenerEvent(
  subtype: string,
  message: string,
  metadata?: Record<string, unknown>
): Promise<string> {
  return recordEvent({
    eventType: 'screener',
    eventSubtype: subtype,
    source: 'chartink',
    message,
    metadata,
  });
}

export async function recordSystemEvent(
  subtype: string,
  message: string,
  severity: Severity = 'info',
  metadata?: Record<string, unknown>
): Promise<string> {
  return recordEvent({
    eventType: 'system_health',
    eventSubtype: subtype,
    source: 'system',
    message,
    severity,
    metadata,
  });
}
