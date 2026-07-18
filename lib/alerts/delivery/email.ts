/**
 * Email Delivery Channel — sends alert notifications via SMTP using nodemailer.
 *
 * Works with any SMTP-compatible provider: Gmail, SendGrid, Mailgun, etc.
 * Configure via AlertChannel.config JSON:
 * {
 *   "smtpHost": "smtp.gmail.com",
 *   "smtpPort": 587,
 *   "smtpUser": "user@gmail.com",
 *   "smtpPass": "app-password",
 *   "fromEmail": "alerts@tradenext.app",
 *   "toEmail": "user@example.com"
 * }
 */

import nodemailer from "nodemailer";
import logger from "@/lib/logger";

export interface EmailConfig {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  fromEmail: string;
  toEmail: string;
}

export interface DeliveryResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send an email alert via SMTP.
 */
export async function sendEmailAlert(
  config: EmailConfig,
  subject: string,
  htmlBody: string
): Promise<DeliveryResult> {
  try {
    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      auth: {
        user: config.smtpUser,
        pass: config.smtpPass,
      },
    });

    const info = await transporter.sendMail({
      from: config.fromEmail,
      to: config.toEmail,
      subject,
      html: htmlBody,
    });

    logger.info({
      msg: "Email alert sent",
      to: config.toEmail,
      messageId: info.messageId,
    });

    return { success: true, messageId: info.messageId };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({
      msg: "Email alert delivery failed",
      to: config.toEmail,
      error: errorMsg,
    });
    return { success: false, error: errorMsg };
  }
}

/**
 * Build an HTML email body for an alert notification.
 */
export function buildAlertEmailHtml(params: {
  ruleName: string;
  symbol?: string;
  price?: number;
  change?: number;
  pChange?: number;
  message: string;
  link?: string;
}): string {
  const { ruleName, symbol, price, change, pChange, message, link } = params;

  const priceHtml = price
    ? `<p style="font-size: 24px; font-weight: bold; color: ${(change || 0) >= 0 ? "#16a34a" : "#dc2626"};">
         ₹${price.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
         ${change !== undefined ? `<span style="font-size: 14px;">${change >= 0 ? "+" : ""}${change.toFixed(2)} (${pChange?.toFixed(2) ?? 0}%)</span>` : ""}
       </p>`
    : "";

  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: Arial, sans-serif; background: #f4f4f5; padding: 24px;">
      <div style="max-width: 480px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
        <div style="background: #2563eb; padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 20px;">🚨 TradeNext Alert</h1>
        </div>
        <div style="padding: 24px;">
          <h2 style="margin: 0 0 8px; font-size: 18px; color: #1a1a2e;">${ruleName}</h2>
          ${symbol ? `<p style="color: #6b7280; font-size: 14px; margin: 0 0 12px;">Symbol: <strong>${symbol}</strong></p>` : ""}
          ${priceHtml}
          <p style="color: #374151; font-size: 14px; line-height: 1.5;">${message}</p>
          ${link ? `<p style="margin-top: 20px;"><a href="${link}" style="display: inline-block; background: #2563eb; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: bold;">View Details →</a></p>` : ""}
        </div>
        <div style="background: #f4f4f5; padding: 12px 24px; text-align: center; font-size: 11px; color: #9ca3af;">
          TradeNext — NSE Market Intelligence
        </div>
      </div>
    </body>
    </html>
  `;
}
