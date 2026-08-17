// lib/__tests__/ipoAnalysisPrewarm.test.ts
//
// v3.14.1: tests for executeIpoAnalysisPrewarm — pre-warms IPO analysis
// cache for all Active IPOs. Uses dynamic imports internally.

jest.mock("@/lib/logger", () => {
  const mock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { __esModule: true, default: mock };
});

jest.mock("@/lib/services/nseIpoService", () => ({
  __esModule: true,
  getUpcomingIpoIssues: jest.fn(),
}));

jest.mock("@/lib/services/ipoAnalysisService", () => ({
  __esModule: true,
  getIpoAnalysis: jest.fn(),
}));

import { executeIpoAnalysisPrewarm } from "@/lib/services/worker/worker-service";
import { getUpcomingIpoIssues } from "@/lib/services/nseIpoService";
import { getIpoAnalysis } from "@/lib/services/ipoAnalysisService";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("executeIpoAnalysisPrewarm", () => {
  const ACTIVE_ISSUE = { symbol: "GAJA", status: "Active", companyName: "Gaja Corp" };
  const FORTHCOMING_ISSUE = { symbol: "LALITHAA", status: "Forthcoming", companyName: "Lalithaa Jewellery" };
  const CLOSED_ISSUE = { symbol: "SUNSHINE", status: "Closed", companyName: "Sunshine Ltd" };

  test("pre-warms only Active IPOs, skips Forthcoming and Closed", async () => {
    (getUpcomingIpoIssues as jest.Mock).mockResolvedValue({
      data: [ACTIVE_ISSUE, FORTHCOMING_ISSUE, CLOSED_ISSUE],
      source: "nse",
    });
    (getIpoAnalysis as jest.Mock).mockResolvedValue({
      symbol: "GAJA",
      source: "ai",
      content: "analysis",
      generatedAt: new Date().toISOString(),
    });

    const result = await executeIpoAnalysisPrewarm() as Record<string, number>;

    expect(result.total).toBe(1); // only Active
    expect(result.generated).toBe(1);
    expect(result.cached).toBe(0);
    expect(result.errors).toBe(0);
    expect(getIpoAnalysis).toHaveBeenCalledTimes(1);
    expect(getIpoAnalysis).toHaveBeenCalledWith("GAJA");
  });

  test("reports cached vs generated correctly", async () => {
    (getUpcomingIpoIssues as jest.Mock).mockResolvedValue({
      data: [
        { symbol: "GAJA", status: "Active" },
        { symbol: "HORIZONIND", status: "Active" },
      ],
      source: "nse",
    });
    (getIpoAnalysis as jest.Mock)
      .mockResolvedValueOnce({ symbol: "GAJA", source: "ai", content: "a", generatedAt: new Date().toISOString() })
      .mockResolvedValueOnce({ symbol: "HORIZONIND", source: "cache", content: "c", generatedAt: new Date().toISOString() });

    const result = await executeIpoAnalysisPrewarm() as Record<string, number>;

    expect(result.total).toBe(2);
    expect(result.generated).toBe(1);
    expect(result.cached).toBe(1);
    expect(result.errors).toBe(0);
  });

  test("per-IPO error tolerance: one failure does not block others", async () => {
    (getUpcomingIpoIssues as jest.Mock).mockResolvedValue({
      data: [
        { symbol: "GAJA", status: "Active" },
        { symbol: "HORIZONIND", status: "Active" },
      ],
      source: "nse",
    });
    (getIpoAnalysis as jest.Mock)
      .mockRejectedValueOnce(new Error("AI is not configured"))
      .mockResolvedValueOnce({ symbol: "HORIZONIND", source: "ai", content: "a", generatedAt: new Date().toISOString() });

    const result = await executeIpoAnalysisPrewarm() as Record<string, number>;

    expect(result.total).toBe(2);
    expect(result.generated).toBe(1);
    expect(result.errors).toBe(1);
  });

  test("returns zero counts when no Active IPOs exist", async () => {
    (getUpcomingIpoIssues as jest.Mock).mockResolvedValue({
      data: [FORTHCOMING_ISSUE, CLOSED_ISSUE],
      source: "nse",
    });

    const result = await executeIpoAnalysisPrewarm() as Record<string, number>;

    expect(result.total).toBe(0);
    expect(result.generated).toBe(0);
    expect(result.cached).toBe(0);
    expect(result.errors).toBe(0);
    expect(getIpoAnalysis).not.toHaveBeenCalled();
  });

  test("returns zero counts when IPO list is empty", async () => {
    (getUpcomingIpoIssues as jest.Mock).mockResolvedValue({ data: [], source: "nse" });

    const result = await executeIpoAnalysisPrewarm() as Record<string, number>;

    expect(result.total).toBe(0);
    expect(getIpoAnalysis).not.toHaveBeenCalled();
  });
});
