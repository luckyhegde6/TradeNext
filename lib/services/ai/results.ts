/**
 * AI Results Store — Stores all AI analysis results with correlation.
 *
 * Features:
 * - Persist all AI analysis outputs with metadata
 * - Correlation engine: link related analyses across types/entities
 * - Trend tracking: analyze sentiment/market over time
 * - Metadata extraction for structured filtering
 * - Result retrieval with pagination and type filters
 */
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";

// ─── Types ───────────────────────────────────────────────────────────────

export type AnalysisType = "screener" | "dividend" | "portfolio" | "market" | "alert" | "custom";

export interface AIAnalysisRecord {
  id: string;
  userId: number;
  analysisType: AnalysisType;
  query: string;
  result: string;
  model: string;
  tokensUsed: number;
  executionTime: number;
  success: boolean;
  errorMessage: string | null;
  conversationId: string | null;
  metadata: Record<string, any> | null;
  createdAt: string;
}

export interface StoredResultInput {
  userId: number;
  analysisType: AnalysisType;
  query: string;
  result: string;
  model: string;
  tokensUsed?: number;
  executionTime?: number;
  success?: boolean;
  errorMessage?: string;
  conversationId?: string;
  metadata?: Record<string, any>;
}

// ─── Store ───────────────────────────────────────────────────────────────

/**
 * Store an AI analysis result.
 */
export async function storeResult(input: StoredResultInput): Promise<AIAnalysisRecord> {
  const record = await prisma.aIAnalysis.create({
    data: {
      userId: input.userId,
      analysisType: input.analysisType,
      query: input.query,
      result: input.result,
      model: input.model,
      tokensUsed: input.tokensUsed || 0,
      executionTime: input.executionTime || 0,
      success: input.success ?? true,
      errorMessage: input.errorMessage || null,
      conversationId: input.conversationId || null,
      metadata: (input.metadata as any) || null,
    },
  });
  return mapRecord(record);
}

/**
 * Get stored results with pagination and filtering.
 */
export async function getResults(
  userId: number,
  options?: {
    analysisType?: AnalysisType;
    limit?: number;
    offset?: number;
    success?: boolean;
    daysBack?: number;
  }
): Promise<{ results: AIAnalysisRecord[]; total: number }> {
  const where: any = { userId };
  if (options?.analysisType) where.analysisType = options.analysisType;
  if (options?.success !== undefined) where.success = options.success;
  if (options?.daysBack) {
    where.createdAt = { gte: new Date(Date.now() - options.daysBack * 86400000) };
  }

  const [results, total] = await Promise.all([
    prisma.aIAnalysis.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: options?.limit || 20,
      skip: options?.offset || 0,
    }),
    prisma.aIAnalysis.count({ where }),
  ]);

  return { results: results.map(mapRecord), total };
}

/**
 * Get a single result by ID.
 */
export async function getResultById(id: string, userId: number): Promise<AIAnalysisRecord | null> {
  const record = await prisma.aIAnalysis.findFirst({ where: { id, userId } });
  return record ? mapRecord(record) : null;
}

/**
 * Delete old results for cleanup.
 */
export async function cleanupResults(retentionDays: number = 90): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 86400000);
  const result = await prisma.aIAnalysis.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return result.count;
}

// ─── Correlation Engine ──────────────────────────────────────────────────

export interface EntityMention {
  symbol?: string;
  sector?: string;
  analysisType: AnalysisType;
  resultId: string;
  createdAt: string;
  sentiment?: "bullish" | "bearish" | "neutral";
}

/**
 * Extract stock symbols from analysis metadata or content.
 */
function extractSymbols(metadata: Record<string, any> | null, query: string): string[] {
  const symbols: Set<string> = new Set();

  // From metadata
  if (metadata?.symbols && Array.isArray(metadata.symbols)) {
    metadata.symbols.forEach((s: string) => symbols.add(s.toUpperCase()));
  }

  // From query text — find uppercase 1-5 letter words (common NSE symbols)
  const matches = query.match(/\b[A-Z]{2,5}\b/g);
  if (matches) {
    matches.forEach((s) => symbols.add(s));
  }

  return [...symbols];
}

/**
 * Extract sentiment from analysis result and metadata.
 */
function detectSentiment(metadata: Record<string, any> | null, result: string): "bullish" | "bearish" | "neutral" {
  if (metadata?.sentiment) return metadata.sentiment;

  const lower = result.toLowerCase();
  const bullish = (lower.match(/bullish|buy|strong|positive|growth|outperform/g) || []).length;
  const bearish = (lower.match(/bearish|sell|weak|negative|decline|underperform/g) || []).length;

  if (bullish > bearish + 1) return "bullish";
  if (bearish > bullish + 1) return "bearish";
  return "neutral";
}

