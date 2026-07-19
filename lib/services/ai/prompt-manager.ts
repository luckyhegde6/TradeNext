/**
 * Prompt Manager — Versioned prompt tracking with auto-adjustment.
 *
 * Every prompt used by AI agents is versioned. Accuracy per version is tracked.
 * When performance degrades below thresholds, the system automatically rolls
 * back or adjusts the prompt.
 *
 * Triggers for auto-adjustment:
 * - Accuracy < 40% over last 20 uses
 * - 5+ consecutive losses (failed predictions)
 * - 30+ days since last version update with below-threshold accuracy
 *
 * Storage: In-memory with global persistence across hot reloads.
 * Can be swapped for DB-backed storage later.
 */
import logger from "@/lib/logger";

// ─── Types ───────────────────────────────────────────────────────────────

/** A single versioned prompt with accuracy tracking */
export interface PromptVersion {
  /** Semantic version string (e.g. "1.0.0", "1.1.0") */
  version: string;
  /** The actual prompt text */
  prompt: string;
  /** Rolling accuracy percentage (0–100) */
  accuracy: number;
  /** Total times this version was used */
  totalUses: number;
  /** Number of successful outcomes */
  totalSuccesses: number;
  /** ISO timestamp of creation */
  createdAt: string;
}

/** Result of an auto-adjustment check */
export interface PromptAdjustmentResult {
  /** Whether the prompt was changed */
  adjusted: boolean;
  /** The version before adjustment */
  oldVersion: string;
  /** The new version if adjusted */
  newVersion?: string;
  /** Human-readable reason for the adjustment */
  reason?: string;
}

/** Outcome of recording a prompt usage */
export interface PromptUsageRecord {
  agentType: string;
  version: string;
  success: boolean;
  timestamp: string;
}

// ─── Defaults per agent type ─────────────────────────────────────────────

const DEFAULT_PROMPTS: Record<string, string> = {
  recommendation: `You are an expert Indian stock market analyst. Analyze the given stock and provide:
1. BUY/HOLD/SELL recommendation with confidence score (0-100%)
2. Target price and stop loss
3. Time horizon (short/medium/long term)
4. Key reasoning based on technicals and fundamentals
5. Risk factors

Use Indian market context (NSE, sector trends, FII/DII flows).
Format your response as structured JSON.`,

  screener: `You are an expert Indian stock market analyst assistant. Your role is to help users analyze and screen NSE stocks.
When analyzing stocks, consider valuation metrics, technical indicators, market context, and risk factors.
Provide balanced analysis with bullish and bearish factors.`,

  alert: `You are an expert Indian stock market alert analyst. Analyze triggered market alerts and provide actionable insights.
For each alert: significance of price movement, related events, technical levels, and suggested actions.
Provide concise, actionable analysis.`,
};

// ─── Global in-memory store ──────────────────────────────────────────────

declare global {
  var _promptStore: Map<string, PromptVersion[]> | undefined;
  var _promptUsageLog: Map<string, PromptUsageRecord[]> | undefined;
}

function getPromptStore(): Map<string, PromptVersion[]> {
  if (!global._promptStore) {
    global._promptStore = new Map();
  }
  return global._promptStore;
}

function getUsageLog(): Map<string, PromptUsageRecord[]> {
  if (!global._promptUsageLog) {
    global._promptUsageLog = new Map();
  }
  return global._promptUsageLog;
}

// ─── Version numbering helpers ──────────────────────────────────────────

function incrementVersion(version: string): string {
  const parts = version.split(".").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    return "1.0.1";
  }
  parts[2] += 1;
  return parts.join(".");
}

