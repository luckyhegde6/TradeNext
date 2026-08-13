// lib/__tests__/nse-api.test.ts
// Tests for the security-wise historical data fetcher + OHLCV mapper.
// Pure logic — nseFetch is mocked, so no network calls in tests.

import {
  fetchSecurityWiseHistoricalData,
  securityWiseBarsToOHLCV,
  type SecurityWiseHistoricalRow,
} from "@/lib/nse-api";
import { nseFetch } from "@/lib/nse-client";

jest.mock("@/lib/nse-client", () => ({
  nseFetch: jest.fn(),
}));

const mockedNseFetch = nseFetch as jest.MockedFunction<typeof nseFetch>;

// Sample payload mirroring the real NSE response for RELIANCE (5y window):
// - one EQ row with a CA (corporate action) array on the dividend date
// - one BL (block deal) row with null delivery fields
const sampleRows: SecurityWiseHistoricalRow[] = [
  {
    CH_SYMBOL: "RELIANCE",
    CH_SERIES: "EQ",
    mTIMESTAMP: "06-Aug-2026",
    CH_TIMESTAMP: "2026-08-05T18:30:00.000Z",
    CH_PREVIOUS_CLS_PRICE: 1290.9,
    CH_OPENING_PRICE: 1293,
    CH_TRADE_HIGH_PRICE: 1299,
    CH_TRADE_LOW_PRICE: 1270.1,
    CH_LAST_TRADED_PRICE: 1280,
    CH_CLOSING_PRICE: 1280,
    VWAP: 1280.84,
    CH_TOT_TRADED_QTY: 24820782,
    CH_TOT_TRADED_VAL: 31791472335.4,
    CH_TOTAL_TRADES: 355243,
    COP_DELIV_QTY: 16901245,
    COP_DELIV_PERC: 68.09,
  },
  {
    CH_SYMBOL: "RELIANCE",
    CH_SERIES: "EQ",
    mTIMESTAMP: "05-Jun-2026",
    CH_TIMESTAMP: "2026-06-04T18:30:00.000Z",
    CH_PREVIOUS_CLS_PRICE: 1000,
    CH_OPENING_PRICE: 1010,
    CH_TRADE_HIGH_PRICE: 1020,
    CH_TRADE_LOW_PRICE: 995,
    CH_CLOSING_PRICE: 1012,
    VWAP: 1008.5,
    CH_TOT_TRADED_QTY: 1000000,
    CH_TOT_TRADED_VAL: 1008500000,
    CH_TOTAL_TRADES: 50000,
    COP_DELIV_QTY: 600000,
    COP_DELIV_PERC: 60,
    CA: [{ exDate: "05-Jun-2026", subject: "Dividend Rs 2 - Final Dividend", recDate: "06-Jun-2026", isin: "INE002A01018", faceVal: 10 }],
  },
  {
    CH_SYMBOL: "RELIANCE",
    CH_SERIES: "BL",
    mTIMESTAMP: "06-Aug-2026",
    CH_TIMESTAMP: "2026-08-05T18:30:00.000Z",
    CH_PREVIOUS_CLS_PRICE: 1290.9,
    CH_OPENING_PRICE: 1281,
    CH_TRADE_HIGH_PRICE: 1281,
    CH_TRADE_LOW_PRICE: 1281,
    CH_LAST_TRADED_PRICE: 1281,
    CH_CLOSING_PRICE: 1281,
    VWAP: 1281,
    CH_TOT_TRADED_QTY: 500000,
    CH_TOT_TRADED_VAL: 640500000,
    CH_TOTAL_TRADES: 1,
    COP_DELIV_QTY: null,
    COP_DELIV_PERC: null,
  },
];

describe("securityWiseBarsToOHLCV", () => {
  it("sorts bars ascending by timestamp", () => {
    const bars = [
      { timestamp: 2000, open: 2, high: 3, low: 1, close: 2.5, volume: 100 },
      { timestamp: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 50 },
    ] as never;

    const result = securityWiseBarsToOHLCV(bars);
    expect(result[0].timestamp).toBe(1000);
    expect(result[1].timestamp).toBe(2000);
  });

  it("maps only the OHLCV fields", () => {
    const bar = {
      timestamp: 654321,
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      volume: 100,
      series: "EQ",
      symbol: "TEST",
      // extra fields must be dropped
      deliveryQty: 10,
      corporateActions: [],
    } as never;

    const result = securityWiseBarsToOHLCV([bar]);
    expect(result[0]).toEqual({
      timestamp: 654321,
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      volume: 100,
    });
  });
});