/**
 * Find correlated analyses — results that reference the same entities.
 */
export async function findCorrelations(
  userId: number,
  opt?: { analysisType?: AnalysisType; symbol?: string; daysBack?: number; limit?: number }
): Promise<{
  correlations: {
    entity: string;
    type: "symbol" | "sector" | "analysis";
    mentions: EntityMention[];
    totalMentions: number;
    dominantSentiment: "bullish" | "bearish" | "neutral";
  }[];
  total: number;
}> {
  const where: any = { userId };
  if (opt?.analysisType) where.analysisType = opt.analysisType;
  if (opt?.daysBack) {
    where.createdAt = { gte: new Date(Date.now() - opt.daysBack * 86400000) };
  }

  const records = await prisma.aIAnalysis.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: opt?.limit || 100,
  });

  if (records.length === 0) return { correlations: [], total: 0 };

  // Build entity mention map
  const entityMap = new Map<string, EntityMention[]>();

  for (const record of records) {
    const metadata = record.metadata as Record<string, any> | null;
    const symbols = extractSymbols(metadata, record.query);
    const sentiment = detectSentiment(metadata, record.result);

    const mention: EntityMention = {
      analysisType: record.analysisType as AnalysisType,
      resultId: record.id,
      createdAt: record.createdAt.toISOString(),
      sentiment,
    };

    for (const symbol of symbols) {
      const key = `sym:${symbol}`;
      if (!entityMap.has(key)) entityMap.set(key, []);
      entityMap.get(key)!.push({ ...mention, symbol });
    }

    // Also correlate by analysis type
    const typeKey = `type:${record.analysisType}`;
    if (!entityMap.has(typeKey)) entityMap.set(typeKey, []);
    entityMap.get(typeKey)!.push({ ...mention, symbol: undefined });
  }

  // Filter by symbol if requested
  const filteredEntries = opt?.symbol
    ? [...entityMap.entries()].filter(([k]) => k === `sym:${(opt.symbol || "").toUpperCase()}`)
    : [...entityMap.entries()];

  const correlations = filteredEntries
    .map(([key, mentions]) => {
      const isSymbol = key.startsWith("sym:");
      const sentiments = mentions.map((m) => m.sentiment || "neutral");
      const bullish = sentiments.filter((s) => s === "bullish").length;
      const bearish = sentiments.filter((s) => s === "bearish").length;
      const dominantSentiment: "bullish" | "bearish" | "neutral" =
        bullish > bearish ? "bullish" : bearish > bullish ? "bearish" : "neutral";

      return {
        entity: isSymbol ? key.slice(4) : key.slice(5),
        type: isSymbol ? "symbol" as const : "analysis" as const,
        mentions: mentions.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        totalMentions: mentions.length,
        dominantSentiment,
      };
    })
    .sort((a, b) => b.totalMentions - a.totalMentions);

  return { correlations: correlations.slice(0, 20), total: correlations.length };
}

/**
 * Get aggregate stats for the AI dashboard.
 */
export async function getAggregateStats(userId: number): Promise<{
  totalAnalyses: number;
  byType: Record<string, number>;
  totalTokens: number;
  avgExecutionTime: number;
  successRate: number;
  recentTopics: string[];
}> {
  const records = await prisma.aIAnalysis.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const byType: Record<string, number> = {};
  let totalTokens = 0;
  let totalTime = 0;
  let successes = 0;

  for (const r of records) {
    byType[r.analysisType] = (byType[r.analysisType] || 0) + 1;
    totalTokens += r.tokensUsed;
    totalTime += r.executionTime;
    if (r.success) successes++;
  }

  // Extract recent topics from queries
  const recentQueries = records.slice(0, 20).map((r) => r.query);
  const wordCounts = new Map<string, number>();
  for (const q of recentQueries) {
    const words = q.split(/\s+/).filter((w) => w.length > 3);
    for (const w of words) {
      wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
    }
  }
  const recentTopics = [...wordCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);

  return {
    totalAnalyses: records.length,
    byType,
    totalTokens,
    avgExecutionTime: records.length > 0 ? Math.round(totalTime / records.length) : 0,
    successRate: records.length > 0 ? Math.round((successes / records.length) * 100) : 100,
    recentTopics,
  };
}

// ─── Mapping ─────────────────────────────────────────────────────────────

function mapRecord(r: any): AIAnalysisRecord {
  return {
    id: r.id,
    userId: r.userId,
    analysisType: r.analysisType as AnalysisType,
    query: r.query,
    result: r.result,
    model: r.model,
    tokensUsed: r.tokensUsed,
    executionTime: r.executionTime,
    success: r.success,
    errorMessage: r.errorMessage,
    conversationId: r.conversationId,
    metadata: r.metadata as Record<string, any> | null,
    createdAt: r.createdAt?.toISOString(),
  };
}
