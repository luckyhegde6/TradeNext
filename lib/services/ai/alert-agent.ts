/**
 * LangGraph-based alert analysis agent.
 * Analyzes triggered alerts and provides market context and actionable insights.
 */
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getLLM, directPrompt } from "./llm-provider";
import { ALERT_SYSTEM_PROMPT, getAlertAnalysisPrompt } from "./prompts";
import type { AIConfig } from "./config";
import logger from "@/lib/logger";

export interface AlertAnalysisResult {
  success: boolean;
  analysis: string;
  executionTimeMs: number;
}

/**
 * Analyze triggered alerts and provide insights.
 * Uses direct prompt (no tool calling needed for alerts).
 */
export async function analyzeAlerts(
  alerts: any[],
  config?: AIConfig
): Promise<AlertAnalysisResult> {
  const startTime = Date.now();

  if (!alerts || alerts.length === 0) {
    return {
      success: true,
      analysis: "No alerts to analyze.",
      executionTimeMs: 0,
    };
  }

  try {
    // Limit alerts to avoid token overflow
    const limitedAlerts = alerts.slice(0, 10);
    const prompt = `${ALERT_SYSTEM_PROMPT}\n\n${getAlertAnalysisPrompt(limitedAlerts)}`;
    const analysis = await directPrompt(prompt, config);

    return {
      success: true,
      analysis,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (err) {
    logger.error({ msg: "Alert analysis agent failed", error: err });
    return {
      success: false,
      analysis: `Alert analysis failed: ${err instanceof Error ? err.message : String(err)}`,
      executionTimeMs: Date.now() - startTime,
    };
  }
}
