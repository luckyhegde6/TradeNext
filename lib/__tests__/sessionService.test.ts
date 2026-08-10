/**
 * Tests for sessionService (v3.5.4).
 *
 * Covers:
 *   - createUserSession(): creates a row with a 64-hex session token + expiry
 *   - invalidateSession(): matches by record id (admin UI) OR session token (signOut)
 *   - updateSessionActivity(): touches lastActiveAt only for valid sessions
 *   - getSessionStats(): aggregates total/active/expired/usersWithSessions
 *   - invalidateUserTokens(): bumps tokenVersion + sessionId, invalidates DB sessions
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

jest.mock("@/lib/prisma", () => {
  const mock = {
    userSession: {
      create: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
      deleteMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  return { __esModule: true, default: mock };
});

// ─── Imports ──────────────────────────────────────────────────────────────

import {
  createUserSession,
  invalidateSession,
  invalidateAllUserSessions,
  updateSessionActivity,
  getUserSessions,
  getAllActiveSessions,
  cleanupExpiredSessions,
  getSessionStats,
  invalidateUserTokens,
} from "@/lib/services/sessionService";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const prisma = require("@/lib/prisma").default as {
  userSession: {
    create: jest.Mock;
    updateMany: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    groupBy: jest.Mock;
    deleteMany: jest.Mock;
  };
  user: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
};

describe("sessionService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createUserSession", () => {
    test("creates a session row and returns a hex token", async () => {
      prisma.userSession.create.mockResolvedValue({
        id: "uuid-1",
        userId: 7,
        sessionToken: "abc",
        createdAt: new Date(),
      });

      const token = await createUserSession({
        userId: 7,
        ipAddress: "1.2.3.4",
        userAgent: "Mozilla/5.0",
        deviceInfo: "Chrome on Windows",
      });

      expect(token).toMatch(/^[0-9a-f]{64}$/);
      expect(prisma.userSession.create).toHaveBeenCalledTimes(1);
      const arg = prisma.userSession.create.mock.calls[0][0];
      expect(arg.data.userId).toBe(7);
      expect(arg.data.ipAddress).toBe("1.2.3.4");
      expect(arg.data.userAgent).toBe("Mozilla/5.0");
      expect(arg.data.deviceInfo).toBe("Chrome on Windows");
      expect(arg.data.isActive).toBe(true);
      // 30 days out
      const daysOut = (arg.data.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      expect(daysOut).toBeGreaterThan(29.9);
      expect(daysOut).toBeLessThanOrEqual(30);
    });

    test("rethrows when the DB write fails", async () => {
      prisma.userSession.create.mockRejectedValue(new Error("DB down"));
      await expect(createUserSession({ userId: 1 })).rejects.toThrow("DB down");
    });
  });

  describe("invalidateSession", () => {
    test("matches by session token (signOut path)", async () => {
      prisma.userSession.updateMany.mockResolvedValue({ count: 1 });
      const ok = await invalidateSession("token-abc");
      expect(ok).toBe(true);
      const arg = prisma.userSession.updateMany.mock.calls[0][0];
      expect(arg.where.OR).toContainEqual({ id: "token-abc" });
      expect(arg.where.OR).toContainEqual({ sessionToken: "token-abc" });
      expect(arg.where.isActive).toBe(true);
      expect(arg.data.isActive).toBe(false);
    });

    test("matches by record id (admin UI path)", async () => {
      prisma.userSession.updateMany.mockResolvedValue({ count: 1 });
      const ok = await invalidateSession("uuid-123");
      expect(ok).toBe(true);
      expect(prisma.userSession.updateMany).toHaveBeenCalledTimes(1);
    });

    test("returns false when no session matched", async () => {
      prisma.userSession.updateMany.mockResolvedValue({ count: 0 });
      expect(await invalidateSession("missing")).toBe(false);
    });

    test("returns false on error instead of throwing", async () => {
      prisma.userSession.updateMany.mockRejectedValue(new Error("boom"));
      expect(await invalidateSession("xyz")).toBe(false);
    });
  });

  describe("invalidateAllUserSessions", () => {
    test("invalidates all active sessions for the user", async () => {
      prisma.userSession.updateMany.mockResolvedValue({ count: 3 });
      const count = await invalidateAllUserSessions(7);
      expect(count).toBe(3);
      const arg = prisma.userSession.updateMany.mock.calls[0][0];
      expect(arg.where.userId).toBe(7);
      expect(arg.where.isActive).toBe(true);
    });

    test("excludes the current session when a token is passed", async () => {
      prisma.userSession.updateMany.mockResolvedValue({ count: 2 });
      await invalidateAllUserSessions(7, "current-token");
      const arg = prisma.userSession.updateMany.mock.calls[0][0];
      expect(arg.where.NOT).toEqual({ sessionToken: "current-token" });
    });
  });

  describe("updateSessionActivity", () => {
    test("touches lastActiveAt for a valid session", async () => {
      prisma.userSession.updateMany.mockResolvedValue({ count: 1 });
      const ok = await updateSessionActivity("token");
      expect(ok).toBe(true);
      const arg = prisma.userSession.updateMany.mock.calls[0][0];
      expect(arg.where.sessionToken).toBe("token");
      expect(arg.where.isActive).toBe(true);
      expect(arg.where.expiresAt.gt).toBeInstanceOf(Date);
      expect(arg.data.lastActiveAt).toBeInstanceOf(Date);
    });

    test("returns false if no valid session", async () => {
      prisma.userSession.updateMany.mockResolvedValue({ count: 0 });
      expect(await updateSessionActivity("stale")).toBe(false);
    });
  });

  describe("getUserSessions / getAllActiveSessions", () => {
    test("returns active sessions for a user", async () => {
      const rows = [{ id: "a", userId: 7, isActive: true }];
      prisma.userSession.findMany.mockResolvedValue(rows);
      const sessions = await getUserSessions(7);
      expect(sessions).toEqual(rows);
      const arg = prisma.userSession.findMany.mock.calls[0][0];
      expect(arg.where.userId).toBe(7);
      expect(arg.orderBy.lastActiveAt).toBe("desc");
    });

    test("returns empty array on error", async () => {
      prisma.userSession.findMany.mockRejectedValue(new Error("x"));
      expect(await getAllActiveSessions()).toEqual([]);
    });
  });

  describe("cleanupExpiredSessions", () => {
    test("deletes expired/inactive sessions", async () => {
      prisma.userSession.deleteMany.mockResolvedValue({ count: 5 });
      const count = await cleanupExpiredSessions();
      expect(count).toBe(5);
      const arg = prisma.userSession.deleteMany.mock.calls[0][0];
      expect(arg.where.OR).toHaveLength(2);
    });
  });

  describe("getSessionStats", () => {
    test("aggregates counts and unique users", async () => {
      prisma.userSession.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(4)  // active
        .mockResolvedValueOnce(6); // expired
      prisma.userSession.groupBy.mockResolvedValue([{ userId: 1 }, { userId: 2 }]);

      const stats = await getSessionStats();
      expect(stats).toEqual({ total: 10, active: 4, expired: 6, usersWithSessions: 2 });
    });

    test("returns all-zero fallback on error", async () => {
      prisma.userSession.count.mockRejectedValue(new Error("x"));
      expect(await getSessionStats()).toEqual({ total: 0, active: 0, expired: 0, usersWithSessions: 0 });
    });
  });

  describe("invalidateUserTokens", () => {
    test("bumps tokenVersion and invalidates DB sessions", async () => {
      prisma.user.findUnique.mockResolvedValue({ tokenVersion: 2 });
      prisma.user.update.mockResolvedValue({});
      prisma.userSession.updateMany.mockResolvedValue({ count: 2 });

      const version = await invalidateUserTokens(7);

      expect(version).toBe(3);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 7 },
          data: { tokenVersion: 3, currentSessionId: expect.any(String) },
        })
      );
      expect(prisma.userSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 7, isActive: true } })
      );
    });

    test("returns -1 when user is not found", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      expect(await invalidateUserTokens(999)).toBe(-1);
    });

    test("returns -1 on error", async () => {
      prisma.user.findUnique.mockRejectedValue(new Error("x"));
      expect(await invalidateUserTokens(7)).toBe(-1);
    });
  });
});