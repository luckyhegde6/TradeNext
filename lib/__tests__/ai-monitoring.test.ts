// lib/__tests__/ai-monitoring.test.ts
//
// Regression tests for `getPersistedAiCalls`' two-tier merge (v3.24.0):
// since AI calls are now write-behind enqueued to SQLite `wb_server_log`, the
// hourly drain promotes ONLY `isWbImportant` rows (error/warn/5xx) to Prisma.
// Info-level SUCCESS calls therefore never reach Prisma — a reader that only
// queried Prisma saw "0 of 0" AI calls even though the AI had run thousands.
//
// The fix: `getPersistedAiCalls` now ALSO reads the SQLite write-behind queue
// (source="ai") and merges both tiers newest-first. This test proves the merge
// surfaces info-level success rows that Prisma alone can never see.

// Mocks MUST be declared before the module under test (SWC hoists jest.mock).
jest.mock("@/lib/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock("@/lib/prisma", () => ({
  __esModule: true,
  default: { serverLog: { findMany: jest.fn() } },
}));

jest.mock("@/lib/sqlite", () => ({
  __esModule: true,
  getSqliteFallback: jest.fn(),
}));

import { getPersistedAiCalls } from "@/lib/services/ai/ai-monitoring";
import prisma from "@/lib/prisma";
import { getSqliteFallback } from "@/lib/sqlite";

const findManyMock = prisma.serverLog.findMany as jest.Mock;
const getSqliteFallbackMock = getSqliteFallback as jest.Mock;

describe("getPersistedAiCalls two-tier merge (AI Monitoring visibility)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows info-level success AI calls that only live in the SQLite write-behind queue (never promoted)", async () => {
    // Prisma has ONLY a promoted error-level call.
    findManyMock.mockResolvedValueOnce([
      {
        id: "p1",
        source: "ai",
        createdAt: new Date("2026-09-03T03:00:00Z"),
        metadata: {
          action: "recommendation_batch",
          model: "nvidia/nemotron-3-ultra-550b-a55b:free",
          status: "error",
          tokensUsed: 512,
          responseTimeMs: 41000,
          error: "Unusable AI response",
          timestamp: "2026-09-03T03:00:00Z",
        },
      },
    ]);

    // SQLite write-behind has the info-level SUCCESS calls that were never
    // promoted (this is the tier the old Prisma-only reader could NEVER see).
    const sqliteMock = {
      getWriteBehindLogsBySource: jest.fn().mockReturnValue([
        {
          source: "ai",
          queued_at: "2026-09-03T02:00:00Z",
          level: "info",
          metadata: JSON.stringify({
            action: "recommendation_batch",
            model: "nvidia/nemotron-3-ultra-550b-a55b:free",
            status: "success",
            tokensUsed: 1024,
            responseTimeMs: 38000,
            timestamp: "2026-09-03T02:00:00Z",
            userLabel: "insight-run",
          }),
        },
        {
          source: "ai",
          queued_at: "2026-09-03T01:00:00Z",
          level: "info",
          metadata: JSON.stringify({
            action: "swing_analysis_batch",
            model: "openrouter/free",
            status: "success",
            tokensUsed: 700,
            responseTimeMs: 52000,
            timestamp: "2026-09-03T01:00:00Z",
          }),
        },
      ]),
    };
    getSqliteFallbackMock.mockReturnValue(sqliteMock);

    const entries = await getPersistedAiCalls(100);

    // All three rows must now be visible: the promoted error PLUS the two
    // SQLite-only success rows. Prior to the fix only [p1] was returned.
    expect(entries).toHaveLength(3);

    // Newest-first ordering.
    expect(entries[0]!.action).toBe("recommendation_batch"); // 03:00 promoted error
    expect(entries[0]!.status).toBe("error");
    expect(entries[1]!.status).toBe("success"); // 02:00 SQLite-only
    expect(entries[1]!.userLabel).toBe("insight-run");
    expect(entries[2]!.action).toBe("swing_analysis_batch"); // 01:00 SQLite-only
    expect(entries[2]!.status).toBe("success");

    // The SQLite tier must have been consulted (this is THE fix).
    expect(sqliteMock.getWriteBehindLogsBySource).toHaveBeenCalled();
  });

  it("falls back to Prisma-only when SQLite is not initialized (returns [] and no crash)", async () => {
    // Prisma healthy, SQLite unavailable (getSqliteFallback returns null).
    findManyMock.mockResolvedValueOnce([
      {
        id: "p1",
        source: "ai",
        createdAt: new Date("2026-09-03T03:00:00Z"),
        metadata: {
          action: "recommendation_batch",
          model: "m",
          status: "error",
          tokensUsed: 0,
          responseTimeMs: 0,
          timestamp: "2026-09-03T03:00:00Z",
        },
      },
    ]);
    getSqliteFallbackMock.mockReturnValue(null);

    const entries = await getPersistedAiCalls(100);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.status).toBe("error");
  });

  it("slices the merged result to `limit` after sorting (limit respected across tiers)", async () => {
    findManyMock.mockResolvedValueOnce([
      {
        id: "p1",
        source: "ai",
        createdAt: new Date("2026-09-03T03:00:00Z"),
        metadata: {
          action: "promoted",
          model: "m",
          status: "error",
          tokensUsed: 0,
          responseTimeMs: 0,
          timestamp: "2026-09-03T03:00:00Z",
        },
      },
    ]);
    const sqliteMock = {
      getWriteBehindLogsBySource: jest.fn().mockReturnValue([
        {
          source: "ai",
          queued_at: "2026-09-03T02:00:00Z",
          metadata: JSON.stringify({
            action: "w1",
            model: "m",
            status: "success",
            tokensUsed: 0,
            responseTimeMs: 0,
            timestamp: "2026-09-03T02:00:00Z",
          }),
        },
        {
          source: "ai",
          queued_at: "2026-09-03T01:00:00Z",
          metadata: JSON.stringify({
            action: "w2",
            model: "m",
            status: "success",
            tokensUsed: 0,
            responseTimeMs: 0,
            timestamp: "2026-09-03T01:00:00Z",
          }),
        },
      ]),
    };
    getSqliteFallbackMock.mockReturnValue(sqliteMock);

    const entries = await getPersistedAiCalls(2);

    expect(entries).toHaveLength(2);
    expect(entries[0]!.action).toBe("promoted"); // newest
    expect(entries[1]!.action).toBe("w1"); // second-newest; w2 sliced
  });
});