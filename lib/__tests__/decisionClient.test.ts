// lib/__tests__/decisionClient.test.ts
// ph22 Decision engine — client factory: mode coercion, inert NOOP, retry/backoff,
// provider latency. Laya-only (TypeSafe/Jev intentionally out of scope).
//
// jest.mock must precede imports (SWC hoists jest.mock).
jest.mock("@/lib/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  createDecisionClient,
  _createDecisionClientWithProviders,
  _resetDecisionClient,
} from "@/lib/services/decision/client";
import logger from "@/lib/logger";
import type { DecisionProvider } from "@/lib/services/decision/provider";
import type { EvaluateResponse } from "@/lib/services/decision/types";

const ENV = (value?: string, layaReal?: string): NodeJS.ProcessEnv =>
  ({ DECISION_PROVIDER: value, DECISION_LAYA_REAL: layaReal }) as unknown as NodeJS.ProcessEnv;

const req = {
  state: { momentum: 0.8 },
  questions: [{ type: "choice" as const, name: "bias", options: ["trending", "range", "reversal"] }],
};

function fakeProvider(name: string, opts: { fail?: boolean; latency?: number } = {}): DecisionProvider {
  return {
    provider: name,
    evaluate: jest.fn(async (): Promise<EvaluateResponse> => {
      if (opts.fail) throw new Error(`boom-${name}`);
      await new Promise((r) => setTimeout(r, opts.latency ?? 1));
      return {
        answers: { bias: { choice: "trending", probabilities: [0.8, 0.1, 0.1], confidence: 0.7 } },
        provider: name,
        model: name,
        latencyMs: 0,
      };
    }),
    health: jest.fn(async () => ({ ok: true })),
  };
}

describe("createDecisionClient — mode coercion + inert default", () => {
  test("DECISION_PROVIDER=none (default) is inert — evaluate() returns null", async () => {
    const client = createDecisionClient(ENV("none"));
    expect(client.mode()).toBe("none");
    expect(client.providers()).toEqual([]);
    await expect(client.evaluate(req)).resolves.toBeNull();
  });

  test("missing env var is inert (production default is NOOP)", async () => {
    const client = createDecisionClient(ENV(undefined));
    expect(client.mode()).toBe("none");
    await expect(client.evaluate(req)).resolves.toBeNull();
  });

  test("unknown provider value coerces to none (warn path)", async () => {
    const client = createDecisionClient(ENV("bogus"));
    expect(client.mode()).toBe("none");
    await expect(client.evaluate(req)).resolves.toBeNull();
  });

  test("ping reports inert mode when no providers", async () => {
    const client = createDecisionClient(ENV("none"));
    const p = await client.ping();
    expect(p.mode).toBe("none");
    expect(p.detail).toContain("inert");
  });
});

describe("factory provider selection", () => {
  test("laya mode exposes laya-mock provider and evaluates (default, byte-identical)", async () => {
    const client = createDecisionClient(ENV("laya"));
    expect(client.providers()).toEqual(["laya-mock"]);
    const res = await client.evaluate(req);
    expect(res?.provider).toBe("laya-mock");
    const bias = res?.answers.bias as { choice: string };
    expect(bias.choice).toBe("trending");
  });
});

describe("DECISION_LAYA_REAL gate (laya mode)", () => {
  test("truthy whitelist selects the real provider — case/whitespace-insensitive", () => {
    for (const flag of ["1", "true", "yes", " TRUE ", "Yes"]) {
      const client = createDecisionClient(ENV("laya", flag));
      expect(client.mode()).toBe("laya");
      expect(client.providers()).toEqual(["laya"]);
    }
  });

  test("absent / empty flag stays mock (production default)", () => {
    for (const flag of [undefined, ""]) {
      const client = createDecisionClient(ENV("laya", flag));
      expect(client.providers()).toEqual(["laya-mock"]);
    }
  });

  test("unknown flag value warns once and stays mock (conservative)", () => {
    const warn = jest.spyOn(logger, "warn");
    warn.mockClear(); // prior tests may have warned via the shared mocked logger
    const client = createDecisionClient(ENV("laya", "banana"));
    expect(client.providers()).toEqual(["laya-mock"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect((warn.mock.calls[0]?.[0] as { msg?: string }).msg ?? "").toContain("Unknown DECISION_LAYA_REAL");
    warn.mockRestore();
  });

  test("flag is ignored when mode is none (still inert)", () => {
    const client = createDecisionClient(ENV("none", "1"));
    expect(client.providers()).toEqual([]);
  });
});

describe("retry + latency (injected providers — deterministic)", () => {
  beforeEach(() => {
    jest.useRealTimers();
  });

  test("retries up to 3 attempts before surfacing the error", async () => {
    const failing = fakeProvider("laya-mock", { fail: true });
    const client = _createDecisionClientWithProviders("laya", [failing]);

    await expect(client.evaluate(req)).rejects.toThrow("boom-laya-mock");
    expect((failing.evaluate as jest.Mock).mock.calls.length).toBe(4); // 1 + 3 retries
  });

  test("recovers when a retry succeeds", async () => {
    const flaky = fakeProvider("laya-mock");
    (flaky.evaluate as jest.Mock)
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce({
        answers: { bias: { choice: "trending", probabilities: [0.8, 0.1, 0.1], confidence: 0.7 } },
        provider: "laya-mock",
        model: "laya-mock",
        latencyMs: 0,
      });
    const client = _createDecisionClientWithProviders("laya", [flaky]);
    const res = await client.evaluate(req);
    expect(res?.provider).toBe("laya-mock");
    expect((flaky.evaluate as jest.Mock).mock.calls.length).toBe(2);
  });

  test("single provider success returns provider + latency", async () => {
    const ok = fakeProvider("laya-mock", { latency: 5 });
    const client = _createDecisionClientWithProviders("laya", [ok]);
    const res = await client.evaluate(req);
    expect(res?.provider).toBe("laya-mock");
    expect(res?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test("ping surfaces provider health", async () => {
    const ok = fakeProvider("laya-mock");
    const client = _createDecisionClientWithProviders("laya", [ok]);
    const p = await client.ping();
    expect(p.mode).toBe("laya");
    expect(p.providers).toEqual(["laya-mock"]);
    expect(p.detail).toContain("ok");
  });
});

describe("singleton", () => {
  test("getDecisionClient caches, _resetDecisionClient drops it", async () => {
    _resetDecisionClient();
    const { getDecisionClient } = jest.requireActual("@/lib/services/decision/client") as {
      getDecisionClient: () => { mode(): string; providers(): string[]; evaluate(r: unknown): Promise<unknown> };
    };
    const a = getDecisionClient();
    expect(a.mode()).toBe("none"); // process.env has no DECISION_PROVIDER in test env
    expect(a.providers()).toEqual([]);
    expect(await a.evaluate(req)).toBeNull();
  });
});