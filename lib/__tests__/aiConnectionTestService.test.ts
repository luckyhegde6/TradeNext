/**
 * Tests for lib/services/ai/connectionTestService.ts.
 *
 * The service probes the configured OpenRouter model with a tiny prompt and,
 * on failure, probes fallback routes (`openrouter/free`, `openrouter/auto`).
 * Every attempt is persisted via trackAiCall (action "connection_test") and
 * the overall outcome is recorded in the audit log (AI_CONNECTION_TEST /
 * AI_CONNECTION_TEST_FAILED); an overall failure notifies admins.
 *
 * fetch is mocked globally; config/ai-monitoring/notificationService/audit
 * are mocked by module path.
 *
 * IMPORTANT: Do NOT use `import { jest } from "@jest/globals"`.
 * SWC (used by next/jest) requires `jest` to be the global variable
 * for `jest.mock()` hoisting to work correctly.
 */

// ─── Mocks (MUST be before any imports — SWC hoists jest.mock) ─────────

jest.mock("@/lib/logger", () => {
  const mock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { __esModule: true, default: mock, info: mock.info, warn: mock.warn, error: mock.error, debug: mock.debug };
});

jest.mock("@/lib/services/ai/config", () => ({
  loadConfig: jest.fn(),
  hasValidConfig: jest.fn(),
}));

jest.mock("@/lib/services/ai/ai-monitoring", () => ({
  trackAiCall: jest.fn(),
  getPersistedAiCalls: jest.fn(),
}));

jest.mock("@/lib/services/notificationService", () => ({
  notifyAdmins: jest.fn(),
}));

jest.mock("@/lib/audit", () => ({
  createAuditLog: jest.fn(),
}));

// ─── Imports ──────────────────────────────────────────────────────────────

