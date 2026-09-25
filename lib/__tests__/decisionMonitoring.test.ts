// lib/__tests__/decisionMonitoring.test.ts
// Spec 17 — Decision Engine performance tracing: in-memory ring buffer,
// aggregated stats, clear, and client/ping trace recording (zero Prisma).

jest.mock("@/lib/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  clearDecisionTraces,
  getDecisionStats,
  getDecisionTraces,
  trackDecisionTrace,
} from "@/lib/services/decision/monitoring";
import {
  createDecisionClient,
  _createDecisionClientWithProviders,
  _resetDecisionClient,
} from "@/lib/services/decision/client";
import type { DecisionProvider } from "@/lib/services/decision/provider";
import type { EvaluateResponse } from "@/lib/services/decision/types";

const ENV = (value?: string): NodeJS.ProcessEnv =>
  ({ DECISION_PROVIDER: value }) as unknown as NodeJS.ProcessEnv;

const now = Date.now();
function ts(offsetMs: number): string {
  return new Date(now + offsetMs).toISOString();
}

beforeEach(() => {
  clearDecisionTraces();
  _resetDecisionClient();
});

describe("trackDecisionTrace / getDecisionTraces (ring buffer)", () => {
  test("returns traces newest first", () => {
    trackDecisionTrace({
      timestamp: ts(0),
      kind: "evaluate",
      mode: "laya",
      provider: "laya-mock",
      status: "success",
      latencyMs: 10,
      attempts: 1,
      questionCount: 1,
    });
    trackDecisionTrace({
      timestamp: ts(1000),
      kind: "ping",
      mode: "none",
      status: "success",
      latencyMs: 2,
    });
    const traces = getDecisionTraces();
    expect(traces.map((t) => t.kind)).toEqual(["ping", "evaluate"]);
  });

  test("respects the limit parameter", () => {
    for (let i = 0; i < 10; i += 1) {
      trackDecisionTrace({
        timestamp: ts(i),
        kind: "poc-a-screener",
        mode: "laya",
        provider: "local",
        status: "success",
        latencyMs: i,
        scoredCount: i,
      });
    }
    expect(getDecisionTraces(3)).toHaveLength(3);
    expect(getDecisionTraces(3)[0].scoredCount).toBe(9);
  });

  test("ring buffer caps at 500 entries", () => {
    for (let i = 0; i < 505; i += 1) {
      trackDecisionTrace({
        timestamp: ts(i),
        kind: "ping",
        mode: "none",
        status: "success",
        latencyMs: 1,
      });
    }
    expect(getDecisionTraces(600)).toHaveLength(500);
  });

  test("clearDecisionTraces empties the buffer", () => {
    trackDecisionTrace({
      timestamp: ts(0),
      kind: "ping",
      mode: "none",
      status: "success",
      latencyMs: 1,
    });
    clearDecisionTraces();
    expect(getDecisionTraces()).toHaveLength(0);
  });
});

describe("getDecisionStats", () => {
  test("empty buffer → zeroed stats", () => {
    const stats = getDecisionStats(60);
    expect(stats.totalTraces).toBe(0);
    expect(stats.successRate).toBe(0);
    expect(stats.avgLatencyMs).toBe(0);
    expect(stats.avgAttempts).toBe(0);
    expect(stats.totalQuestionsEvaluated).toBe(0);
    expect(stats.totalGatesEmitted).toBe(0);
    expect(stats.recentErrors).toEqual([]);
  });

  test("aggregates totals, rate, latency, attempts, questions", () => {
    trackDecisionTrace({
      timestamp: ts(0),
      kind: "evaluate",
      mode: "laya",
      provider: "laya-mock",
      status: "success",
      latencyMs: 100,
      attempts: 1,
      questionCount: 3,
      questionTypes: ["choice", "noul"],
    });
    trackDecisionTrace({
      timestamp: ts(1000),
      kind: "evaluate",
      mode: "laya",
      provider: "laya-mock",
      status: "error",
      latencyMs: 300,
      attempts: 4,
      error: "boom",
    });
    trackDecisionTrace({
      timestamp: ts(2000),
      kind: "evaluate",
      mode: "none",
      status: "inert",
      latencyMs: 0,
      attempts: 1,
      questionCount: 2,
    });

    const stats = getDecisionStats(60);
    expect(stats.totalTraces).toBe(3);
    expect(stats.successCount).toBe(1);
    expect(stats.errorCount).toBe(1);
    expect(stats.inertCount).toBe(1);
    expect(stats.successRate).toBe(33);
    // Latency total = 100 + 300 + 0 = 400 → avg 133 (rounded).
    expect(stats.avgLatencyMs).toBe(133);
    // avg attempts over evaluate traces (all 3) = (1+4+1)/3 = 2 → 2.0
    expect(stats.avgAttempts).toBe(2);
    // questions counted from traces that carry questionCount (2 of 3: 3+2)
    expect(stats.totalQuestionsEvaluated).toBe(5);
    expect(stats.recentErrors).toHaveLength(1);
    expect(stats.recentErrors[0].error).toBe("boom");
  });

  test("timeframe window filters old traces", () => {
    trackDecisionTrace({
      timestamp: ts(-2 * 60 * 60 * 1000), // 2h ago
      kind: "ping",
      mode: "none",
      status: "success",
      latencyMs: 5,
    });
    trackDecisionTrace({
      timestamp: ts(-10 * 1000), // 10s ago
      kind: "ping",
      mode: "none",
      status: "success",
      latencyMs: 6,
    });
    const stats60 = getDecisionStats(60);
    expect(stats60.totalTraces).toBe(1);
    const stats1440 = getDecisionStats(1440);
    expect(stats1440.totalTraces).toBe(2);
  });

  test("tallies tracesByKind / bytesByProvider / tracesByGate", () => {
    trackDecisionTrace({
      timestamp: ts(0),
      kind: "poc-a-screener",
      mode: "laya",
      provider: "local",
      status: "success",
      latencyMs: 20,
      gate: "act",
      scoredCount: 3,
      gateDistribution: { act: 1, review: 1, escalate: 1 },
    });
    trackDecisionTrace({
      timestamp: ts(1000),
      kind: "poc-b-autoseed-gate",
      mode: "laya",
      provider: "laya-mock",
      status: "success",
      latencyMs: 30,
      gate: "review",
      reason: "low-validity",
      allowed: false,
      noulAmount: 0.4,
    });

    const stats = getDecisionStats(60);
    expect(stats.tracesByKind).toEqual({
      "poc-a-screener": 1,
      "poc-b-autoseed-gate": 1,
    });
    expect(stats.tracesByProvider).toEqual({ local: 1, "laya-mock": 1 });
    expect(stats.tracesByGate).toEqual({ act: 1, review: 1 });
    expect(stats.totalGatesEmitted).toBe(2);
  });

  test("error/inert traces are not tallied as gate outcomes", () => {
    trackDecisionTrace({
      timestamp: ts(0),
      kind: "poc-b-autoseed-gate",
      mode: "none",
      status: "success",
      latencyMs: 0,
      gate: "act",
      reason: "engine-off",
      allowed: true,
    });
    trackDecisionTrace({
      timestamp: ts(1000),
      kind: "evaluate",
      mode: "laya",
      provider: "laya-mock",
      status: "error",
      latencyMs: 50,
      error: "boom",
    });
    const stats = getDecisionStats(60);
    expect(stats.totalGatesEmitted).toBe(1); // only the gate outcomes (act from poc-b)
  });
});

