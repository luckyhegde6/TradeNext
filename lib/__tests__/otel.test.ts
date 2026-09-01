// lib/__tests__/otel.test.ts — Prisma OTel opt-in guard (v3.21.3)
//
// Guarantees: OTel tracing is STRICTLY opt-in. Unless PRISMA_OTEL_ENABLED=1,
// otelSetup() must be a hard no-op — it must not register a global context
// manager, tracer provider, or Prisma instrumentation, so prod + tests behave
// exactly as before the OTel wiring. These tests lock that contract in.
//
// NOTE: the default test env does NOT set PRISMA_OTEL_ENABLED, so these tests
// run against the real (unset) env — no mocking of isEnabled needed.

import { otelSetup } from "@/lib/otel";

describe("otelSetup() — opt-in guard", () => {
  const ORIG = process.env.PRISMA_OTEL_ENABLED;

  beforeEach(() => {
    process.env.PRISMA_OTEL_ENABLED = ORIG;
    jest.resetModules();
  });

  afterAll(() => {
    if (ORIG === undefined) delete process.env.PRISMA_OTEL_ENABLED;
    else process.env.PRISMA_OTEL_ENABLED = ORIG;
  });

  test("returns false (no-op) when PRISMA_OTEL_ENABLED is unset", () => {
    delete process.env.PRISMA_OTEL_ENABLED;
    expect(otelSetup()).toBe(false);
  });

  test("returns false (no-op) when PRISMA_OTEL_ENABLED is not '1'", () => {
    process.env.PRISMA_OTEL_ENABLED = "0";
    expect(otelSetup()).toBe(false);
  });

  test("returns true when PRISMA_OTEL_ENABLED=1 (tracing initialized)", () => {
    process.env.PRISMA_OTEL_ENABLED = "1";
    expect(otelSetup()).toBe(true);
  });

  test("is idempotent — repeated calls return true without throwing", () => {
    process.env.PRISMA_OTEL_ENABLED = "1";
    expect(otelSetup()).toBe(true);
    expect(otelSetup()).toBe(true);
  });
});