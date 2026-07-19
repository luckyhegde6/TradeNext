import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

export type MetricType = 'ai_response_time' | 'screener_duration' | 'delivery_rate' | 'db_query_time' | 'uptime';

export interface HealthMetric {
  metricType: MetricType;
  metricName: string;
  value: number;
  unit: string;
  source: string;
  metadata?: Record<string, unknown>;
}

export interface HealthSummary {
  overall: 'healthy' | 'degraded' | 'critical';
  metrics: {
    avgAiResponseTime: number;
    avgScreenerDuration: number;
    deliverySuccessRate: number;
    dbQueryAvgTime: number;
    uptime: number;
  };
  alerts: string[];
}

export interface MetricPoint {
  timestamp: string;
  value: number;
  name: string;
}

export async function recordMetric(metric: HealthMetric): Promise<void> {
  try {
    await prisma.systemHealthLog.create({
      data: {
        metricType: metric.metricType,
        metricName: metric.metricName,
        value: metric.value,
        unit: metric.unit,
        source: metric.source,
        metadata: (metric.metadata || {}) as unknown as Record<string, string>,
      },
    });
  } catch (error) {
    logger.error({ msg: "Failed to record health metric", error: error instanceof Error ? error.message : String(error), metricType: metric.metricType, metricName: metric.metricName });
  }
}

export async function recordAiResponseTime(
  name: string,
  ms: number,
  source: string = 'recommendation_agent',
  metadata?: Record<string, unknown>
): Promise<void> {
  return recordMetric({
    metricType: 'ai_response_time',
    metricName: name,
    value: ms,
    unit: 'ms',
    source,
    metadata,
  });
}

export async function recordScreenerDuration(
  durationMs: number,
  source: string = 'chartink',
  metadata?: Record<string, unknown>
): Promise<void> {
  return recordMetric({
    metricType: 'screener_duration',
    metricName: 'screener_duration',
    value: durationMs,
    unit: 'ms',
    source,
    metadata,
  });
}

export async function recordDeliveryRate(
  successRate: number,
  source: string = 'telegram',
  metadata?: Record<string, unknown>
): Promise<void> {
  return recordMetric({
    metricType: 'delivery_rate',
    metricName: 'delivery_rate',
    value: successRate,
    unit: 'percent',
    source,
    metadata,
  });
}

export async function recordDbQueryTime(
  name: string,
  ms: number,
  source: string = 'system',
  metadata?: Record<string, unknown>
): Promise<void> {
  return recordMetric({
    metricType: 'db_query_time',
    metricName: name,
    value: ms,
    unit: 'ms',
    source,
    metadata,
  });
}

export async function recordUptime(
  uptimeMinutes: number,
  source: string = 'system',
  metadata?: Record<string, unknown>
): Promise<void> {
  return recordMetric({
    metricType: 'uptime',
    metricName: 'uptime',
    value: uptimeMinutes,
    unit: 'minutes',
    source,
    metadata,
  });
}

