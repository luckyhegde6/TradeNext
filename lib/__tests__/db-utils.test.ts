// lib/__tests__/db-utils.test.ts
//
// Tests for isDbUnavailableError() — the predicate that gates all the
// v3.19.x graceful-degradation fallback chains. CRITICAL: must recognize the
// Prisma Postgres account-hold error (code P6003, "planLimitReached") which
// is what prod actually emits when the plan limit is hit — the older
// "plan limit exceeded" phrasing no longer matches.

import {
  isDbUnavailableError,
  PlanLimitOpenError,
  isPlanLimitHoldError,
  isPlanLimitBreakerOpen,
  openPlanLimitBreaker,
  closePlanLimitBreaker,
  resetPlanLimitBreaker,
} from "@/lib/db-utils";

describe("isDbUnavailableError", () => {
  it("recognizes the Prisma Postgres account-hold error (code P6003)", () => {
    const err = Object.assign(
      new Error(
        "Invalid `prisma.notification.findMany()` invocation:\n\nThere is a hold on your account. Reason: planLimitReached. Please contact Prisma support if you think this is an error.",
      ),
      {
        code: "P6003",
        meta: { modelName: "Notification", code: "P6003", message: "There is a hold on your account. Reason: planLimitReached." },
        clientVersion: "7.9.1",
      },
    );
    expect(isDbUnavailableError(err)).toBe(true);
  });

  it("recognizes the hold error via message even when code is missing", () => {
    const err = new Error("There is a hold on your account. Reason: planLimitReached.");
    expect(isDbUnavailableError(err)).toBe(true);
  });

  it("recognizes the legacy 'plan limit exceeded' phrasing", () => {
    const err = Object.assign(new Error("Plan limit exceeded for your account"), { code: "P6003" });
    expect(isDbUnavailableError(err)).toBe(true);
  });

  it("recognizes ECONNREFUSED connection errors", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    expect(isDbUnavailableError(err)).toBe(true);
    const err2 = new Error("Connection refused");
    expect(isDbUnavailableError(err2)).toBe(true);
  });

  it("recognizes Prisma connectivity codes (P1001)", () => {
    const err = Object.assign(new Error("Can't reach database server"), { code: "P1001" });
    expect(isDbUnavailableError(err)).toBe(true);
  });

  it("recognizes Accelerate/proxy fetch failures", () => {
    const err = Object.assign(new Error("fetch failed"), { code: "UND_ERR_CONNECT_TIMEOUT" });
    expect(isDbUnavailableError(err)).toBe(true);
  });

  it("returns false for non-DB / benign errors", () => {
    expect(isDbUnavailableError(null)).toBe(false);
    expect(isDbUnavailableError(undefined)).toBe(false);
    expect(isDbUnavailableError("not an error")).toBe(false);
    expect(isDbUnavailableError(new Error("Something went wrong"))).toBe(false);
    // A Zod validation error is NOT a DB unavailability
    const zod = Object.assign(new Error("Invalid input"), { issues: [] });
    expect(isDbUnavailableError(zod)).toBe(false);
    // A business-logic P2002 unique constraint violation is NOT a DB outage
    const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    expect(isDbUnavailableError(p2002)).toBe(false);
  });

  it("recognizes the exact PrismaQueryTimeoutError class instance", () => {
    const err = Object.assign(new Error("Prisma query Notification.findMany timed out after 120000ms"), {
      name: "PrismaQueryTimeoutError",
    });
    expect(isDbUnavailableError(err)).toBe(true);
  });

  it("recognizes the PlanLimitOpenError fail-fast rejection", () => {
    expect(isDbUnavailableError(new PlanLimitOpenError())).toBe(true);
  });
});

describe("plan-limit circuit breaker", () => {
  beforeEach(() => {
    resetPlanLimitBreaker();
  });
  afterEach(() => {
    resetPlanLimitBreaker();
    jest.useRealTimers();
  });

  it("PlanLimitOpenError is a distinguishable Error subtype", () => {
    const e = new PlanLimitOpenError();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("PlanLimitOpenError");
    expect(e.message).toMatch(/plan limit/i);
  });

  it("isPlanLimitHoldError detects P6003 / hold / planLimitReached / timeout", () => {
    expect(isPlanLimitHoldError(Object.assign(new Error("There is a hold on your account. Reason: planLimitReached."), { code: "P6003" }))).toBe(true);
    expect(isPlanLimitHoldError(new Error("There is a hold on your account. Reason: planLimitReached."))).toBe(true);
    expect(isPlanLimitHoldError(Object.assign(new Error("boom"), { name: "PrismaQueryTimeoutError" }))).toBe(true);
    expect(isPlanLimitHoldError(new Error("Something else"))).toBe(false);
    expect(isPlanLimitHoldError(null)).toBe(false);
  });

  it("isPlanLimitBreakerOpen transitions with open/close", () => {
    jest.useFakeTimers();
    expect(isPlanLimitBreakerOpen()).toBe(false);
    openPlanLimitBreaker();
    expect(isPlanLimitBreakerOpen()).toBe(true);
    closePlanLimitBreaker();
    expect(isPlanLimitBreakerOpen()).toBe(false);
  });

  it("cooldown expires after PLAN_LIMIT_COOLDOWN_MS (auto half-open)", () => {
    jest.useFakeTimers();
    openPlanLimitBreaker();
    expect(isPlanLimitBreakerOpen()).toBe(true);
    // Advance just past the default 5-minute cooldown -> probe allowed
    jest.advanceTimersByTime(5 * 60_000 + 1000);
    expect(isPlanLimitBreakerOpen()).toBe(false);
  });

  it("resetPlanLimitBreaker clears state between tests", () => {
    jest.useFakeTimers();
    openPlanLimitBreaker();
    resetPlanLimitBreaker();
    expect(isPlanLimitBreakerOpen()).toBe(false);
  });
});
