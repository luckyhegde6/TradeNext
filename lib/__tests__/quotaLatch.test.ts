/**
 * Tests for lib/services/ai/quotaLatch.ts (v3.51.0).
 *
 * The latch is the code-only defence against an account-wide OpenRouter free
 * daily-quota (HTTP 429 `free-models-per-day`): once seen, the rest of the UTC
 * day is short-circuited (no HTTP calls) and the state is surfaced to admins.
 * These tests pin the three things that make it safe:
 *   1. it latches ONLY the daily free quota (a transient 429 must not),
 *   2. it self-clears at the UTC rollover / `resetAt` (no external cron), and
 *   3. it degrades gracefully (unreadable persisted value → not exhausted).
 *
 * `@/lib/sqlite` is mocked with a factory that closes over NOTHING, so the
 * hoisted `jest.mock` cannot reference a not-yet-initialised binding.
 */

jest.mock("@/lib/logger", () => {
  const mock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return {
    __esModule: true,
    default: mock,
    info: mock.info,
    warn: mock.warn,
    error: mock.error,
    debug: mock.debug,
  };
});

jest.mock("@/lib/sqlite", () => ({
  __esModule: true,
  persistBackupMeta: jest.fn(),
  restoreBackupMeta: jest.fn(() => null),
  deleteBackupMeta: jest.fn(),
}));

import { persistBackupMeta, restoreBackupMeta, deleteBackupMeta } from "@/lib/sqlite";
import {
  clearAiQuotaExhausted,
  getAiQuotaStatus,
  isAiQuotaExhausted,
  isDailyFreeQuotaMessage,
  markAiQuotaExhausted,
  todayUtc,
} from "@/lib/services/ai/quotaLatch";

const restoreMock = restoreBackupMeta as jest.MockedFunction<typeof restoreBackupMeta>;
const deleteMock = deleteBackupMeta as jest.MockedFunction<typeof deleteBackupMeta>;

const DAY = "2026-10-06";
const at = (iso: string) => new Date(iso);

describe("quotaLatch — detection", () => {
  it("matches the OpenRouter daily free-quota 429 body", () => {
    const raw =
      'AI request failed (HTTP 429). Please check your OpenRouter API key. ' +
      '[{"error":{"message":"Rate limit exceeded: free-models-per-day. Add 10 credits to unlock more.","code":429}}]';
    expect(isDailyFreeQuotaMessage(raw)).toBe(true);
  });

  it("does NOT match a transient/generic rate limit — those must not disable a whole day", () => {
    expect(isDailyFreeQuotaMessage("AI request failed (HTTP 429). Please check your OpenRouter API key.")).toBe(false);
    expect(isDailyFreeQuotaMessage("Rate limit exceeded: requests per minute")).toBe(false);
    expect(isDailyFreeQuotaMessage("AI request failed (HTTP 402). Insufficient credits")).toBe(false);
    expect(isDailyFreeQuotaMessage("")).toBe(false);
  });

  it("todayUtc returns the UTC calendar day", () => {
    expect(todayUtc(at("2026-10-06T23:59:59.000Z"))).toBe("2026-10-06");
    expect(todayUtc(at("2026-10-07T00:00:00.000Z"))).toBe("2026-10-07");
  });
});

describe("quotaLatch — mark / status", () => {
  beforeEach(() => {
    delete (globalThis as unknown as { __aiQuotaLatch?: unknown }).__aiQuotaLatch;
    jest.clearAllMocks();
  });

  it("is not exhausted before anything is marked", () => {
    expect(getAiQuotaStatus(at("2026-10-06T05:00:00.000Z")).exhausted).toBe(false);
    expect(isAiQuotaExhausted(at("2026-10-06T05:00:00.000Z"))).toBe(false);
  });

  it("marks the UTC day and exposes the detail/model", () => {
    markAiQuotaExhausted({ model: "openrouter/free", detail: "free-models-per-day", now: at("2026-10-06T05:00:00.000Z") });
    const s = getAiQuotaStatus(at("2026-10-06T05:01:00.000Z"));
    expect(status).toBeDefined();
    expect(s.exhausted).toBe(true);
    expect(s.utcDay).toBe(DAY);
    expect(s.model).toBe("openrouter/free");
    expect(s.detail).toContain("free-models-per-day");
    // Default reset is the next UTC midnight.
    expect(s.resetAt).toBe("2026-10-07T00:00:00.000Z");
    expect(persistBackupMeta).toHaveBeenCalledTimes(1);
  });

  it("survives a cold instance by reading the persisted value (memory empty)", () => {
    const persisted = JSON.stringify({
      utcDay: DAY,
      markedAt: "2026-10-06T05:00:00.000Z",
      resetAt: "2026-10-07T00:00:00.000Z",
      detail: "free-models-per-day",
      model: "openrouter/free",
    });
    restoreMock.mockReturnValueOnce(persisted);
    const status = getAiQuotaStatus(at("2026-10-06T09:00:00.000Z"));
    expect(status.exhausted).toBe(true);
    expect(status.model).toBe("openrouter/free");
  });

  it("auto-clears at the UTC day rollover without any external job", () => {
    markAiQuotaExhausted({ now: at("2026-10-06T05:00:00.000Z") });
    expect(getAiQuotaStatus(at("2026-10-06T23:59:00.000Z")).exhausted).toBe(true);
    // 00:00:01 UTC the next day → rolled over.
    expect(getAiQuotaStatus(at("2026-10-07T00:00:01.000Z")).exhausted).toBe(false);
    expect(deleteMock).toHaveBeenCalledWith("ai_quota_exhausted");
  });

  it("auto-clears when the provider-supplied resetAt has passed", () => {
    markAiQuotaExhausted({
      now: at("2026-10-06T05:00:00.000Z"),
      resetAt: "2026-10-06T06:00:00.000Z",
    });
    expect(getAiQuotaStatus(at("2026-10-06T05:59:00.000Z")).exhausted).toBe(true);
    expect(getAiQuotaStatus(at("2026-10-06T06:01:00.000Z")).exhausted).toBe(false);
  });

  it("tolerates an unreadable persisted value (treats it as not exhausted)", () => {
    restoreMock.mockReturnValueOnce("{ not json");
    expect(getAiQuotaStatus(at("2026-10-06T09:00:00.000Z")).exhausted).toBe(false);
    restoreMock.mockReturnValueOnce("{}"); // object but wrong shape
    expect(getAiQuotaStatus(at("2026-10-06T09:00:00.000Z")).exhausted).toBe(false);
  });

  it("clearAiQuotaExhausted resets memory + storage", () => {
    markAiQuotaExhausted({ now: at("2026-10-06T05:00:00.000Z") });
    expect(isAiQuotaExhausted(at("2026-10-06T05:01:00.000Z"))).toBe(true);
    clearAiQuotaExhausted();
    expect(isAiQuotaExhausted(at("2026-10-06T05:02:00.000Z"))).toBe(false);
    expect(deleteMock).toHaveBeenCalledWith("ai_quota_exhausted");
  });
});