export async function getHealthSummary(options: {
  hours?: number;
  source?: string;
} = {}): Promise<HealthSummary> {
  const hours = options.hours ?? 24;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const alerts: string[] = [];

  try {
    const where: Record<string, unknown> = {
      createdAt: { gte: since },
    };
    if (options.source) where.source = options.source;

    const recentMetrics = await prisma.systemHealthLog.findMany({ where });

    let totalAiResponse = 0;
    let aiCount = 0;
    let totalScreenerDuration = 0;
    let screenerCount = 0;
    let totalDeliverySuccess = 0;
    let deliveryCount = 0;
    let totalDbQuery = 0;
    let dbCount = 0;

    for (const m of recentMetrics) {
      switch (m.metricType) {
        case 'ai_response_time':
          totalAiResponse += m.value;
          aiCount++;
          break;
        case 'screener_duration':
          totalScreenerDuration += m.value;
          screenerCount++;
          break;
        case 'delivery_rate':
          totalDeliverySuccess += m.value;
          deliveryCount++;
          break;
        case 'db_query_time':
          totalDbQuery += m.value;
          dbCount++;
          break;
      }
    }

    const avgAiResponse = aiCount > 0 ? totalAiResponse / aiCount : 0;
    const avgScreenerDuration = screenerCount > 0 ? totalScreenerDuration / screenerCount : 0;
    const deliverySuccessRate = deliveryCount > 0 ? totalDeliverySuccess / deliveryCount : 100;
    const avgDbQuery = dbCount > 0 ? totalDbQuery / dbCount : 0;

    // Determine overall health
    let overall: HealthSummary['overall'] = 'healthy';

    if (avgAiResponse > 30000) {
      alerts.push(`AI response time is high: ${Math.round(avgAiResponse)}ms (threshold: 30000ms)`);
      if (avgAiResponse > 60000) overall = 'critical';
      else if (overall === 'healthy') overall = 'degraded';
    }

    if (deliverySuccessRate < 90) {
      alerts.push(`Delivery success rate is low: ${deliverySuccessRate.toFixed(1)}% (threshold: 90%)`);
      if (deliverySuccessRate < 60) overall = 'critical';
      else if (overall === 'healthy') overall = 'degraded';
    }

    if (avgScreenerDuration > 60000) {
      alerts.push(`Screener duration is high: ${Math.round(avgScreenerDuration)}ms`);
      if (overall === 'healthy') overall = 'degraded';
    }

    if (recentMetrics.length === 0 && hours <= 2) {
      const staleMinutes = Math.round((Date.now() - since.getTime()) / 60000);
      if (staleMinutes > 10) {
        const level = staleMinutes > 30 ? 'critical' : 'degraded';
        if (overall === 'healthy' || level === 'critical') {
          overall = 'critical';
        } else {
          overall = 'degraded';
        }
        alerts.push(`No health metrics received in the last ${staleMinutes} minutes`);
      }
    }

    return {
      overall,
      metrics: {
        avgAiResponseTime: Math.round(avgAiResponse),
        avgScreenerDuration: Math.round(avgScreenerDuration),
        deliverySuccessRate: parseFloat(deliverySuccessRate.toFixed(1)),
        dbQueryAvgTime: Math.round(avgDbQuery),
        uptime: 100,
      },
      alerts,
    };
  } catch (error) {
    logger.error({ msg: "Failed to compute health summary", error: error instanceof Error ? error.message : String(error) });
    return {
      overall: 'degraded',
      metrics: {
        avgAiResponseTime: 0,
        avgScreenerDuration: 0,
        deliverySuccessRate: 0,
        dbQueryAvgTime: 0,
        uptime: 0,
      },
      alerts: ['Could not compute health summary'],
    };
  }
}

export async function getMetricHistory(
  metricType: MetricType,
  options: {
    hours?: number;
    source?: string;
    bucketMinutes?: number;
  } = {}
): Promise<MetricPoint[]> {
  const hours = options.hours ?? 24;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  try {
    const where: Record<string, unknown> = {
      metricType,
      createdAt: { gte: since },
    };
    if (options.source) where.source = options.source;

    const metrics = await prisma.systemHealthLog.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });

    const bucketMinutes = options.bucketMinutes ?? 30;
    const bucketMs = bucketMinutes * 60 * 1000;

    const buckets: Record<string, { sum: number; count: number; name: string }> = {};
    for (const m of metrics) {
      const bucketKey = Math.floor(m.createdAt.getTime() / bucketMs).toString();
      if (!buckets[bucketKey]) {
        buckets[bucketKey] = { sum: 0, count: 0, name: m.metricName };
      }
      buckets[bucketKey].sum += m.value;
      buckets[bucketKey].count++;
    }

    return Object.entries(buckets).map(([bucketKey, b]) => ({
      timestamp: new Date(parseInt(bucketKey) * bucketMs).toISOString(),
      value: parseFloat((b.sum / b.count).toFixed(2)),
      name: b.name,
    }));
  } catch (error) {
    logger.error({ msg: "Failed to retrieve metric history", error: error instanceof Error ? error.message : String(error), metricType });
    return [];
  }
}