describe("fetchSecurityWiseHistoricalData", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("requests the NSE historicalOR endpoint with DD-MM-YYYY params", async () => {
    mockedNseFetch.mockResolvedValue({ data: [] } as never);

    await fetchSecurityWiseHistoricalData("RELIANCE", "06-08-2021", "06-08-2026");

    expect(mockedNseFetch).toHaveBeenCalledWith(
      "/api/historicalOR/generateSecurityWiseHistoricalData",
      expect.stringContaining("from=06-08-2021"),
    );
    expect(mockedNseFetch).toHaveBeenCalledWith(
      "/api/historicalOR/generateSecurityWiseHistoricalData",
      expect.stringContaining("to=06-08-2026"),
    );
    expect(mockedNseFetch).toHaveBeenCalledWith(
      "/api/historicalOR/generateSecurityWiseHistoricalData",
      expect.stringContaining("symbol=RELIANCE"),
    );
  });

  it("parses EQ rows and attaches corporate actions (CA)", async () => {
    mockedNseFetch.mockResolvedValue({ data: sampleRows } as never);

    const bars = await fetchSecurityWiseHistoricalData("RELIANCE", "06-08-2021", "06-08-2026");

    // Only the EQ rows survive when no filter passed... all rows are returned,
    // but the BL row has null delivery fields — assert mapping on EQ rows.
    expect(bars.length).toBe(3);
    const eqRows = bars.filter((b) => b.series === "EQ");
    expect(eqRows.length).toBe(2);

    // Dividend row carries the CA array
    const dividendRow = eqRows.find((b) => b.close === 1012);
    expect(dividendRow).toBeDefined();
    expect(dividendRow?.corporateActions).toHaveLength(1);

    // Numeric fields are coerced to numbers
    expect(eqRows[0].close).toBe(1280);
    expect(eqRows[0].volume).toBe(24820782);
    expect(eqRows[0].deliveryQty).toBe(16901245);
    expect(eqRows[0].deliveryPercent).toBe(68.09);
  });

  it("filters to a single series when filterSeries is provided", async () => {
    mockedNseFetch.mockResolvedValue({ data: sampleRows } as never);

    const bars = await fetchSecurityWiseHistoricalData("RELIANCE", "06-08-2021", "06-08-2026", "EQ");
    expect(bars.every((b) => b.series === "EQ")).toBe(true);
    expect(bars.length).toBe(2);
  });

  it("returns [] when the payload has no data array", async () => {
    mockedNseFetch.mockResolvedValue({ something: "else" } as never);
    const bars = await fetchSecurityWiseHistoricalData("RELIANCE", "06-08-2021", "06-08-2026");
    expect(bars).toEqual([]);
  });

  it("returns [] when NSE throws (graceful degradation)", async () => {
    mockedNseFetch.mockRejectedValue(new Error("NSE 403"));
    const bars = await fetchSecurityWiseHistoricalData("RELIANCE", "06-08-2021", "06-08-2026");
    expect(bars).toEqual([]);
  });

  it("parses mTIMESTAMP (DD-MMM-YYYY) into epoch timestamps", async () => {
    mockedNseFetch.mockResolvedValue({ data: sampleRows } as never);
    const bars = await fetchSecurityWiseHistoricalData("RELIANCE", "06-08-2021", "06-08-2026");
    // mTIMESTAMP "06-Aug-2026" → Aug 6, 2026 local midnight
    const augRow = bars.find((b) => b.series === "EQ" && b.close === 1280);
    expect(augRow).toBeDefined();
    expect(new Date(augRow!.timestamp).getFullYear()).toBe(2026);
    expect(new Date(augRow!.timestamp).getMonth()).toBe(7); // August = 7
    expect(new Date(augRow!.timestamp).getDate()).toBe(6);
  });
});