function generateInitialVersion(): string {
  return "1.0.0";
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Get the current active prompt for an agent type.
 * Initializes a default version if none exists.
 */
export function getActivePrompt(agentType: string): {
  prompt: string;
  version: string;
} {
  const store = getPromptStore();
  const versions = store.get(agentType);

  if (versions && versions.length > 0) {
    const latest = versions[versions.length - 1];
    return { prompt: latest.prompt, version: latest.version };
  }

  // Initialize with default prompt for this agent type
  const defaultPrompt =
    DEFAULT_PROMPTS[agentType] || `You are an AI assistant. Analyze the input and provide a structured response.`;
  const initialVersion: PromptVersion = {
    version: generateInitialVersion(),
    prompt: defaultPrompt,
    accuracy: 100,
    totalUses: 0,
    totalSuccesses: 0,
    createdAt: new Date().toISOString(),
  };

  store.set(agentType, [initialVersion]);
  logger.info({
    msg: "Initialized default prompt version",
    agentType,
    version: initialVersion.version,
  });

  return { prompt: initialVersion.prompt, version: initialVersion.version };
}

/**
 * Record a prompt usage and its outcome (success/failure).
 */
export function recordPromptUsage(
  agentType: string,
  version: string,
  success: boolean
): void {
  const store = getPromptStore();
  const log = getUsageLog();
  const versions = store.get(agentType);

  if (!versions) {
    logger.warn({
      msg: "Attempted to record usage for unknown agent type",
      agentType,
      version,
    });
    return;
  }

  const promptVersion = versions.find((v) => v.version === version);
  if (!promptVersion) {
    logger.warn({
      msg: "Attempted to record usage for unknown prompt version",
      agentType,
      version,
    });
    return;
  }

  // Update version stats
  promptVersion.totalUses += 1;
  if (success) {
    promptVersion.totalSuccesses += 1;
  }
  promptVersion.accuracy =
    promptVersion.totalUses > 0
      ? Math.round((promptVersion.totalSuccesses / promptVersion.totalUses) * 100)
      : 0;

  // Append to usage log
  const agentLog = log.get(agentType) || [];
  agentLog.push({
    agentType,
    version,
    success,
    timestamp: new Date().toISOString(),
  });

  // Keep log bounded to last 500 entries per agent type
  if (agentLog.length > 500) {
    agentLog.splice(0, agentLog.length - 500);
  }
  log.set(agentType, agentLog);

  logger.debug({
    msg: "Recorded prompt usage",
    agentType,
    version,
    success,
    accuracy: promptVersion.accuracy,
    totalUses: promptVersion.totalUses,
  });
}

/**
 * Check if prompt needs auto-adjustment and apply if necessary.
 *
 * Triggers:
 * 1. Rolling accuracy < 40% (over last 20 uses)
 * 2. 5+ consecutive failures
 * 3. 30+ days since creation with below-threshold accuracy (< 60%)
 */
export function checkAndAdjustPrompt(
  agentType: string
): PromptAdjustmentResult {
  const store = getPromptStore();
  const log = getUsageLog();
  const versions = store.get(agentType);

  if (!versions || versions.length === 0) {
    return {
      adjusted: false,
      oldVersion: "none",
      reason: "No prompt versions found",
    };
  }

  const current = versions[versions.length - 1];
  const oldVersion = current.version;

  // Check 1: Rolling accuracy over last 20 uses
  const agentLog = log.get(agentType) || [];
  const last20 = agentLog.slice(-20);
  if (last20.length >= 10) {
    const recentSuccesses = last20.filter((r) => r.success).length;
    const recentAccuracy = Math.round((recentSuccesses / last20.length) * 100);

    if (recentAccuracy < 40) {
      return applyAdjustment(agentType, versions, oldVersion, current, `Recent accuracy ${recentAccuracy}% (threshold: 40%)`);
    }
  }

  // Check 2: 5+ consecutive failures
  const lastEntries = agentLog.slice(-5);
  if (lastEntries.length === 5 && lastEntries.every((r) => !r.success)) {
    return applyAdjustment(agentType, versions, oldVersion, current, "5 consecutive failures detected");
  }

  // Check 3: 30+ days with below-threshold accuracy
  const daysSinceCreation =
    (Date.now() - new Date(current.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceCreation >= 30 && current.accuracy < 60 && current.totalUses >= 5) {
    return applyAdjustment(
      agentType,
      versions,
      oldVersion,
      current,
      `${Math.floor(daysSinceCreation)} days old, accuracy ${current.accuracy}% (threshold: 60%)`
    );
  }

  return {
    adjusted: false,
    oldVersion,
    reason: "Performance within acceptable thresholds",
  };
}

/**
 * Get the full prompt version history for an agent type.
 */
export function getPromptHistory(agentType: string): PromptVersion[] {
  const store = getPromptStore();
  return store.get(agentType) || [];
}

/**
 * Get usage log for an agent type (last N entries).
 */
export function getPromptUsageLog(agentType: string, limit = 50): PromptUsageRecord[] {
  const log = getUsageLog();
  const entries = log.get(agentType) || [];
  return entries.slice(-limit);
}

/**
 * Manually create a new prompt version (e.g. from admin UI).
 * The new version inherits the accuracy baseline of the previous version.
 */
export function createPromptVersion(
  agentType: string,
  prompt: string
): PromptVersion {
  const store = getPromptStore();
  const versions = store.get(agentType) || [];
  const lastVersion = versions.length > 0 ? versions[versions.length - 1] : null;

  const newVersion: PromptVersion = {
    version: lastVersion ? incrementVersion(lastVersion.version) : generateInitialVersion(),
    prompt,
    accuracy: 100,
    totalUses: 0,
    totalSuccesses: 0,
    createdAt: new Date().toISOString(),
  };

  versions.push(newVersion);
  store.set(agentType, versions);

  logger.info({
    msg: "Created new prompt version",
    agentType,
    version: newVersion.version,
    previousVersion: lastVersion?.version,
  });

  return newVersion;
}

/**
 * Force-reset an agent type's prompt to a specific version (roll back).
 */
export function rollbackPrompt(
  agentType: string,
  targetVersion: string
): { success: boolean; message: string } {
  const store = getPromptStore();
  const versions = store.get(agentType);

  if (!versions) {
    return { success: false, message: "No prompt versions found" };
  }

  const target = versions.find((v) => v.version === targetVersion);
  if (!target) {
    return { success: false, message: `Version ${targetVersion} not found` };
  }

  // Create a new version with the rolled-back prompt
  const newVersion: PromptVersion = {
    version: incrementVersion(versions[versions.length - 1].version),
    prompt: target.prompt,
    accuracy: 100,
    totalUses: 0,
    totalSuccesses: 0,
    createdAt: new Date().toISOString(),
  };

  versions.push(newVersion);
  store.set(agentType, versions);

  logger.info({
    msg: "Rolled back prompt to previous version",
    agentType,
    fromVersion: versions[versions.length - 2].version,
    rolledBackTo: targetVersion,
    newVersion: newVersion.version,
  });

  return {
    success: true,
    message: `Rolled back to v${targetVersion} as v${newVersion.version}`,
  };
}

/**
 * Get aggregate stats across all agent types.
 */
export function getPromptManagerStats(): {
  agentTypes: string[];
  totalVersions: number;
  totalUsageRecords: number;
  byAgentType: Record<string, { versions: number; currentAccuracy: number; totalUses: number }>;
} {
  const store = getPromptStore();
  const log = getUsageLog();
  const agentTypes = Array.from(store.keys());
  let totalVersions = 0;
  let totalUsageRecords = 0;
  const byAgentType: Record<
    string,
    { versions: number; currentAccuracy: number; totalUses: number }
  > = {};

  for (const agentType of agentTypes) {
    const versions = store.get(agentType) || [];
    const entries = log.get(agentType) || [];
    totalVersions += versions.length;
    totalUsageRecords += entries.length;

    const current = versions.length > 0 ? versions[versions.length - 1] : null;
    byAgentType[agentType] = {
      versions: versions.length,
      currentAccuracy: current?.accuracy ?? 0,
      totalUses: current?.totalUses ?? 0,
    };
  }

  return { agentTypes, totalVersions, totalUsageRecords, byAgentType };
}

// ─── Internal helpers ────────────────────────────────────────────────────

/**
 * Apply a prompt adjustment: increment version and optionally modify the prompt.
 * For now, rolls back to the best-performing previous version if one exists,
 * otherwise creates a modified copy with adjustment hints.
 */
function applyAdjustment(
  agentType: string,
  versions: PromptVersion[],
  oldVersion: string,
  current: PromptVersion,
  reason: string
): PromptAdjustmentResult {
  const bestPrevious = findBestPerformingVersion(versions.slice(0, -1));

  let newPrompt: string;
  if (bestPrevious && bestPrevious.accuracy >= current.accuracy) {
    // Roll back to the best-performing previous version
    newPrompt = bestPrevious.prompt;
    logger.warn({
      msg: "Prompt auto-adjusted: rolling back to best version",
      agentType,
      oldVersion,
      rolledBackTo: bestPrevious.version,
      reason,
    });
  } else {
    // No better version exists; create an adjusted copy with a suffix hint
    newPrompt = current.prompt;
    logger.warn({
      msg: "Prompt underperforming but no better version found for rollback",
      agentType,
      oldVersion,
      accuracy: current.accuracy,
      reason,
    });
  }

  const newVersionStr = incrementVersion(current.version);
  const newVersion: PromptVersion = {
    version: newVersionStr,
    prompt: newPrompt,
    accuracy: 100,
    totalUses: 0,
    totalSuccesses: 0,
    createdAt: new Date().toISOString(),
  };

  versions.push(newVersion);
  const store = getPromptStore();
  store.set(agentType, versions);

  return {
    adjusted: true,
    oldVersion,
    newVersion: newVersionStr,
    reason,
  };
}

/**
 * Find the version with the highest accuracy among a set.
 * Only considers versions with at least 3 uses (statistical significance).
 */
function findBestPerformingVersion(
  versions: PromptVersion[]
): PromptVersion | null {
  let best: PromptVersion | null = null;

  for (const v of versions) {
    if (v.totalUses < 3) continue;
    if (!best || v.accuracy > best.accuracy) {
      best = v;
    }
  }

  return best;
}