describe("client integration traces (spec 17)", () => {
  const req = {
    state: { momentum: 0.8 },
    questions: [{ type: "choice" as const, name: "bias", options: ["trending", "range"] }],
  };

  test("inert evaluate records an inert trace (mode none)", async () => {
    const client = createDecisionClient(ENV("none"));
    await expect(client.evaluate(req)).resolves.toBeNull();
    const traces = getDecisionTraces();
    expect(traces).toHaveLength(1);
    expect(traces[0].kind).toBe("evaluate");
    expect(traces[0].status).toBe("inert");
    expect(traces[0].mode).toBe("none");
    expect(traces[0].questionCount).toBe(1);
    expect(traces[0].questionTypes).toEqual(["choice"]);
  });

  test("successful evaluate records a success trace with attempts + latency", async () => {
    const client = createDecisionClient(ENV("laya"));
    const res = await client.evaluate(req);
    expect(res?.provider).toBe("laya-mock");
    const traces = getDecisionTraces();
    expect(traces).toHaveLength(1);
    expect(traces[0].status).toBe("success");
    expect(traces[0].provider).toBe("laya-mock");
    expect(traces[0].attempts).toBe(1);
    expect(traces[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  test("failed evaluate records an error trace then still throws", async () => {
    const failing = {
      provider: "laya-mock",
      evaluate: jest.fn(async (): Promise<EvaluateResponse> => {
        throw new Error("boom-laya-mock");
      }),
      health: jest.fn(async () => ({ ok: true })),
    } as unknown as DecisionProvider;
    const client = _createDecisionClientWithProviders("laya", [failing]);
    await expect(client.evaluate(req)).rejects.toThrow("boom-laya-mock");
    const traces = getDecisionTraces();
    expect(traces).toHaveLength(1);
    expect(traces[0].kind).toBe("evaluate");
    expect(traces[0].status).toBe("error");
    expect(traces[0].error).toBe("boom-laya-mock");
  });

  test("retry-recovered evaluate records a success trace with attempts=2", async () => {
    const flaky = {
      provider: "laya-mock",
      evaluate: jest
        .fn()
        .mockRejectedValueOnce(new Error("transient"))
        .mockResolvedValueOnce({
          answers: { bias: { choice: "trending", probabilities: [0.8, 0.1, 0.1], confidence: 0.7 } },
          provider: "laya-mock",
          model: "laya-mock",
          latencyMs: 0,
        }),
      health: jest.fn(async () => ({ ok: true })),
    } as unknown as DecisionProvider;
    const client = _createDecisionClientWithProviders("laya", [flaky]);
    const res = await client.evaluate(req);
    expect(res?.provider).toBe("laya-mock");
    const traces = getDecisionTraces();
    expect(traces).toHaveLength(1);
    expect(traces[0].status).toBe("success");
    expect(traces[0].attempts).toBe(2);
  });

  test("ping records a success trace (even when inert)", async () => {
    const client = createDecisionClient(ENV("none"));
    const p = await client.ping();
    expect(p.mode).toBe("none");
    const traces = getDecisionTraces();
    expect(traces).toHaveLength(1);
    expect(traces[0].kind).toBe("ping");
    expect(traces[0].status).toBe("success");
  });

  test("ping records provider health detail when providers present", async () => {
    const ok = {
      provider: "laya-mock",
      evaluate: jest.fn(async () => ({
        answers: { bias: { choice: "trending", probabilities: [0.8, 0.1, 0.1], confidence: 0.7 } },
        provider: "laya-mock",
        model: "laya-mock",
        latencyMs: 0,
      })),
      health: jest.fn(async () => ({ ok: true })),
    } as unknown as DecisionProvider;
    const client = _createDecisionClientWithProviders("laya", [ok]);
    const p = await client.ping();
    expect(p.detail).toContain("ok");
    const traces = getDecisionTraces();
    expect(traces[0].provider).toBe("laya-mock");
  });
});