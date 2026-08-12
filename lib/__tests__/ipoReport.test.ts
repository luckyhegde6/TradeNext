// lib/__tests__/ipoReport.test.ts
//
// Pure tests for the v2 IPO report JSON architecture (lib/services/ipoReport.ts):
//   - buildIpoReportPrompt → requests ONLY JSON, embeds the IPO inputs,
//     enumerates the 18 report sections
//   - parseIpoReportJson → robust extraction from fenced / bare / prose-wrapped
//     JSON, returns null on garbage
//   - normalizeReport → safe coercion of imperfect LLM objects with defaults

import {
  buildIpoReportPrompt,
  parseIpoReportJson,
  normalizeReport,
} from "@/lib/services/ipoReport";

const SAMPLE_REPORT = {
  company: {
    name: "Shiprocket Logistics Ltd",
    symbol: "SHIPROCKET",
    sector: "Logistics / E-commerce Enablement",
    businessModel: "Tech platform for e-commerce logistics",
    promoter: "Xyz Ventures",
    institutionalBacking: "SoftBank",
  },
  summaryScores: [
    { label: "Business Quality", value: 82, tone: "green" },
    { label: "Valuation", value: 54, tone: "amber" },
  ],
  verdict: {
    label: "PARTIAL PROFIT BOOKING",
    headline: "Listing premium priced in; fundamentals solid.",
    reasons: ["Rich valuation", "Strong growth", "Positive cash flow"],
    confidencePct: 78,
  },
  quickSnapshots: [{ label: "Face Value", value: "₹10" }],
  businessOverview: "A logistics technology company.",
  financials: {
    rating: "Good",
    summary: "Revenue CAGR ~25%.",
    rows: [{ metric: "Revenue", fy1: "₹1,200 Cr", fy2: "₹900 Cr", fy3: "₹700 Cr" }],
  },
  ipoDetails: [{ label: "Price Band", value: "₹92–₹97" }],
  gmp: {
    value: "₹90",
    estimatedListingPrice: "₹182",
    expectedGainPct: 12.5,
    trend: "Increasing",
    healthNote: "Healthy but not exuberant.",
  },
  news: [{ date: "10-Aug-2026", headline: "Shiprocket expands to SEA", tag: "Positive" }],
  sentiment: {
    summary: "Positive but retail hype.",
    bullish: ["Growing TAM"],
    bearish: ["Valuation rich"],
    hypeDriven: true,
  },
  peers: {
    valuation: "Overvalued",
    summary: "Priced above peers.",
    rows: [{ name: "Delhivery", revenue: "₹8,000 Cr", patMargin: "4%", roe: "5%", pe: "120", marketCap: "₹30,000 Cr" }],
  },
  futureGrowth: {
    summary: "Strong industry tailwinds.",
    roadmap: ["Sea expansion", "New fulfilment centres"],
    oneYear: "+20%",
    threeYear: "+45%",
    fiveYear: "+80%",
  },
  risks: [
    { risk: "Client concentration", level: "High", note: "Top 2 clients >40% revenue" },
    { risk: "Competition", level: "Medium", note: "Delhivery, XpressBees" },
  ],
  listingStrategy: {
    summary: "Mixed signals.",
    scenarios: [
      { scenario: "Strong Listing (>30%)", probability: 20, play: "Sell part" },
      { scenario: "Moderate Listing (10-30%)", probability: 50, play: "Hold" },
    ],
  },
  targets: [
    { horizon: "1 Year", bull: "₹120", base: "₹105", bear: "₹90" },
    { horizon: "3 Years", bull: "₹180", base: "₹150", bear: "₹110" },
  ],
  finalScore: {
    outOf10: { "Business Quality": 8, "Valuation": 5, "Management": 7 },
    total: 66,
  },
  finalRecommendation: "Book partial profits on listing, hold the rest for growth.",
  disclaimer: "Informational only.",
};

const INPUT = {
  companyName: "Shiprocket Logistics Ltd",
  symbol: "SHIPROCKET",
  priceRange: "Rs.92 to Rs.97",
  minimumInvestment: "₹92 (1 lot × price band low ₹92)",
  issueStartDate: "12-Aug-2026",
  issueEndDate: "14-Aug-2026",
};

