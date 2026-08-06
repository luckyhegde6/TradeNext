import { buildAlertEmailHtml } from "../delivery/email";
import type { EmailConfig } from "../delivery/email";

/**
 * Validates an email config before sending.
 * Returns null if valid, or an error message string.
 */
function validateEmailConfig(config: EmailConfig): string | null {
  if (!config.smtpHost) return "Missing SMTP host";
  if (!config.smtpUser) return "Missing SMTP username";
  if (!config.smtpPass) return "Missing SMTP password";
  if (!config.fromEmail) return "Missing sender email";
  if (!config.toEmail) return "Missing recipient email";
  return null;
}

describe("buildAlertEmailHtml", () => {
  it("generates HTML with rule name and message", () => {
    const html = buildAlertEmailHtml({
      ruleName: "RSI Oversold",
      message: "RELIANCE RSI dropped to 28",
      link: "/alerts/rules/123",
    });
    expect(html).toContain("RSI Oversold");
    expect(html).toContain("RELIANCE RSI dropped to 28");
    expect(html).toContain("View Details");
  });

  it("includes price info when provided", () => {
    const html = buildAlertEmailHtml({
      ruleName: "Price Alert",
      message: "TCS crossed target",
      price: 4050,
      change: 125,
      pChange: 3.18,
      link: "/alerts",
    });
    expect(html).toContain("4,050");
    expect(html).toContain("+125");
    expect(html).toContain("3.18");
  });

  it("shows negative change in red", () => {
    const html = buildAlertEmailHtml({
      ruleName: "Price Drop",
      message: "RELIANCE dropped",
      price: 2300,
      change: -75,
      pChange: -3.15,
    });
    // Should contain negative values
    expect(html).toContain("-75");
    expect(html).toContain("3.15");
  });

  it("handles minimal params gracefully", () => {
    const html = buildAlertEmailHtml({
      ruleName: "Test",
      message: "",
    });
    expect(html).toContain("Test");
    expect(html).toContain("TradeNext Alert");
    expect(html).toContain("</html>");
  });
});

describe("validateEmailConfig", () => {
  it("returns null for a valid config", () => {
    const config: EmailConfig = {
      smtpHost: "smtp.gmail.com",
      smtpPort: 587,
      smtpUser: "test@gmail.com",
      smtpPass: "app-password",
      fromEmail: "test@gmail.com",
      toEmail: "user@example.com",
    };
    expect(validateEmailConfig(config)).toBeNull();
  });

  it("returns error for missing host", () => {
    const config: EmailConfig = {
      smtpHost: "",
      smtpPort: 587,
      smtpUser: "test@gmail.com",
      smtpPass: "app-password",
      fromEmail: "test@gmail.com",
      toEmail: "user@example.com",
    };
    expect(validateEmailConfig(config)).toContain("host");
  });

  it("returns error for missing recipient", () => {
    const config: EmailConfig = {
      smtpHost: "smtp.gmail.com",
      smtpPort: 587,
      smtpUser: "test@gmail.com",
      smtpPass: "app-password",
      fromEmail: "test@gmail.com",
      toEmail: "",
    };
    expect(validateEmailConfig(config)).toContain("recipient");
  });

  it("returns error for missing sender", () => {
    const config: EmailConfig = {
      smtpHost: "smtp.gmail.com",
      smtpPort: 587,
      smtpUser: "test@gmail.com",
      smtpPass: "app-password",
      fromEmail: "",
      toEmail: "user@example.com",
    };
    expect(validateEmailConfig(config)).toContain("sender");
  });

  it("returns error for missing password", () => {
    const config: EmailConfig = {
      smtpHost: "smtp.gmail.com",
      smtpPort: 587,
      smtpUser: "test@gmail.com",
      smtpPass: "",
      fromEmail: "test@gmail.com",
      toEmail: "user@example.com",
    };
    expect(validateEmailConfig(config)).toContain("password");
  });
});
