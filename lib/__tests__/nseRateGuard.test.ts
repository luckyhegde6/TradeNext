// lib/__tests__/nseRateGuard.test.ts
// Plan 09 Phase 3 — NSE anti-blacklist rate guard (spec §4.3, tests §9).
import {
  NSE_BURST_FAILURES,
  NSE_COOLDOWN_MS,
  NSE_FAILURE_WINDOW_MS,
  classifyEndpoint,
  getNseRateGuardStatus,
  getThrottleMs,
  isNseCooldownActive,
  maybeThrottle,
  recordNseFailure,
  resetNseRateGuard,
  withSingleFlight,
} from "@/lib/services/nseRateGuard";

describe("withSingleFlight", () => {
  beforeEach(() => resetNseRateGuard());

  test("concurrent identical calls share one in-flight promise (fn runs once)", async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return `v${calls}`;
    };

    const p1 = withSingleFlight("key:1", fn);
    const p2 = withSingleFlight("key:1", fn);

    expect(p1).toBe(p2); // same promise identity → stale can be served while refresh is in flight
    await p1;
    expect(calls).toBe(1); // shared flight ran fn exactly once
    await expect(p2).resolves.toBe("v1");
  });

  test("after settle, a later call starts a fresh flight", async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      return calls;
    };

    const first = withSingleFlight("key:1", fn);
    await first; // settled — entry removed
    const p3 = withSingleFlight("key:1", fn);
    expect(p3).not.toBe(first); // fresh promise, not the settled one
    await expect(p3).resolves.toBe(2);
    expect(calls).toBe(2);
  });

  test("rejections propagate to all joiners and clear the flight", async () => {
    const fn = async () => {
      throw new Error("boom");
    };
    const p1 = withSingleFlight("key:1", fn);
    const p2 = withSingleFlight("key:1", fn);
    await expect(p1).rejects.toThrow("boom");
    await expect(p2).rejects.toThrow("boom");
    // Flight cleared — next call actually runs fn again
    await expect(withSingleFlight("key:1", () => Promise.resolve("ok"))).resolves.toBe("ok");
  });
});

describe("maybeThrottle (min-interval)", () => {
  beforeEach(() => {
    resetNseRateGuard();
    jest.useFakeTimers();
    jest.setSystemTime(1_000_000);
  });
  afterEach(() => jest.useRealTimers());

  test("allows the first call, denies inside the interval, allows after", () => {
    expect(maybeThrottle("quote:RELIANCE", 1_000)).toBe(true);
    expect(maybeThrottle("quote:RELIANCE", 1_000)).toBe(false);
    jest.advanceTimersByTime(999);
    expect(maybeThrottle("quote:RELIANCE", 1_000)).toBe(false);
    jest.advanceTimersByTime(1);
    expect(maybeThrottle("quote:RELIANCE", 1_000)).toBe(true);
  });

  test("keys are independent", () => {
    expect(maybeThrottle("a", 5_000)).toBe(true);
    expect(maybeThrottle("b", 5_000)).toBe(true);
    expect(maybeThrottle("a", 5_000)).toBe(false);
  });
});

describe("burst cooldown (403/419/429)", () => {
  beforeEach(() => {
    resetNseRateGuard();
    jest.useFakeTimers();
    jest.setSystemTime(2_000_000);
  });
  afterEach(() => jest.useRealTimers());

  test(`activates after ${NSE_BURST_FAILURES}x403 within ${NSE_FAILURE_WINDOW_MS}ms and clears after ${NSE_COOLDOWN_MS}ms`, () => {
    for (let i = 0; i < NSE_BURST_FAILURES; i += 1) recordNseFailure(403);
    expect(isNseCooldownActive()).toBe(true);

    jest.advanceTimersByTime(NSE_COOLDOWN_MS + 1);
    expect(isNseCooldownActive()).toBe(false);
    expect(getNseRateGuardStatus().recentFailures).toBe(0); // window pruned on expiry
  });

  test("419 and 429 count toward the burst; 200/404/500 do not", () => {
    recordNseFailure(419);
    recordNseFailure(429);
    expect(isNseCooldownActive()).toBe(false);

    recordNseFailure(200);
    recordNseFailure(404);
    recordNseFailure(500);
    expect(isNseCooldownActive()).toBe(false);
    expect(getNseRateGuardStatus().recentFailures).toBe(2);

    recordNseFailure(403);
    recordNseFailure(403);
    recordNseFailure(403); // 5th blacklist failure
    expect(isNseCooldownActive()).toBe(true);
  });

  test("old failures outside the sliding window do not trigger cooldown", () => {
    for (let i = 0; i < NSE_BURST_FAILURES - 1; i += 1) recordNseFailure(403);
    jest.advanceTimersByTime(NSE_FAILURE_WINDOW_MS + 1);
    recordNseFailure(403); // window slid — only 1 failure remains
    expect(isNseCooldownActive()).toBe(false);
  });
});

