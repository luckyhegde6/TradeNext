/* @jest-environment node */

/**
 * GET /api/admin/decision/ping — ph22 decision engine admin probe.
 * Admin-only; returns resolved provider mode + POC A/B env flags.
 */
import { GET } from "@/app/api/admin/decision/ping/route";
import { auth } from "@/lib/auth";
import { getDecisionClient } from "@/lib/services/decision/client";

jest.mock("@/lib/auth", () => ({ __esModule: true, auth: jest.fn() }));
jest.mock("@/lib/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
  },
}));
jest.mock("@/lib/services/decision/client", () => ({
  __esModule: true,
  getDecisionClient: jest.fn(),
}));

const mockAuth = auth as jest.Mock;
const mockGetClient = getDecisionClient as jest.Mock;

describe("GET /api/admin/decision/ping", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } });
    mockGetClient.mockReturnValue({
      mode: () => "none",
      providers: () => [],
      evaluate: jest.fn(),
      ping: jest.fn().mockResolvedValue({
        mode: "none",
        providers: [],
        detail: "none — decision engine is inert (DECISION_PROVIDER=none)",
      }),
    });
  });

  test("401 for unauthenticated callers", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockGetClient).not.toHaveBeenCalled();
  });

  test("401 for non-admin sessions", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "user" } });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("200 with mode + flags (POC off)", async () => {
    delete process.env.DECISION_POC_ENABLED;
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.ping.mode).toBe("none");
    expect(body.flags).toEqual({
      DECISION_PROVIDER: "none",
      DECISION_POC_ENABLED: false,
    });
  });

  test("200 reflects DECISION_POC_ENABLED=true", async () => {
    process.env.DECISION_POC_ENABLED = "true";
    mockGetClient.mockReturnValue({
      mode: () => "laya",
      providers: () => ["laya-mock"],
      evaluate: jest.fn(),
      ping: jest.fn().mockResolvedValue({
        mode: "laya",
        providers: ["laya-mock"],
        detail: "laya-mock (deterministic; real Laya inference gated behind P1–P3 parity work)",
      }),
    });
    const res = await GET();
    const body = await res.json();
    expect(body.ping.providers).toEqual(["laya-mock"]);
    expect(body.flags).toEqual({
      DECISION_PROVIDER: "laya",
      DECISION_POC_ENABLED: true,
    });
    delete process.env.DECISION_POC_ENABLED;
  });
});