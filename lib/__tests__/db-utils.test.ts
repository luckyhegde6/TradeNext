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
  classifyDbError,
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

  it("returns false for REAL PrismaClientKnownRequestError with benign codes (P2021/P2002/P2025) — regression: must NOT trip the plan-limit breaker", () => {
    // The v3.20.3 breaker used to match ANY PrismaClientKnownRequestError
    // (name = "PrismaClientKnownRequestError" contains "prismaclient"+"request"),
    // so benign request errors like P2021 (table missing), P2002 (unique
    // constraint) and P2025 (record not found) opened the global plan-limit
    // breaker for 5 minutes — freezing ALL DB access (incl. auth) in CI.
    const shape = (message: string, code: string) =>
      Object.assign(new Error(message), { code, name: "PrismaClientKnownRequestError" });

    // P2021 — table does not exist (the CI intelligence_cache gap)
    const p2021 = shape("The table `public.intelligence_cache` does not exist in the current database.", "P2021");
    expect(isDbUnavailableError(p2021)).toBe(false);

    // P2002 — unique constraint violation
    const p2002 = shape("Unique constraint failed on the fields: (`symbol`)", "P2002");
    expect(isDbUnavailableError(p2002)).toBe(false);

    // P2025 — record not found
    const p2025 = shape("An operation failed because it depends on one or more records that were required but not found.", "P2025");
    expect(isDbUnavailableError(p2025)).toBe(false);
  });

  it("returns true for REAL PrismaClientKnownRequestError with connectivity codes (P1001/P2024)", () => {
    const shape = (message: string, code: string) =>
      Object.assign(new Error(message), { code, name: "PrismaClientKnownRequestError" });
    expect(isDbUnavailableError(shape("Can't reach database server", "P1001"))).toBe(true);
    expect(isDbUnavailableError(shape("Timed out during query execution", "P2024"))).toBe(true);
    // P6003 hold still trips even with the real PrismaClientKnownRequestError name
    expect(
      isDbUnavailableError(shape("There is a hold on your account. Reason: planLimitReached.", "P6003")),
    ).toBe(true);
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

describe("classifyDbError", () => {
  it("classifies the Prisma Postgres account-hold error as plan_limit", () => {
    const hold = Object.assign(
      new Error("Invalid `prisma.notification.findMany()` invocation:\n\nThere is a hold on your account. Reason: planLimitReached. Please contact Prisma support if you think this is an error."),
      { code: "P6003" },
    );
    expect(classifyDbError(hold)).toBe("plan_limit");
    expect(classifyDbError(new Error("There is a hold on your account. Reason: planLimitReached."))).toBe("plan_limit");
    expect(classifyDbError(new Error("Plan limit exceeded for your account"))).toBe("plan_limit");
  });

  it("classifies timeouts as timeout", () => {
    expect(classifyDbError(Object.assign(new Error("Timed out during query execution"), { code: "P2024" }))).toBe("timeout");
    expect(classifyDbError(Object.assign(new Error("Operations timed out"), { code: "P1008" }))).toBe("timeout");
    expect(classifyDbError(Object.assign(new Error("boom"), { name: "PrismaQueryTimeoutError" }))).toBe("timeout");
    expect(classifyDbError(Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }))).toBe("timeout");
    expect(classifyDbError(new Error("Request timeout"))).toBe("timeout");
  });

  it("classifies the real prod Accelerate <-> Query Engine error as accelerate_proxy", () => {
    // The exact message seen on prod (2026-09-02)
    const err = new Error(
      "Accelerate experienced an error communicating with your Query Engine. Please contact Prisma support if this error persists.",
    );
    expect(classifyDbError(err)).toBe("accelerate_proxy");
    expect(classifyDbError(new Error("Invalid invocation"))).toBe("accelerate_proxy");
    expect(classifyDbError(new Error("Bad Gateway"))).toBe("accelerate_proxy");
    expect(classifyDbError(new Error("PrismaClientInitializationError: engine is not ready"))).toBe("accelerate_proxy");
  });

  it("classifies connection failures as connection", () => {
    expect(classifyDbError(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))).toBe("connection");
    expect(classifyDbError(Object.assign(new Error("Can't reach database server"), { code: "P1001" }))).toBe("connection");
    expect(classifyDbError(new Error("Connection refused"))).toBe("connection");
    expect(classifyDbError(Object.assign(new Error("failed to connect to database: too many connections"), { code: "P1017" }))).toBe("connection");
    // Undici socket-level fetch failures during probe
    expect(classifyDbError(Object.assign(new Error("fetch failed"), { code: "UND_ERR_CONNECT_TIMEOUT" }))).toBe("connection");
  });

  it("classifies write-budget rejections as write_budget", () => {
    expect(
      classifyDbError(new Error("DB write budget exceeded (9123/8000 writes today). Try again tomorrow or set DB_WRITE_BUDGET env.")),
    ).toBe("write_budget");
    expect(classifyDbError(new Error("write budget exceeded (42/8000)"))).toBe("write_budget");
  });

  it("classifies benign Prisma request errors as other — never a DB-outage bucket", () => {
    const shape = (message: string, code: string) =>
      Object.assign(new Error(message), { code, name: "PrismaClientKnownRequestError" });
    // P2021 table missing (intelligence_cache CI gap), P2002 unique, P2025 not-found
    expect(classifyDbError(shape("The table `public.intelligence_cache` does not exist in the current database.", "P2021"))).toBe("other");
    expect(classifyDbError(shape("Unique constraint failed on the fields: (`symbol`)", "P2002"))).toBe("other");
    expect(classifyDbError(shape("An operation failed because it depends on one or more records that were required but not found.", "P2025"))).toBe("other");
  });

  it("handles non-Error inputs and plain errors as other", () => {
    expect(classifyDbError(null)).toBe("other");
    expect(classifyDbError(undefined)).toBe("other");
    expect(classifyDbError("not an error")).toBe("other");
    expect(classifyDbError(new Error("Something went wrong"))).toBe("other");
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