import {
  runAiConnectionTest,
  testOpenRouterModel,
  getLastAiConnectionTests,
  AI_FALLBACK_MODELS,
  CONNECTION_TEST_ACTION,
} from "@/lib/services/ai/connectionTestService";
import { loadConfig, hasValidConfig } from "@/lib/services/ai/config";
import { trackAiCall, getPersistedAiCalls } from "@/lib/services/ai/ai-monitoring";
import { notifyAdmins } from "@/lib/services/notificationService";
import { createAuditLog } from "@/lib/audit";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const configMock = require("@/lib/services/ai/config") as {
  loadConfig: jest.Mock;
  hasValidConfig: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const monitoringMock = require("@/lib/services/ai/ai-monitoring") as {
  trackAiCall: jest.Mock;
  getPersistedAiCalls: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const notifyMock = require("@/lib/services/notificationService") as { notifyAdmins: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const auditMock = require("@/lib/audit") as { createAuditLog: jest.Mock };

const VALID_CONFIG = {
  model: "nvidia/nemotron-3-ultra-550b-a55b:free",
  apiKey: "sk-test-key",
  temperature: 0.1,
  maxTokens: 1024,
  enabled: true,
};

function okResponse(body: unknown, status = 200) {
  return {
    ok: true,
    status,
    text: jest.fn().mockResolvedValue(""),
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function errorResponse(status: number, text = "model not found") {
  return {
    ok: false,
    status,
    text: jest.fn().mockResolvedValue(text),
    json: jest.fn().mockResolvedValue({}),
  } as unknown as Response;
}

describe("testOpenRouterModel", () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("returns ok:true with preview for a 200 with content", async () => {
    fetchMock.mockResolvedValue(okResponse({ choices: [{ message: { content: "OK" } }] }));

    const r = await testOpenRouterModel("some-model", VALID_CONFIG);

    expect(r.ok).toBe(true);
    expect(r.httpStatus).toBe(200);
    expect(r.preview).toBe("OK");
    expect(r.error).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns ok:false with the body text on an HTTP error", async () => {
    fetchMock.mockResolvedValue(errorResponse(404, "model not found"));

    const r = await testOpenRouterModel("bad-model", VALID_CONFIG);

    expect(r.ok).toBe(false);
    expect(r.httpStatus).toBe(404);
    expect(r.error).toContain("model not found");
  });

  it("never throws on a network failure — returns ok:false with the error", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));

    const r = await testOpenRouterModel("some-model", VALID_CONFIG);

    expect(r.ok).toBe(false);
    expect(r.error).toContain("ECONNRESET");
    expect(r.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("treats a 200 with empty content as a failure", async () => {
    fetchMock.mockResolvedValue(okResponse({ choices: [{ message: { content: " " } }] }));

    const r = await testOpenRouterModel("some-model", VALID_CONFIG);

    expect(r.ok).toBe(false);
    expect(r.error).toBe("Empty model response");
  });
});

describe("runAiConnectionTest", () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as unknown as typeof fetch;
    configMock.loadConfig.mockResolvedValue(VALID_CONFIG);
    configMock.hasValidConfig.mockReturnValue(true);
    monitoringMock.trackAiCall.mockResolvedValue(undefined);
    auditMock.createAuditLog.mockResolvedValue(undefined);
    notifyMock.notifyAdmins.mockResolvedValue(undefined);
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("returns status ok when the configured model answers — no fallbacks probed, audit logged with status", async () => {
    fetchMock.mockResolvedValue(okResponse({ choices: [{ message: { content: "OK" } }] }));

    const report = await runAiConnectionTest();

    expect(report.status).toBe("ok");
    expect(report.configuredModel).toBe(VALID_CONFIG.model);
    expect(report.primary.ok).toBe(true);
    expect(report.fallbacks).toEqual([]);
    // Only ONE probe (primary) — no fallback calls
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Persisted via trackAiCall with the connection_test action
    expect(trackAiCall).toHaveBeenCalledWith(
      expect.objectContaining({
        action: CONNECTION_TEST_ACTION,
        model: VALID_CONFIG.model,
        status: "success",
      }),
    );
    // Audit log records the connection test status
    expect(auditMock.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "AI_CONNECTION_TEST",
        resource: "ai-config",
        metadata: expect.objectContaining({ status: "ok", configuredModel: VALID_CONFIG.model }),
      }),
    );
    // No admin notification on success
    expect(notifyMock.notifyAdmins).not.toHaveBeenCalled();
  });

  it("falls back to openrouter/free when the configured model fails and recommends it", async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(401, "invalid api key"))
      .mockResolvedValueOnce(okResponse({ choices: [{ message: { content: "OK" } }] }));

    const report = await runAiConnectionTest();

    expect(report.status).toBe("fallback");
    expect(report.primary.ok).toBe(false);
    expect(report.recommendedModel).toBe(AI_FALLBACK_MODELS[0]); // "openrouter/free"
    expect(report.fallbacks).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Both attempts tracked
    expect(trackAiCall).toHaveBeenCalledTimes(2);
    // Audit logged as a passing test (fallback still worked) with status
    expect(auditMock.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "AI_CONNECTION_TEST",
        metadata: expect.objectContaining({ status: "fallback", recommendedModel: "openrouter/free" }),
      }),
    );
    expect(notifyMock.notifyAdmins).not.toHaveBeenCalled();
  });

  it("returns status failed and notifies admins when primary and ALL fallbacks fail", async () => {
    fetchMock.mockResolvedValue(errorResponse(500, "boom"));

    const report = await runAiConnectionTest();

    expect(report.status).toBe("failed");
    expect(report.recommendedModel).toBeUndefined();
    expect(report.fallbacks).toHaveLength(AI_FALLBACK_MODELS.length);
    expect(fetchMock).toHaveBeenCalledTimes(1 + AI_FALLBACK_MODELS.length);
    // Audit logged as a FAILURE with the status
    expect(auditMock.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "AI_CONNECTION_TEST_FAILED",
        metadata: expect.objectContaining({ status: "failed" }),
        errorMessage: expect.stringContaining("All AI models unreachable"),
      }),
    );
    // Admin notification fired exactly once
    expect(notifyMock.notifyAdmins).toHaveBeenCalledTimes(1);
    expect(notifyMock.notifyAdmins).toHaveBeenCalledWith(
      expect.stringContaining("AI model unreachable"),
      expect.any(String),
      "/admin/utils/ai-monitoring",
    );
  });

  it("short-circuits with failed when AI is not configured — no probes, admin notified, audit logged", async () => {
    configMock.hasValidConfig.mockReturnValue(false);
    configMock.loadConfig.mockResolvedValue({ ...VALID_CONFIG, apiKey: "" });

    const report = await runAiConnectionTest();

    expect(report.status).toBe("failed");
    expect(report.primary.error).toContain("not configured");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(trackAiCall).not.toHaveBeenCalled();
    expect(notifyMock.notifyAdmins).toHaveBeenCalledTimes(1);
    expect(auditMock.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "AI_CONNECTION_TEST_FAILED",
        metadata: expect.objectContaining({ status: "failed", reason: expect.stringContaining("not configured") }),
      }),
    );
  });
});

describe("getLastAiConnectionTests", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("filters persisted AI calls down to connection_test entries", async () => {
    const calls = [
      { action: CONNECTION_TEST_ACTION, model: "m1", status: "success" },
      { action: "test", model: "m2", status: "success" },
      { action: CONNECTION_TEST_ACTION, model: "m3", status: "error" },
      { action: "recommendation", model: "m4", status: "success" },
    ];
    monitoringMock.getPersistedAiCalls.mockResolvedValue(calls);

    const result = await getLastAiConnectionTests(10);

    expect(result).toHaveLength(2);
    expect(result.every((c) => c.action === CONNECTION_TEST_ACTION)).toBe(true);
    expect(getPersistedAiCalls).toHaveBeenCalledWith(50);
  });

  it("returns [] when persistence fails (never throws)", async () => {
    monitoringMock.getPersistedAiCalls.mockRejectedValue(new Error("db down"));

    const result = await getLastAiConnectionTests(5);

    expect(result).toEqual([]);
  });
});

describe("imports", () => {
  it("exposes the expected fallback chain", () => {
    expect(AI_FALLBACK_MODELS).toEqual(["openrouter/free", "openrouter/auto"]);
  });
});
