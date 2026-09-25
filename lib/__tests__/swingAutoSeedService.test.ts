// lib/__tests__/swingAutoSeedService.test.ts
// ph22 POC B — decision-engine gate for the swing one-time auto-generate.
// Unit tests only: swingRecommendationService + audit mocked, decision client
// injected via _setDecisionClient seams, no DB.
import {
  autoTriggerOnce,
  gateAutoGenerate,
  hasStoredSwingTargetsForUser,
  isSwingSeededForUser,
  AUTOSEED_NOUL,
  AUTOSEED_REGIME,
} from "@/lib/services/swingAutoSeedService";
import { getSwingRecommendations } from "@/lib/services/swingRecommendationService";
import { createAuditLog } from "@/lib/audit";
import {
  _createDecisionClientWithProviders,
  _resetDecisionClient,
  _setDecisionClient,
  type DecisionProviderMode,
} from "@/lib/services/decision/client";
import { LayaMockProvider } from "@/lib/services/decision/layaProvider";
import type { DecisionProvider, ProviderHealth } from "@/lib/services/decision/provider";
import type { DecisionAnswer, EvaluateRequest, EvaluateResponse } from "@/lib/services/decision/types";

jest.mock("@/lib/services/swingRecommendationService", () => ({
  getSwingRecommendations: jest.fn(),
}));
jest.mock("@/lib/audit", () => ({
  createAuditLog: jest.fn().mockResolvedValue(undefined),
}));

const mockGetSwing = jest.mocked(getSwingRecommendations);
const mockAudit = jest.mocked(createAuditLog);

/** Controllable fake provider for gate branch tests. */
class FakeProvider implements DecisionProvider {
  readonly provider = "fake-decision";
  constructor(
    private answers: Record<string, DecisionAnswer>,
    private fail = false,
  ) {}
  async evaluate(req: EvaluateRequest): Promise<EvaluateResponse> {
    if (this.fail) throw new Error("provider boom");
    return {
      answers: req.questions.reduce<Record<string, DecisionAnswer>>((acc, q) => {
        acc[q.name] = this.answers[q.name] ?? { noul: 0 };
        return acc;
      }, {}),
      provider: this.provider,
      model: "fake",
      latencyMs: 1,
    };
  }
  async health(): Promise<ProviderHealth> {
    return { ok: true };
  }
}

function injectClient(mode: DecisionProviderMode, providers: DecisionProvider[]): void {
  _resetDecisionClient();
  _setDecisionClient(_createDecisionClientWithProviders(mode, providers));
}

const REAL_ENV: Record<string, string | undefined> = {
  DECISION_POC_ENABLED: process.env.DECISION_POC_ENABLED,
  DECISION_PROVIDER: process.env.DECISION_PROVIDER,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSwing.mockResolvedValue(null as never);
  _resetDecisionClient();
});

afterEach(() => {
  _resetDecisionClient();
  if (REAL_ENV.DECISION_POC_ENABLED === undefined) delete process.env.DECISION_POC_ENABLED;
  else process.env.DECISION_POC_ENABLED = REAL_ENV.DECISION_POC_ENABLED;
  if (REAL_ENV.DECISION_PROVIDER === undefined) delete process.env.DECISION_PROVIDER;
  else process.env.DECISION_PROVIDER = REAL_ENV.DECISION_PROVIDER;
});