describe("getNseRateGuardStatus / reset", () => {
  test("status reflects guard state; reset clears everything", () => {
    resetNseRateGuard();
    const p1 = withSingleFlight("k", () => new Promise((r) => setTimeout(r, 5)));
    expect(getNseRateGuardStatus().inflight).toContain("k");

    maybeThrottle("k", 1_000);
    recordNseFailure(403);
    recordNseFailure(403);
    recordNseFailure(403);
    recordNseFailure(403);
    recordNseFailure(403);

    resetNseRateGuard();
    const status = getNseRateGuardStatus();
    expect(status.inflight).toEqual([]);
    expect(status.recentFailures).toBe(0);
    expect(status.cooldownActive).toBe(false);
    expect(status.cooldownUntil).toBeNull();
    expect(Object.keys(status.lastCallAt)).toHaveLength(0);
    void p1;
  });
});

describe("endpoint classification & throttle ms", () => {
  beforeEach(() => resetNseRateGuard());

  test("known endpoints map to the spec buckets", () => {
    expect(getThrottleMs("/api/historicalOR/generateSecurityWiseHistoricalData?symbol=TCS&type=priceVolumeDeliverable")).toBe(250);
    expect(getThrottleMs("/api/NextApi/apiClient?functionName=getGraphChart&type=NIFTY&flag=1D")).toBe(5_000);
    expect(getThrottleMs("/api/NextApi/apiClient/indexTrackerApi?mode=1")).toBe(2_000);
    expect(getThrottleMs("https://www.nseindia.com/api/corporates-corporateActions?index=equities")).toBe(30_000);
    expect(getThrottleMs("/api/NextApi/apiClient/marketStatus")).toBe(2_000);
    expect(getThrottleMs("/api/NextApi/apiClient/GetQuoteApi?symbol=RELIANCE")).toBe(1_000); // default quote
    expect(getThrottleMs("/api/whatever/unknown")).toBe(1_000); // default
  });

  test("classification is case-insensitive and query-aware", () => {
    expect(classifyEndpoint("/api/NextApi/APIClient?FunctionName=GetGraphChart")).toBe("chart");
    expect(classifyEndpoint("/API/HISTORICALOR/DATA")).toBe("historical");
    expect(classifyEndpoint("/api/corporates-CorporateActions")).toBe("corporate");
  });
});

describe("NSE_THROTTLE_MS env overrides", () => {
  test("JSON map overrides default buckets at module load", () => {
    process.env.NSE_THROTTLE_MS = JSON.stringify({ historical: 1234, chart: 6789 });

    // Force a fresh module instance so parseEnvOverrides() re-reads the env
    jest.resetModules();
    const guard = require("@/lib/services/nseRateGuard") as typeof import("@/lib/services/nseRateGuard");

    expect(guard.getThrottleMs("/api/historicalOR/data")).toBe(1234);
    expect(guard.getThrottleMs("/api/NextApi/apiClient?functionName=getGraphChart")).toBe(6789);
    expect(guard.getThrottleMs("/api/NextApi/apiClient/GetQuoteApi?symbol=RELIANCE")).toBe(1000); // un-overridden default

    // Restore isolation for the other suites
    delete process.env.NSE_THROTTLE_MS;
    jest.resetModules();
  });
});