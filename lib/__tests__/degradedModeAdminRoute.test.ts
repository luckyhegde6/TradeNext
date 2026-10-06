/* @jest-environment node */
/**
 * Spec 21 §6 — admin route access control + kill-switch contract.
 *
 * This route is the only manual control an operator has over degraded mode, and
 * `off` is a genuine safety switch: it says "I accept Prisma errors rather than
 * run jobs on the mirror". So the role check is pinned here — a page-level client
 * redirect must never be the only thing between a non-admin and that switch.
 *
 * Two behaviours are equally load-bearing and easy to get wrong, so both are
 * pinned:
 *   1. A failure to *audit* must not be reported as a failure to *set* — telling
 *      an operator the kill-switch did not apply when it did is how someone
 *      wrongly concludes they are protected when they are not.
 *   2. An unreadable lease must degrade the response, not blank the panel: the
 *      operator still needs to see that the mode is active.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// NOTE: jest.mock factories are hoisted above these `const`s, so a factory must
// never dereference one directly — capture it in a closure that runs later
// (the dailyRecommendationService.test.ts pattern).
// Args are forwarded from the hoisted factory below, so the mock's tuple type
// carries them — declaring an unused parameter here would trip no-unused-vars.
const mockCreateAuditLog = jest.fn<Promise<{ id: number }>, [unknown]>(async () => ({ id: 1 }));
jest.mock("@/lib/audit", () => ({
  createAuditLog: (...a: unknown[]) => mockCreateAuditLog(...(a as [never])),
}));

const mockAuth = jest.fn();
jest.mock("@/lib/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...(a as [never])) }));

const mockGetDegradedModeSetting = jest.fn(() => "auto");
const DEFAULT_STATE = {
  active: true,
  mode: "auto",
  reason: "breaker",
  totalOperations: 195_000,
  planLimit: 200_000,
  planOperationsRemaining: 5_000,
  enterAt: 180_000,
  exitAt: 160_000,
  breakerOpen: true,
  since: 1_700_000_000_000,
};

const mockGetDegradedState = jest.fn(() => DEFAULT_STATE);
const mockSetDegradedMode = jest.fn();
jest.mock("@/lib/services/degradedMode", () => ({
  __esModule: true,
  DEGRADED_MODE_SETTINGS: ["auto", "force", "off"],
  getDegradedModeSetting: (...a: unknown[]) => mockGetDegradedModeSetting(...(a as [])) as string,
  getDegradedState: (...a: unknown[]) => mockGetDegradedState(...(a as [])),
  setDegradedMode: (...a: unknown[]) => mockSetDegradedMode(...(a as [])) as void,
}));

const mockGetDegradedQueueStatus = jest.fn(() => ({
  pending: 2,
  running: 0,
  completed: 7,
  failed: 1,
  skipped: 3,
  oldestPendingAt: "2026-10-05T04:30:00.000Z",
}));
jest.mock("@/lib/services/worker/degradedQueue", () => ({
  getDegradedQueueStatus: () => mockGetDegradedQueueStatus(),
}));

const mockDegradedLeaseHolder = jest.fn(() => "instance-a#uuid");
jest.mock("@/lib/services/degradedLeader", () => ({
  degradedLeaseHolder: (...a: unknown[]) => mockDegradedLeaseHolder(...(a as [])) as string,
}));

const mockGetSqliteFallback = jest.fn((): { isReady: () => boolean } | null => ({ isReady: () => true }));
jest.mock("@/lib/sqlite", () => ({
  getSqliteFallback: (...a: unknown[]) => mockGetSqliteFallback(...(a as [])),
}));

import { GET, PATCH } from "@/app/api/admin/degraded-mode/route";
import logger from "@/lib/logger";

const log = logger as unknown as { info: jest.Mock; warn: jest.Mock; error: jest.Mock };

const adminSession = { user: { id: "7", email: "admin@tradenext6.app", role: "admin" } };
const userSession = { user: { id: "9", email: "user@tradenext6.app", role: "user" } };

const patchReq = (body: unknown) =>
  new NextRequest("http://localhost/api/admin/degraded-mode", {
    method: "PATCH",
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as Request;

beforeEach(() => {
  jest.clearAllMocks();
  // `clearAllMocks()` drops call records but KEEPS implementations, so any test
  // that swapped one in (e.g. a throwing getDegradedState) would otherwise
  // poison every test after it. Reset the stateful mocks explicitly.
  mockCreateAuditLog.mockReset().mockResolvedValue({ id: 1 });
  mockGetDegradedState.mockReset().mockReturnValue(DEFAULT_STATE);
  mockGetDegradedModeSetting.mockReset().mockReturnValue("auto");
  mockSetDegradedMode.mockReset().mockImplementation(() => {});
  mockDegradedLeaseHolder.mockReset().mockReturnValue("instance-a#uuid");
  mockGetSqliteFallback.mockReset().mockReturnValue({ isReady: () => true });
  mockAuth.mockReset().mockResolvedValue(adminSession);
});

// ─── Access control ─────────────────────────────────────────────────────────

describe("access control", () => {
  it("GET rejects an unauthenticated request with 401", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("GET rejects a non-admin session with 401", async () => {
    mockAuth.mockResolvedValue(userSession);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("PATCH rejects an unauthenticated request with 401", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await PATCH(patchReq({ mode: "force" }));
    expect(res.status).toBe(401);
  });

  it("PATCH rejects a non-admin session with 401 and does NOT change the mode", async () => {
    mockAuth.mockResolvedValue(userSession);
    const res = await PATCH(patchReq({ mode: "force" }));
    expect(res.status).toBe(401);
    expect(mockSetDegradedMode).not.toHaveBeenCalled();
  });

  it("PATCH rejects a missing session user id even with an admin-looking role", async () => {
    mockAuth.mockResolvedValue({ user: { role: "admin" } });
    const res = await PATCH(patchReq({ mode: "force" }));
    expect(res.status).toBe(401);
  });
});

// ─── GET payload ────────────────────────────────────────────────────────────

describe("GET status payload", () => {
  it("returns the mode, the deciding reason, the lease holder and queue depth", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.mode).toBe("auto");
    // The reason is what separates "the plan limit tripped" from "someone
    // flipped the switch" — the two need different remedies.
    expect(body.state.reason).toBe("breaker");
    expect(body.leaseHolder).toBe("instance-a#uuid");
    expect(body.queue.pending).toBe(2);
    expect(body.mirrorReady).toBe(true);
    expect(body.modes.map((m: { value: string }) => m.value)).toEqual(["auto", "force", "off"]);
  });

  it("hides the lease holder while inactive so nobody reads a stale holder as 'someone is executing'", async () => {
    mockGetDegradedState.mockReturnValueOnce({
      ...mockGetDegradedState(),
      active: false,
    });
    mockDegradedLeaseHolder.mockClear();

    const res = await GET();
    const body = await res.json();

    expect(body.leaseHolder).toBeNull();
    expect(mockDegradedLeaseHolder).not.toHaveBeenCalled();
  });

  it("still reports the active mode when the lease read throws", async () => {
    mockDegradedLeaseHolder.mockImplementation(() => {
      throw new Error("blob unreachable");
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.state.active).toBe(true);
    expect(body.leaseHolder).toBeNull();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: "Degraded lease holder read failed" }),
    );
  });

  it("reports mirrorReady false when the fallback is absent (cold SQLite)", async () => {
    mockGetSqliteFallback.mockReturnValue(null);
    const res = await GET();
    const body = await res.json();
    expect(body.mirrorReady).toBe(false);
  });

  it("returns 500 when status assembly throws", async () => {
    mockGetDegradedState.mockImplementation(() => {
      throw new Error("boom");
    });
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

// ─── PATCH ──────────────────────────────────────────────────────────────────

describe("PATCH mode change", () => {
  it.each(["auto", "force", "off"])("accepts the %s mode", async (mode) => {
    const res = await PATCH(patchReq({ mode }));
    expect(res.status).toBe(200);
    expect(mockSetDegradedMode).toHaveBeenCalledWith(mode);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("writes a DEGRADED_MODE_SET audit row naming the operator", async () => {
    await PATCH(patchReq({ mode: "force" }));

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "DEGRADED_MODE_SET",
        userId: 7,
        userEmail: "admin@tradenext6.app",
        metadata: { mode: "force" },
      }),
    );
  });

  it("still returns success when the audit write fails — the mode DID change", async () => {
    mockCreateAuditLog.mockRejectedValue(new Error("audit table locked"));

    const res = await PATCH(patchReq({ mode: "off" }));

    // Reporting failure here would be actively dangerous: an operator who just
    // armed the kill-switch would conclude they are unprotected.
    expect(res.status).toBe(200);
    expect(mockSetDegradedMode).toHaveBeenCalledWith("off");
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ msg: "Degraded mode audit log failed" }),
    );
  });

  it("rejects an unknown mode with 400 and does not touch the service", async () => {
    const res = await PATCH(patchReq({ mode: "chaos" }));
    expect(res.status).toBe(400);
    expect(mockSetDegradedMode).not.toHaveBeenCalled();
  });

  it("rejects a non-string mode with 400", async () => {
    const res = await PATCH(patchReq({ mode: 1 }));
    expect(res.status).toBe(400);
    expect(mockSetDegradedMode).not.toHaveBeenCalled();
  });

  it("rejects a missing mode field with 400", async () => {
    const res = await PATCH(patchReq({}));
    expect(res.status).toBe(400);
    expect(mockSetDegradedMode).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await PATCH(patchReq("{not json"));
    expect(res.status).toBe(400);
    expect(mockSetDegradedMode).not.toHaveBeenCalled();
  });

  it("returns 500 when the service itself throws", async () => {
    mockSetDegradedMode.mockImplementation(() => {
      throw new Error("mirror write failed");
    });
    const res = await PATCH(patchReq({ mode: "force" }));
    expect(res.status).toBe(500);
  });
});