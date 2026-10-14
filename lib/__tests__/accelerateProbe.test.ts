/**
 * Spec 28 — Accelerate connectivity probe (lib/services/accelerateProbe.ts).
 *
 * The probe answers "can we reach Accelerate RIGHT NOW?" with a TTL-cached
 * `SELECT 1` and never throws (failures are states). It backs the reaper's
 * skip gate (`shouldSkipReap`) and the admin probe route.
 *
 * IMPORTANT: Do NOT use `import { jest } from "@jest/globals"`.
 * SWC (used by next/jest) requires `jest` to be the global variable
 * for `jest.mock()` hoisting to work correctly.
 *
 * CRITICAL: Jest.mock() factories are hoisted BEFORE variable declarations.
 * Complex mocks must be defined INSIDE the factory and accessed via require()
 * (mutable handles are re-fetched per-test via jest.requireMock).
 */

// ─── Mocks (MUST be before the module import — SWC hoists jest.mock) ────────

jest.mock("@/lib/logger", () => {
  const mock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { __esModule: true, default: mock, info: mock.info, warn: mock.warn, error: mock.error, debug: mock.debug };
});

jest.mock("@/lib/prisma", () => {
  const mock = { $queryRaw: jest.fn() };
  return { __esModule: true, default: mock };
});

jest.mock("@/lib/db-utils", () => ({
  __esModule: true,
  // Defaults: breaker closed, errors unclassified — tests override per-case.
  isPlanLimitBreakerOpen: jest.fn(() => false),
  isDbUnavailableError: jest.fn(() => false),
}));

import {
  probeAccelerate,
  shouldSkipReap,
  getCachedAccelerateProbe,
  resetAccelerateProbeCacheForTests,
} from "@/lib/services/accelerateProbe";

// Mutable mock handles (documented repo pattern — factory-internal mocks).
const prismaMock = jest.requireMock("@/lib/prisma") as { default: { $queryRaw: jest.Mock } };
const dbUtilsMock = jest.requireMock("@/lib/db-utils") as {
  isPlanLimitBreakerOpen: jest.Mock;
  isDbUnavailableError: jest.Mock;
};

describe("accelerateProbe (Spec 28)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetAccelerateProbeCacheForTests(); // module-level cache is shared across tests
    dbUtilsMock.isPlanLimitBreakerOpen.mockReturnValue(false);
    dbUtilsMock.isDbUnavailableError.mockReturnValue(false);
    prismaMock.default.$queryRaw.mockReset();
    prismaMock.default.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    // Fresh clock per test so TTL/caching assertions are deterministic.
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-11T10:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("probeAccelerate", () => {
    it("returns ok with latency when SELECT 1 answers", async () => {
      const result = await probeAccelerate();
      expect(result.state).toBe("ok");
      expect(result.latencyMs).not.toBeNull();
      expect(result.probeId).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.checkedAt).toBe("2026-10-11T10:00:00.000Z");
      expect(prismaMock.default.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it("caches the result within the TTL window (no second probe)", async () => {
      const first = await probeAccelerate();
      jest.advanceTimersByTime(30_000); // default TTL 60s, still fresh
      const second = await probeAccelerate();
      expect(second.probeId).toBe(first.probeId);
      expect(prismaMock.default.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it("re-probes after the TTL window expires", async () => {
      await probeAccelerate();
      jest.advanceTimersByTime(61_000);
      await probeAccelerate();
      expect(prismaMock.default.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it("force bypasses the cache and records a fresh probeId", async () => {
      const first = await probeAccelerate();
      const forced = await probeAccelerate({ force: true });
      expect(forced.probeId).not.toBe(first.probeId);
      expect(prismaMock.default.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it("honours ACCELERATE_PROBE_TTL_MS env override", async () => {
      const prev = process.env.ACCELERATE_PROBE_TTL_MS;
      process.env.ACCELERATE_PROBE_TTL_MS = "5000";
      try {
        const first = await probeAccelerate();
        expect(first.ttlMs).toBe(5000);
        jest.advanceTimersByTime(10_000);
        await probeAccelerate();
        expect(prismaMock.default.$queryRaw).toHaveBeenCalledTimes(2);
      } finally {
        if (prev === undefined) delete process.env.ACCELERATE_PROBE_TTL_MS;
        else process.env.ACCELERATE_PROBE_TTL_MS = prev;
      }
    });

    it("short-circuits to state open without probing when the plan-limit breaker is open", async () => {
      dbUtilsMock.isPlanLimitBreakerOpen.mockReturnValue(true);
      const result = await probeAccelerate();
      expect(result.state).toBe("open");
      expect(result.latencyMs).toBeNull();
      expect(prismaMock.default.$queryRaw).not.toHaveBeenCalled();
    });

    it("returns unreachable (never throws) when SELECT 1 errors", async () => {
      prismaMock.default.$queryRaw.mockRejectedValue(new Error("Unable to connect to the Accelerate API"));
      const result = await probeAccelerate();
      expect(result.state).toBe("unreachable");
      expect(result.latencyMs).toBeNull();
    });

    it("returns unreachable when the probe times out", async () => {
      const prev = process.env.ACCELERATE_PROBE_TIMEOUT_MS;
      process.env.ACCELERATE_PROBE_TIMEOUT_MS = "100";
      try {
        prismaMock.default.$queryRaw.mockImplementation(
          () =>
            new Promise((resolve) => {
              // Resolves far beyond the timeout — the race must reject first.
              setTimeout(() => resolve([{ "?column?": 1 }]), 10_000);
            }),
        );
        // Fire the probe, then advance fake timers past the 100ms timeout so the
        // race rejects (the 10s resolve never wins).
        const probePromise = probeAccelerate();
        jest.advanceTimersByTime(200);
        const result = await probePromise;
        expect(result.state).toBe("unreachable");
      } finally {
        if (prev === undefined) delete process.env.ACCELERATE_PROBE_TIMEOUT_MS;
        else process.env.ACCELERATE_PROBE_TIMEOUT_MS = prev;
      }
    });

    it("exposes the cached result via getCachedAccelerateProbe", async () => {
      expect(getCachedAccelerateProbe()).toBeNull();
      const result = await probeAccelerate();
      expect(getCachedAccelerateProbe()?.probeId).toBe(result.probeId);
    });
  });

  describe("shouldSkipReap", () => {
    it("returns false while the DB is healthy", async () => {
      await expect(shouldSkipReap()).resolves.toBe(false);
    });

    it("returns true when the breaker is open (no probe attempted)", async () => {
      dbUtilsMock.isPlanLimitBreakerOpen.mockReturnValue(true);
      await expect(shouldSkipReap()).resolves.toBe(true);
      expect(prismaMock.default.$queryRaw).not.toHaveBeenCalled();
    });

    it("returns true when the last probe answered unreachable", async () => {
      prismaMock.default.$queryRaw.mockRejectedValue(new Error("fetch failed"));
      await expect(shouldSkipReap()).resolves.toBe(true);
    });

    it("recovers to false once the probe answers ok again (TTL expiry)", async () => {
      prismaMock.default.$queryRaw.mockRejectedValueOnce(new Error("fetch failed"));
      await expect(shouldSkipReap()).resolves.toBe(true);
      // After the TTL window the failing result is stale — the NEXT probe hits
      // the (now healthy) DB and the gate opens.
      jest.advanceTimersByTime(61_000);
      await expect(shouldSkipReap()).resolves.toBe(false);
    });
  });
});