describe("buildIpoReportPrompt", () => {
  it("embeds the IPO input block", () => {
    const prompt = buildIpoReportPrompt(INPUT);
    expect(prompt).toContain("Shiprocket Logistics Ltd");
    expect(prompt).toContain("SHIPROCKET");
    expect(prompt).toContain("Rs.92 to Rs.97");
    expect(prompt).toContain("14-Aug-2026");
  });

  it("asks for ONLY a JSON object (report schema anchor keys)", () => {
    const prompt = buildIpoReportPrompt(INPUT);
    expect(prompt).toContain("return ONE valid JSON object");
    expect(prompt).toContain("Return JSON with EXACTLY these keys");
    expect(prompt).toContain('"company"');
    expect(prompt).toContain('"verdict"');
    expect(prompt).toContain('"summaryScores"');
    expect(prompt).toContain('"financials"');
    expect(prompt).toContain('"gmp"');
    expect(prompt).toContain('"listingStrategy"');
    expect(prompt).toContain('"finalScore"');
    expect(prompt).toContain('"disclaimer"');
  });
});

describe("parseIpoReportJson", () => {
  it("parses a bare JSON object", () => {
    const parsed = parseIpoReportJson(JSON.stringify(SAMPLE_REPORT));
    expect(parsed).not.toBeNull();
    expect(parsed!.company.symbol).toBe("SHIPROCKET");
    expect(parsed!.verdict.label).toBe("PARTIAL PROFIT BOOKING");
  });

  it("extracts from a ```json ... ``` fence", () => {
    const fenced = "Here you go:\n```json\n" + JSON.stringify(SAMPLE_REPORT) + "\n```\nDone.";
    const parsed = parseIpoReportJson(fenced);
    expect(parsed?.company.symbol).toBe("SHIPROCKET");
  });

  it("extracts from a bare ``` fence", () => {
    const fenced = "```\n" + JSON.stringify(SAMPLE_REPORT) + "\n```";
    expect(parseIpoReportJson(fenced)?.company.symbol).toBe("SHIPROCKET");
  });

  it("falls back to the outermost braces when wrapped in prose", () => {
    const wrapped = "Analysis follows: " + JSON.stringify(SAMPLE_REPORT) + " — END.";
    expect(parseIpoReportJson(wrapped)?.verdict.label).toBe("PARTIAL PROFIT BOOKING");
  });

  it("returns null on non-JSON / empty input", () => {
    expect(parseIpoReportJson("")).toBeNull();
    expect(parseIpoReportJson("garbage text without braces")).toBeNull();
    expect(parseIpoReportJson(null)).toBeNull();
    expect(parseIpoReportJson(undefined)).toBeNull();
  });
});

describe("normalizeReport", () => {
  it("passthrough-keeps a well-formed report and coerces nested fields", () => {
    const r = normalizeReport(SAMPLE_REPORT);
    expect(r.company.symbol).toBe("SHIPROCKET");
    expect(r.financials.rating).toBe("Good");
    expect(r.peers.valuation).toBe("Overvalued");
    expect(r.gmp!.trend).toBe("Increasing");
    expect(r.risks[0].level).toBe("High");
    expect(r.finalScore.total).toBe(66);
    expect(r.verdict.confidencePct).toBe(78);
  });

  it("provides safe defaults when the object is empty/noise", () => {
    const r = normalizeReport({});
    expect(r.company.name).toBe("N/A");
    expect(r.verdict.label).toBe("HOLD");
    expect(r.gmp).toBeNull();
    expect(r.finalScore.total).toBe(0);
    expect(r.disclaimer.length).toBeGreaterThan(0);
  });

  it("coerces odd verdict labels to a known verdict", () => {
    expect(normalizeReport({ verdict: { label: "EXIT immediately" } }).verdict.label).toBe(
      "EXIT ON LISTING"
    );
    expect(normalizeReport({ verdict: { label: "strong buy it" } }).verdict.label).toBe("STRONG BUY");
    expect(normalizeReport({ verdict: { label: "n/a" } }).verdict.label).toBe("HOLD");
  });

  it("clamps probability/score values into valid ranges", () => {
    const r = normalizeReport({
      verdict: { label: "HOLD", confidencePct: 250 },
      finalScore: { outOf10: { "Business Quality": 8 }, total: 140 },
    });
    expect(r.verdict.confidencePct).toBe(100);
    expect(r.finalScore.total).toBe(100);
  });
});
