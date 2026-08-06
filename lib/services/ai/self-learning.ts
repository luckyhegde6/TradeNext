/**
 * Self-Learning Loop — Continuous improvement through systematic reflection.
 *
 * Cycles:
 * - **Daily**: Check pending predictions, calculate accuracy, log results, trigger prompt adjustment if needed
 * - **Weekly**: Accuracy trend analysis, pattern identification, improvement recommendations
 * - **Monthly**: Full prompt version review, auto-adjustment, summary report
 *
 * Integrates with:
 * - `prediction-tracker.ts` — outcome tracking and accuracy calculation
 * - `prompt-manager.ts` — prompt versioning and auto-adjustment
 * - `performance-monitor.ts` — degradation detection and metrics
 */
import { calculateAccuracy, shouldAdjustPrompt, checkPredictions } from "./prediction-tracker";
import { checkAndAdjustPrompt, getPromptHistory, getPromptManagerStats } from "./prompt-manager";
import { checkDegradation, getRecommendationMetrics } from "./performance-monitor";
import logger from "@/lib/logger";

// ─── Types ───────────────────────────────────────────────────────────────

/** Daily learning cycle result */
export interface DailyReport {
  date: string;
  accuracy: number;
  predictions: number;
  wins: number;
  losses: number;
  breakeven: number;
  promptAdjusted: boolean;
  adjustmentReason?: string;
}

/** Weekly pattern analysis result */
export interface WeeklyReport {
  weekEnding: string;
  avgAccuracy: number;
  accuracyTrend: "improving" | "stable" | "declining";
  patterns: string[];
  recommendations: string[];
  totalPredictions: number;
}

/** Monthly prompt review result */
export interface MonthlyReport {
  monthEnding: string;
  promptAdjustments: number;
  overallAccuracy: number;
  bestPerformingPrompt: string;
  worstPerformingPrompt: string;
  versionCount: number;
  summary: string;
}

/** Combined learning report */
export interface LearningReport {
  daily: DailyReport;
  weekly: WeeklyReport;
  monthly: MonthlyReport;
}

/** Agent types to monitor in the learning loop */
const MONITORED_AGENT_TYPES = ["recommendation", "screener", "alert"] as const;

// ─── Daily Learning Cycle ───────────────────────────────────────────────

/**
 * Run the daily learning cycle.
 *
 * Steps:
 * 1. Check pending predictions (1w, 1m, 3m intervals)
 * 2. Calculate today's accuracy per agent type
 * 3. Log results
 * 4. Check if any agent type needs prompt adjustment
 */
