/* @jest-environment node */

/**
 * POST /api/decision/evaluate — ph22 decision engine endpoint.
 * Admin-only; zod-validated state/questions; 401/400/503/200 contract.
 * Auth + audit + decision client are mocked; route plumbing is real.
 */
import { POST } from "@/app/api/decision/evaluate/route";
import { auth } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
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
jest.mock("@/lib/audit", () => ({ __esModule: true, createAuditLog: jest.fn() }));
jest.mock("@/lib/services/decision/client", () => ({
  __esModule: true,
  getDecisionClient: jest.fn(),
}));

const mockAuth = auth as jest.Mock;
const mockAudit = createAuditLog as jest.Mock;
const mockGetClient = getDecisionClient as jest.Mock;

function fakeClient(overrides: Partial<ReturnType<typeof getDecisionClient>> = {}) {
  return {
    mode: () => "laya",
    providers: () => ["laya-mock"],
    evaluate: jest.fn().mockResolvedValue({
      answers: { "q1": { choice: "trending", probabilities: [0.9, 0.1], confidence: 0.8 } },
      provider: "laya-mock",
      model: "laya-mock",
      latencyMs: 3,
    }),
    ping: jest.fn().mockResolvedValue({ mode: "laya", providers: ["laya-mock"], detail: "ok" }),
    ...overrides,
  };
}

const post = (body: unknown) =>
  new Request("http://localhost/api/decision/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;

const VALID_BODY = {
  state: { symbol: "RELIANCE", changePercent: 2.4 },
  questions: [
    { type: "choice", name: "regime", options: ["trending", "ranging"] },
  ],
};

describe("POST /api/decision/evaluate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } });
    mockGetClient.mockReturnValue(fakeClient());
    mockAudit.mockResolvedValue(undefined);
  });

  test("401 for unauthenticated callers", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(401);
    expect(mockGetClient).not.toHaveBeenCalled();
  });

  test("401 for non-admin sessions", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "user" } });
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(401);
  });

  test("400 for invalid JSON", async () => {
    const res = await POST(
      new Request("http://localhost/api/decision/evaluate", {
        method: "POST",
        body: "{not-json",
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  test("400 for unknown question primitive", async () => {
    const res = await POST(
      post({ state: {}, questions: [{ type: "boole", name: "x" }] }),
    );
    expect(res.status).toBe(400);
  });

  test("400 when questions exceed 10", async () => {
    const questions = Array.from({ length: 11 }, (_, i) => ({
      type: "noul" as const,
      name: `q${i}`,
    }));
    const res = await POST(post({ state: {}, questions }));
    expect(res.status).toBe(400);
  });

  test("400 when state exceeds 16KB", async () => {
    const res = await POST(
      post({ state: { blob: "x".repeat(16_385) }, questions: [{ type: "noul", name: "q" }] }),
    );
    expect(res.status).toBe(400);
  });

  test("200 happy path → engine response + DECISION_EVALUATED audit", async () => {
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.response.provider).toBe("laya-mock");
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "DECISION_EVALUATED",
        metadata: expect.objectContaining({
          questionCount: 1,
          provider: "laya-mock",
        }),
      }),
    );
  });

  test("503 when the engine throws", async () => {
    mockGetClient.mockReturnValue(
      fakeClient({ evaluate: jest.fn().mockRejectedValue(new Error("boom")) }),
    );
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(503);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  test("503 when the engine is inert (evaluate → null)", async () => {
    mockGetClient.mockReturnValue(fakeClient({ evaluate: jest.fn().mockResolvedValue(null) }));
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("inert");
  });
});