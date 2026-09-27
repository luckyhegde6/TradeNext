/**
 * Spec 20 §5.C — admin-console status payload + the read-only header classifier.
 *
 * The load-bearing assertions here are the NEGATIVE ones: the status payload
 * must never carry a secret value, and a status read must never write to the
 * user's sheet. A regression in either is invisible in the UI but leaks into
 * screenshots and issue threads.
 */
import { classifyHeader, TRACKER_TABS, readHeaderState, type TrackerTab } from "@/lib/services/googleSheets/tabs";
import { getStatus } from "@/lib/services/googleSheets/statusService";
import { isTrackingEnabled, trackerSheetId, getSheetsClient } from "@/lib/services/googleSheets/auth";

jest.mock("@/lib/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock("@/lib/audit", () => ({ createAuditLog: jest.fn(async () => ({ id: 1 })) }));

jest.mock("@/lib/services/googleSheets/auth", () => ({
  isTrackingEnabled: jest.fn(),
  trackerSheetId: jest.fn(),
  getSheetsClient: jest.fn(),
  _resetGoogleSheetsClients: jest.fn(),
}));

const mockIsTrackingEnabled = isTrackingEnabled as jest.Mock;
const mockTrackerSheetId = trackerSheetId as jest.Mock<string | null, []>;
const mockGetSheetsClient = getSheetsClient as jest.Mock;

const TABS = Object.keys(TRACKER_TABS) as TrackerTab[];

/** A 30-char id so masking actually has a middle to elide. */
const SHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";

function mockSheets(firstRow?: string[]) {
  const get = jest.fn().mockResolvedValue({
    data: firstRow ? { values: [firstRow] } : {},
  });
  mockGetSheetsClient.mockResolvedValue({ spreadsheets: { values: { get } } });
  return { get, update: jest.fn().mockResolvedValue({}) };
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.GOOGLE_SHEETS_TRACKING_ENABLED;
  delete process.env.GOOGLE_SHEET_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  delete process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  mockIsTrackingEnabled.mockReturnValue(true);
  mockTrackerSheetId.mockReturnValue(SHEET_ID);
});

describe("classifyHeader (pure)", () => {
  const expected = ["a", "b", "c"];

  it("treats a missing first row as absent", () => {
    expect(classifyHeader(undefined, expected)).toBe("absent");
    expect(classifyHeader([], expected)).toBe("absent");
  });

  it("treats an all-blank first row as absent (the API omits empty cells)", () => {
    expect(classifyHeader(["", "  ", null], expected)).toBe("absent");
  });

  it("matches an exact positional match", () => {
    expect(classifyHeader(["a", "b", "c"], expected)).toBe("matched");
  });

  it("flags reordered columns as drifted, never as matched", () => {
    expect(classifyHeader(["c", "b", "a"], expected)).toBe("drifted");
  });

  it("flags a length change as drifted", () => {
    expect(classifyHeader(["a", "b"], expected)).toBe("drifted");
    expect(classifyHeader(["a", "b", "c", "d"], expected)).toBe("drifted");
  });
});

describe("readHeaderState", () => {
  it("returns the classified state for a readable tab", async () => {
    mockSheets([...TRACKER_TABS.swing]);
    await expect(readHeaderState("swing")).resolves.toBe("matched");
  });

  it("returns unknown — not a throw — when no spreadsheet is configured", async () => {
    mockTrackerSheetId.mockReturnValue(null);
    await expect(readHeaderState("swing")).resolves.toBe("unknown");
    expect(mockGetSheetsClient).not.toHaveBeenCalled();
  });

  it("returns unknown when the Sheets API rejects, and never writes", async () => {
    const update = jest.fn();
    mockGetSheetsClient.mockResolvedValue({
      spreadsheets: {
        values: { get: jest.fn().mockRejectedValue(new Error("403")), update },
      },
    });
    await expect(readHeaderState("swing")).resolves.toBe("unknown");
    expect(update).not.toHaveBeenCalled();
  });
});

describe("getStatus", () => {
  it("reports env gate, effective gate, and one entry per tab in contract order", async () => {
    mockSheets(["written-by-user"]);
    const s = await getStatus();

    expect(s.envEnabled).toBe(true);
    expect(s.trackingEnabled).toBe(true);
    expect(s.perTab.map((t) => t.tab)).toEqual(TABS);
    // Derived, not a literal: a hardcoded count silently rots the next time a
    // tab is added to the registry (it did, when `metrics` became the 6th).
    expect(s.perTab).toHaveLength(TABS.length);
    expect(s.perTab[0].headerState).toBe("drifted");
    // Never synced yet in a clean environment.
    expect(s.perTab.every((t) => t.lastMark === null)).toBe(true);
  });

  it("masks the spreadsheet id and never returns it in full", async () => {
    mockSheets();
    const s = await getStatus();

    expect(s.sheetIdMasked).toBeTruthy();
    expect(s.sheetIdMasked).toContain("…");
    expect(s.sheetIdMasked).not.toBe(SHEET_ID);
    expect(s.sheetIdMasked).not.toContain(SHEET_ID);
    expect(JSON.stringify(s)).not.toContain(SHEET_ID);
  });

  it("reports sheetIdMasked null and every tab unknown when unconfigured", async () => {
    mockTrackerSheetId.mockReturnValue(null);
    const s = await getStatus();

    expect(s.sheetIdMasked).toBeNull();
    expect(s.dbConfigured).toBe(false);
    // Env master is on, but with no spreadsheet id nothing could be written, so
    // the console must not claim tracking is active.
    expect(s.envEnabled).toBe(true);
    expect(s.trackingEnabled).toBe(false);
    expect(s.perTab.every((t) => t.headerState === "unknown")).toBe(true);
  });

  it("honours the env master switch when off", async () => {
    mockIsTrackingEnabled.mockReturnValue(false);
    mockSheets();
    const s = await getStatus();

    expect(s.envEnabled).toBe(false);
    expect(s.trackingEnabled).toBe(false);
  });

  it("reports OAuth presence as booleans only — never the secret values", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client-id-value";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "super-secret-value";
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN = "1//refresh-token-value";
    mockSheets();

    const s = await getStatus();

    expect(s.oauthConfigured).toEqual({
      clientId: true,
      clientSecret: true,
      refreshToken: true,
    });
    const dumped = JSON.stringify(s);
    expect(dumped).not.toContain("super-secret-value");
    expect(dumped).not.toContain("1//refresh-token-value");
    expect(dumped).not.toContain("client-id-value");
  });

  it("reports blank OAuth env vars as absent", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "   ";
    mockSheets();
    const s = await getStatus();
    expect(s.oauthConfigured).toEqual({
      clientId: false,
      clientSecret: false,
      refreshToken: false,
    });
  });

  it("does not write to the sheet while building status", async () => {
    const update = jest.fn();
    mockGetSheetsClient.mockResolvedValue({
      spreadsheets: { values: { get: jest.fn().mockResolvedValue({ data: {} }), update } },
    });
    await getStatus();
    expect(update).not.toHaveBeenCalled();
  });
});