describe("gateAutoGenerate — flag off (production default)", () => {
  beforeEach(() => {
    delete process.env.DECISION_POC_ENABLED;
  });

  it("unconditionally allows WITHOUT touching the decision client", async () => {
    // A client whose evaluate would throw → the branch must never reach it.
    injectClient("laya", [new FakeProvider({}, true)]);
    const out = await gateAutoGenerate({ trigger: "empty-state" });
    expect(out).toEqual({ allowed: true, gate: "act", reason: "engine-off" });
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

describe("gateAutoGenerate — flag on", () => {
  beforeEach(() => {
    process.env.DECISION_POC_ENABLED = "true";
  });

  it("allows when laya-mock answers noul≥0.75 + trending regime", async () => {
    injectClient("laya", [new LayaMockProvider()]);
    const out = await gateAutoGenerate({ trigger: "empty-state", userId: 1 });
    expect(out.allowed).toBe(true);
    expect(out.gate).toBe("act");
    expect(out.reason).toBe("trending");
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "DECISION_GATE",
        metadata: expect.objectContaining({ allowed: true, gate: "act", reason: "trending" }),
      }),
    );
  });

  it("refuses (review, not-trending) when the regime choice is not trending", async () => {
    injectClient("laya", [
      new FakeProvider({
        [AUTOSEED_NOUL]: { noul: 0.9 },
        [AUTOSEED_REGIME]: { choice: "ranging", probabilities: [0.1, 0.9], confidence: 0.8 },
      }),
    ]);
    const out = await gateAutoGenerate({ trigger: "watchlist-add", symbol: "RELIANCE" });
    expect(out).toEqual({ allowed: false, gate: "review", reason: "not-trending" });
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "DECISION_GATE",
        metadata: expect.objectContaining({ allowed: false, gate: "review", reason: "not-trending", symbol: "RELIANCE" }),
      }),
    );
  });

  it("refuses (review, low-validity) when noul is below 0.75", async () => {
    injectClient("laya", [
      new FakeProvider({
        [AUTOSEED_NOUL]: { noul: 0.4 },
        [AUTOSEED_REGIME]: { choice: "trending", probabilities: [0.9, 0.1], confidence: 0.8 },
      }),
    ]);
    const out = await gateAutoGenerate({ trigger: "empty-state" });
    expect(out).toEqual({ allowed: false, gate: "review", reason: "low-validity" });
  });

  it("gracefully allows when the provider throws", async () => {
    injectClient("laya", [new FakeProvider({}, true)]);
    const out = await gateAutoGenerate({ trigger: "empty-state" });
    expect(out).toEqual({ allowed: true, gate: "act", reason: "engine-unavailable" });
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "DECISION_GATE",
        metadata: expect.objectContaining({ allowed: true, reason: "engine-unavailable" }),
      }),
    );
  });

  it("gracefully allows when the engine is inert (provider none → evaluate null)", async () => {
    injectClient("none", []);
    const out = await gateAutoGenerate({ trigger: "empty-state" });
    expect(out).toEqual({ allowed: true, gate: "act", reason: "engine-unavailable" });
  });

  it("refuses when the engine returns no usable answers", async () => {
    injectClient("laya", [new FakeProvider({})]);
    const out = await gateAutoGenerate({ trigger: "empty-state" });
    expect(out).toEqual({ allowed: false, gate: "review", reason: "low-validity" });
  });
});

describe("autoTriggerOnce — decision-gate integration", () => {
  beforeEach(() => {
    delete process.env.DECISION_POC_ENABLED;
  });

  it("skips (seeded=false, skipped=true) WITHOUT scanning when the gate blocks", async () => {
    process.env.DECISION_POC_ENABLED = "true";
    injectClient("laya", [
      new FakeProvider({
        [AUTOSEED_NOUL]: { noul: 0.9 },
        [AUTOSEED_REGIME]: { choice: "ranging", probabilities: [0.1, 0.9], confidence: 0.8 },
      }),
    ]);
    const out = await autoTriggerOnce({ trigger: "empty-state", userId: 42 });
    expect(out).toEqual({ seeded: false, skipped: true });
    expect(mockGetSwing).not.toHaveBeenCalledWith(
      expect.objectContaining({ forceRefresh: true, analyze: true }),
    );
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SWING_AUTO_SEED_SKIPPED",
        metadata: expect.objectContaining({ reason: "decision-gate" }),
      }),
    );
  });

  it("runs the single bounded generate when the gate allows", async () => {
    mockGetSwing.mockResolvedValue({
      stocks: [],
      generatedAt: new Date(),
    } as never);
    const out = await autoTriggerOnce({ trigger: "empty-state", userId: 43 });
    expect(out).toEqual({ seeded: true, skipped: false });
    expect(mockGetSwing).toHaveBeenCalledWith(
      expect.objectContaining({ forceRefresh: true, analyze: true }),
    );
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "SWING_AUTO_SEED_TRIGGERED" }),
    );
  });

  it("stays a seeded no-op on the second trigger (no double AI)", async () => {
    mockGetSwing.mockResolvedValue({
      stocks: [],
      generatedAt: new Date(),
    } as never);
    const first = await autoTriggerOnce({ trigger: "empty-state", userId: 44 });
    expect(first.seeded).toBe(true);
    expect(isSwingSeededForUser(44)).toBe(true);
    const second = await autoTriggerOnce({ trigger: "empty-state", userId: 44 });
    expect(second).toEqual({ seeded: true, skipped: true });
    // One bounded generate total (probe + generate on first trigger, probe only on second).
    const generateCalls = mockGetSwing.mock.calls.filter(
      (c) => c[0] && (c[0] as { forceRefresh?: boolean }).forceRefresh,
    );
    expect(generateCalls).toHaveLength(1);
  });

  it("hasStoredSwingTargetsForUser returns false for an empty stored feed", async () => {
    mockGetSwing.mockResolvedValue(null as never);
    expect(await hasStoredSwingTargetsForUser(99)).toBe(false);
  });
});