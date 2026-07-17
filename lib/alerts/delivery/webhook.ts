/**
 * Webhook Delivery Channel — sends alert notifications to user-configured URLs.
 *
 * Supports any webhook-compatible service: Discord, Slack, custom endpoints.
 * Configure via AlertChannel.config JSON:
 * {
 *   "url": "https://hooks.slack.com/services/xxx",
 *   "method": "POST",
 *   "headers": { "Authorization": "Bearer xxx" },
 *   "format": "slack" | "discord" | "generic"
 * }
 */

import logger from "@/lib/logger";

/**
 * Validates a webhook config before sending.
 * Returns null if valid, or an error message string.
 */
export function validateWebhookConfig(config: WebhookConfig): string | null {
  if (!config.url) return "Missing webhook URL";
  try {
    new URL(config.url);
  } catch {
    return "Invalid webhook URL format";
  }
  if (config.format && !["slack", "discord", "generic"].includes(config.format)) {
    return `Unsupported webhook format: ${config.format}`;
  }
  return null;
}

export interface WebhookConfig {
  url: string;
  method?: "POST" | "PUT";
  headers?: Record<string, string>;
  format?: "slack" | "discord" | "generic";
}

export interface DeliveryResult {
  success: boolean;
  statusCode?: number;
  error?: string;
}

/**
 * Send a webhook alert.
 */
export async function sendWebhookAlert(
  config: WebhookConfig,
  payload: Record<string, unknown>
): Promise<DeliveryResult> {
  try {
    let body: string;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(config.headers || {}),
    };

    // Format payload based on target platform
    if (config.format === "slack") {
      body = JSON.stringify(formatSlackPayload(payload));
    } else if (config.format === "discord") {
      body = JSON.stringify(formatDiscordPayload(payload));
    } else {
      body = JSON.stringify(payload);
    }

    const response = await fetch(config.url, {
      method: config.method || "POST",
      headers,
      body,
    });

    logger.info({
      msg: "Webhook alert sent",
      url: config.url,
      statusCode: response.status,
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => "");
      return {
        success: false,
        statusCode: response.status,
        error: `HTTP ${response.status}: ${responseText.slice(0, 200)}`,
      };
    }

    return { success: true, statusCode: response.status };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({
      msg: "Webhook alert delivery failed",
      url: config.url,
      error: errorMsg,
    });
    return { success: false, error: errorMsg };
  }
}

export function formatSlackPayload(data: Record<string, unknown>) {
  return {
    text: `*${data.title || "TradeNext Alert"}*\n${data.message || ""}`,
    attachments: data.fields
      ? [
          {
            color: (data as any).color || "#2563eb",
            fields: Object.entries((data as any).fields).map(
              ([title, value]: [string, unknown]) => ({
                title,
                value: String(value),
                short: true,
              })
            ),
          },
        ]
      : [],
  };
}

export function formatDiscordPayload(data: Record<string, unknown>) {
  return {
    embeds: [
      {
        title: data.title || "TradeNext Alert",
        description: data.message || "",
        color:
          (data as any).color === "red"
            ? 0xdc2626
            : (data as any).color === "green"
              ? 0x16a34a
              : 0x2563eb,
        fields: data.fields
          ? Object.entries((data as any).fields).map(
              ([name, value]: [string, unknown]) => ({
                name,
                value: String(value),
                inline: true,
              })
            )
          : [],
        timestamp: new Date().toISOString(),
      },
    ],
  };
}
