import { formatSlackPayload, formatDiscordPayload, validateWebhookConfig } from "../delivery/webhook";
import type { WebhookConfig } from "../delivery/webhook";

describe("formatSlackPayload", () => {
  it("formats Slack-compatible payload with fields", () => {
    const result = formatSlackPayload({
      title: "Alert Triggered",
      message: "RELIANCE crossed ₹3000",
      fields: {
        Symbol: "RELIANCE",
        Price: "₹3,050",
        Change: "+2.5%",
      },
      color: "good",
    });

    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("attachments");
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].color).toBe("good");
    expect(result.attachments[0].fields).toHaveLength(3);
    expect(result.attachments[0].fields[0]).toMatchObject({
      title: "Symbol",
      value: "RELIANCE",
      short: true,
    });
  });

  it("returns empty attachments when no fields provided", () => {
    const result = formatSlackPayload({
      title: "Test",
      message: "test message",
    });
    expect(result.attachments).toEqual([]);
  });
});

describe("formatDiscordPayload", () => {
  it("formats Discord-compatible payload with fields", () => {
    const result = formatDiscordPayload({
      title: "Alert Triggered",
      message: "RELIANCE crossed ₹3000",
      fields: {
        Symbol: "RELIANCE",
        Price: "₹3,050",
      },
      color: "green",
    });

    expect(result).toHaveProperty("embeds");
    expect(result.embeds).toHaveLength(1);
    expect(result.embeds[0]).toMatchObject({
      title: "Alert Triggered",
      description: "RELIANCE crossed ₹3000",
      color: 0x16a34a,
    });
    expect(result.embeds[0].fields).toHaveLength(2);
    expect(result.embeds[0]).toHaveProperty("timestamp");
  });

  it("applies correct color mapping for all statuses", () => {
    const red = formatDiscordPayload({ color: "red" });
    expect(red.embeds[0].color).toBe(0xdc2626);

    const blue = formatDiscordPayload({ color: "blue" });
    expect(blue.embeds[0].color).toBe(0x2563eb);

    const green = formatDiscordPayload({ color: "green" });
    expect(green.embeds[0].color).toBe(0x16a34a);
  });
});

describe("validateWebhookConfig", () => {
  it("returns null for valid config", () => {
    const config: WebhookConfig = {
      url: "https://hooks.slack.com/services/T00/B00/xxx",
      format: "slack",
    };
    expect(validateWebhookConfig(config)).toBeNull();
  });

  it("returns error for empty URL", () => {
    const config: WebhookConfig = {
      url: "",
      format: "generic",
    };
    expect(validateWebhookConfig(config)).toContain("URL");
  });

  it("returns error for invalid URL format", () => {
    const config: WebhookConfig = {
      url: "not-a-valid-url",
      format: "generic",
    };
    expect(validateWebhookConfig(config)).toContain("URL");
  });

  it("returns error for unsupported format", () => {
    const config: WebhookConfig = {
      url: "https://example.com/webhook",
      format: "unknown" as any,
    };
    expect(validateWebhookConfig(config)).toContain("format");
  });
});