export async function runDailyLearning(): Promise<DailyReport> {
  const today = new Date().toISOString().slice(0, 10);
  logger.info({ msg: "Starting daily learning cycle", date: today });

  let totalPredictions = 0;
  let totalWins = 0;
  let totalLosses = 0;
  let totalBreakeven = 0;
  let promptAdjusted = false;
  let adjustmentReason: string | undefined;

  try {
    // Step 1: Check pending predictions
    const checkedPredictions = await checkPredictions();
    logger.info({
      msg: "Checked pending predictions",
      count: checkedPredictions.length,
      date: today,
    });

    // Step 2: Calculate accuracy per agent type
    for (const agentType of MONITORED_AGENT_TYPES) {
      try {
        const stats = await calculateAccuracy(agentType, 1);
        totalPredictions += stats.total;
        totalWins += stats.wins;
        totalLosses += stats.losses;
        totalBreakeven += stats.breakeven;

        logger.info({
          msg: "Daily accuracy for agent type",
          agentType,
          accuracy: stats.accuracy,
          wins: stats.wins,
          losses: stats.losses,
          total: stats.total,
        });
      } catch (err) {
        logger.error({
          msg: "Failed to calculate accuracy for agent type",
          agentType,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Step 3: Check if prompt adjustment is needed
    for (const agentType of MONITORED_AGENT_TYPES) {
      try {
        const shouldAdjust = await shouldAdjustPrompt(agentType);
        if (shouldAdjust.shouldAdjust) {
          const result = checkAndAdjustPrompt(agentType);
          if (result.adjusted) {
            promptAdjusted = true;
            adjustmentReason = result.reason;
            logger.warn({
              msg: "Prompt auto-adjusted during daily learning",
              agentType,
              oldVersion: result.oldVersion,
              newVersion: result.newVersion,
              reason: result.reason,
            });
          }
        }
      } catch (err) {
        logger.error({
          msg: "Failed to check prompt adjustment for agent type",
          agentType,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    logger.error({
      msg: "Daily learning cycle encountered an error",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const completedPredictions = totalWins + totalLosses + totalBreakeven;
  const accuracy =
    completedPredictions > 0
      ? Math.round((totalWins / completedPredictions) * 10000) / 100
      : 0;

  const report: DailyReport = {
    date: today,
    accuracy,
    predictions: totalPredictions,
    wins: totalWins,
    losses: totalLosses,
    breakeven: totalBreakeven,
    promptAdjusted,
    adjustmentReason,
  };

  logger.info({
    msg: "Daily learning cycle complete",
    accuracy: report.accuracy,
    predictions: report.predictions,
    promptAdjusted: report.promptAdjusted,
  });

  return report;
}

// ─── Weekly Pattern Analysis ─────────────────────────────────────────────

/**
 * Run weekly pattern analysis.
 *
 * Steps:
 * 1. Calculate weekly accuracy trend (7-day rolling)
 * 2. Identify patterns (which agent types perform best/worst)
 * 3. Generate recommendations for improvement
 */
export async function runWeeklyAnalysis(): Promise<WeeklyReport> {
  const weekEnding = new Date().toISOString().slice(0, 10);
  logger.info({ msg: "Starting weekly analysis", weekEnding });

  const patterns: string[] = [];
  const recommendations: string[] = [];
  let totalPredictions = 0;
  const accuracies: number[] = [];

  try {
    for (const agentType of MONITORED_AGENT_TYPES) {
      try {
        const stats = await calculateAccuracy(agentType, 7);
        totalPredictions += stats.total;
        if (stats.total > 0) {
          accuracies.push(stats.accuracy);

          // Pattern: Identify high/low performing agent types
          if (stats.accuracy >= 70) {
            patterns.push(
              `${agentType} performing well at ${stats.accuracy}% accuracy`
            );
          } else if (stats.accuracy < 40) {
            patterns.push(
              `${agentType} underperforming at ${stats.accuracy}% accuracy`
            );
          }

          // Pattern: Win/loss ratio analysis
          const winRate =
            stats.wins + stats.losses > 0
              ? stats.wins / (stats.wins + stats.losses)
              : 0;
          if (winRate < 0.3) {
            recommendations.push(
              `Review ${agentType} prompt — win rate ${(winRate * 100).toFixed(0)}% below 30%`
            );
          }
        }
      } catch (err) {
        logger.error({
          msg: "Failed to analyze agent type in weekly analysis",
          agentType,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Calculate overall weekly accuracy
    const avgAccuracy =
      accuracies.length > 0
        ? Math.round(
            (accuracies.reduce((a, b) => a + b, 0) / accuracies.length) * 100
          ) / 100
        : 0;

    // Determine trend by comparing first half vs second half of the week
    const trend = await getAccuracyTrend("recommendation", 7);
    let accuracyTrend: "improving" | "stable" | "declining" = "stable";
    if (trend.length >= 4) {
      const midpoint = Math.floor(trend.length / 2);
      const firstHalfAvg =
        trend.slice(0, midpoint).reduce((sum, t) => sum + t.accuracy, 0) /
        midpoint;
      const secondHalfAvg =
        trend.slice(midpoint).reduce((sum, t) => sum + t.accuracy, 0) /
        (trend.length - midpoint);

      if (secondHalfAvg - firstHalfAvg > 5) {
        accuracyTrend = "improving";
      } else if (firstHalfAvg - secondHalfAvg > 5) {
        accuracyTrend = "declining";
      }
    }

    // Add general recommendations
    if (avgAccuracy < 40 && totalPredictions >= 10) {
      recommendations.push(
        "Overall accuracy critically low — consider reviewing all prompt templates"
      );
    }
    if (totalPredictions < 5) {
      recommendations.push(
        "Low prediction volume — ensure daily runs are executing consistently"
      );
    }
    if (patterns.length === 0) {
      patterns.push("No significant patterns detected this week");
    }
    if (recommendations.length === 0) {
      recommendations.push("Performance within acceptable ranges — no changes needed");
    }

    const report: WeeklyReport = {
      weekEnding,
      avgAccuracy,
      accuracyTrend,
      patterns,
      recommendations,
      totalPredictions,
    };

    logger.info({
      msg: "Weekly analysis complete",
      avgAccuracy: report.avgAccuracy,
      trend: report.accuracyTrend,
      patterns: report.patterns.length,
      recommendations: report.recommendations.length,
    });

    return report;
  } catch (err) {
    logger.error({
      msg: "Weekly analysis failed",
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      weekEnding,
      avgAccuracy: 0,
      accuracyTrend: "stable",
      patterns: ["Analysis failed — check logs"],
      recommendations: ["Investigate weekly analysis failure"],
      totalPredictions: 0,
    };
  }
}

// ─── Monthly Prompt Review ──────────────────────────────────────────────

/**
 * Run monthly prompt review.
 *
 * Steps:
 * 1. Review all prompt versions across agent types
 * 2. Compare accuracy across versions
 * 3. Auto-adjust if needed
 * 4. Generate summary report
 */
export async function runMonthlyReview(): Promise<MonthlyReport> {
  const monthEnding = new Date().toISOString().slice(0, 10);
  logger.info({ msg: "Starting monthly prompt review", monthEnding });

  let promptAdjustments = 0;
  let bestPerformingPrompt = "none";
  let worstPerformingPrompt = "none";
  let bestAccuracy = -1;
  let worstAccuracy = 101;
  let totalVersionCount = 0;
  let overallAccuracySum = 0;
  let accuracySamples = 0;

  try {
    // Step 1: Review all prompt versions
    const stats = getPromptManagerStats();

    for (const agentType of stats.agentTypes) {
      const history = getPromptHistory(agentType);
      totalVersionCount += history.length;

      // Find best/worst performing versions
      for (const version of history) {
        if (version.totalUses >= 3) {
          if (version.accuracy > bestAccuracy) {
            bestAccuracy = version.accuracy;
            bestPerformingPrompt = `${agentType} v${version.version}`;
          }
          if (version.accuracy < worstAccuracy) {
            worstAccuracy = version.accuracy;
            worstPerformingPrompt = `${agentType} v${version.version}`;
          }
        }
      }

      // Step 2: Get accuracy for this agent type
      try {
        const accuracyData = await calculateAccuracy(agentType, 30);
        if (accuracyData.total > 0) {
          overallAccuracySum += accuracyData.accuracy;
          accuracySamples += 1;
        }
      } catch (err) {
        logger.error({
          msg: "Failed to get accuracy for monthly review",
          agentType,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Step 3: Check if adjustment is needed
      try {
        const shouldAdjust = await shouldAdjustPrompt(agentType);
        if (shouldAdjust.shouldAdjust) {
          const result = checkAndAdjustPrompt(agentType);
          if (result.adjusted) {
            promptAdjustments += 1;
            logger.info({
              msg: "Monthly review triggered prompt adjustment",
              agentType,
              oldVersion: result.oldVersion,
              newVersion: result.newVersion,
              reason: result.reason,
            });
          }
        }
      } catch (err) {
        logger.error({
          msg: "Failed to adjust prompt during monthly review",
          agentType,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const overallAccuracy =
      accuracySamples > 0
        ? Math.round((overallAccuracySum / accuracySamples) * 100) / 100
        : 0;

    // Generate summary
    const summaryParts: string[] = [];
    summaryParts.push(
      `Reviewed ${totalVersionCount} prompt versions across ${stats.agentTypes.length} agent types.`
    );
    summaryParts.push(`Overall accuracy: ${overallAccuracy}%.`);
    if (promptAdjustments > 0) {
      summaryParts.push(`${promptAdjustments} prompt(s) auto-adjusted.`);
    }
    if (bestAccuracy >= 0) {
      summaryParts.push(
        `Best: ${bestPerformingPrompt} (${bestAccuracy}%).`
      );
    }
    if (worstAccuracy <= 100) {
      summaryParts.push(
        `Worst: ${worstPerformingPrompt} (${worstAccuracy}%).`
      );
    }

    const report: MonthlyReport = {
      monthEnding,
      promptAdjustments,
      overallAccuracy,
      bestPerformingPrompt,
      worstPerformingPrompt,
      versionCount: totalVersionCount,
      summary: summaryParts.join(" "),
    };

    logger.info({
      msg: "Monthly prompt review complete",
      adjustments: report.promptAdjustments,
      accuracy: report.overallAccuracy,
      versions: report.versionCount,
    });

    return report;
  } catch (err) {
    logger.error({
      msg: "Monthly review failed",
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      monthEnding,
      promptAdjustments: 0,
      overallAccuracy: 0,
      bestPerformingPrompt: "unknown",
      worstPerformingPrompt: "unknown",
      versionCount: 0,
      summary: "Monthly review failed — check logs",
    };
  }
}

// ─── Comprehensive Report ───────────────────────────────────────────────

/**
 * Get a comprehensive learning report combining daily, weekly, and monthly data.
 * Runs all three cycles and returns the combined result.
 */
export async function getLearningReport(): Promise<LearningReport> {
  logger.info({ msg: "Generating comprehensive learning report" });

  const [daily, weekly, monthly] = await Promise.all([
    runDailyLearning(),
    runWeeklyAnalysis(),
    runMonthlyReview(),
  ]);

  const report: LearningReport = { daily, weekly, monthly };

  logger.info({
    msg: "Comprehensive learning report generated",
    dailyAccuracy: daily.accuracy,
    weeklyAvgAccuracy: weekly.avgAccuracy,
    monthlyAccuracy: monthly.overallAccuracy,
    promptAdjustments: monthly.promptAdjustments,
  });

  return report;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Get accuracy trend for an agent type (re-exports from prediction-tracker).
 * Wrapped here for convenience so consumers can import from self-learning.
 */
async function getAccuracyTrend(
  agentType: string,
  days?: number
): Promise<Array<{ date: string; accuracy: number; totalPredictions: number }>> {
  try {
    const { getAccuracyTrend: getTrend } = await import("./prediction-tracker");
    return await getTrend(agentType, days);
  } catch {
    return [];
  }
}
