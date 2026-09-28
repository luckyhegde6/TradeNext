// lib/__tests__/googleSheetsAuth.test.ts
// Spec 19 — OAuth2/Sheets client singletons: the master flag, the sheet-id
// reader, env validation (names only, never values), and lazy caching.

jest.mock("googleapis", () => {
  const setCredentials = jest.fn();
  const OAuth2 = jest.fn().mockImplementation(() => ({ setCredentials }));
  const sheets = jest.fn().mockImplementation(() => ({ spreadsheets: {} }));
  return { google: { auth: { OAuth2 }, sheets } };
});

jest.mock("@/lib/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  GOOGLE_OAUTH_REDIRECT_URI,
  GOOGLE_SCOPES,
  _resetGoogleSheetsClients,
  getOAuth2Client,
  getSheetsClient,
  isTrackingEnabled,
  trackerSheetId,
} from "@/lib/services/googleSheets/auth";

const mockGoogleapis = jest.requireMock("googleapis") as {
  google: {
    auth: { OAuth2: jest.Mock };
    sheets: jest.Mock;
  };
};

const ENV_KEYS = [
  "GOOGLE_SHEETS_TRACKING_ENABLED",
  "GOOGLE_SHEET_ID",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REFRESH_TOKEN",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  _resetGoogleSheetsClients();
  mockGoogleapis.google.auth.OAuth2.mockClear();
  mockGoogleapis.google.sheets.mockClear();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function armOauth(): void {
  process.env.GOOGLE_OAUTH_CLIENT_ID = "cid";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "csecret";
  process.env.GOOGLE_OAUTH_REFRESH_TOKEN = "rtoken";
}

describe("isTrackingEnabled", () => {
  test('only the exact string "true" arms the exporter', () => {
    for (const value of ["true"]) {
      process.env.GOOGLE_SHEETS_TRACKING_ENABLED = value;
      expect(isTrackingEnabled()).toBe(true);
    }
    for (const value of ["TRUE", "True", "1", "yes", "on", " true", "true ", "", "false"]) {
      process.env.GOOGLE_SHEETS_TRACKING_ENABLED = value;
      expect(isTrackingEnabled()).toBe(false);
    }
  });

  test("unset is off", () => {
    expect(isTrackingEnabled()).toBe(false);
  });
});

describe("trackerSheetId", () => {
  test("returns the trimmed id", () => {
    process.env.GOOGLE_SHEET_ID = "  sheet-123  ";
    expect(trackerSheetId()).toBe("sheet-123");
  });

  test("blank and unset both yield null", () => {
    process.env.GOOGLE_SHEET_ID = "   ";
    expect(trackerSheetId()).toBeNull();
    delete process.env.GOOGLE_SHEET_ID;
    expect(trackerSheetId()).toBeNull();
  });
});

describe("scopes and redirect", () => {
  test("requests only the spreadsheets scope and a loopback redirect", () => {
    expect(GOOGLE_SCOPES).toEqual(["https://www.googleapis.com/auth/spreadsheets"]);
    expect(GOOGLE_OAUTH_REDIRECT_URI).toBe("http://localhost");
  });
});

describe("getOAuth2Client", () => {
  test("throws naming every missing variable", async () => {
    await expect(getOAuth2Client()).rejects.toThrow(/GOOGLE_OAUTH_CLIENT_ID/);
    await expect(getOAuth2Client()).rejects.toThrow(/GOOGLE_OAUTH_CLIENT_SECRET/);
    await expect(getOAuth2Client()).rejects.toThrow(/GOOGLE_OAUTH_REFRESH_TOKEN/);
  });

  test("never leaks a secret value in the error", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "cid";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "SUPER-SECRET-VALUE";
    // refresh token deliberately missing
    const err = await getOAuth2Client().then(
      () => new Error("expected a rejection"),
      (e: unknown) => e as Error
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("GOOGLE_OAUTH_REFRESH_TOKEN");
    expect(err.message).not.toContain("SUPER-SECRET-VALUE");
  });

  test("builds the client from env and sets the refresh token", async () => {
    armOauth();
    const client = await getOAuth2Client();
    expect(mockGoogleapis.google.auth.OAuth2).toHaveBeenCalledWith("cid", "csecret", GOOGLE_OAUTH_REDIRECT_URI);
    expect(client.setCredentials).toHaveBeenCalledWith({ refresh_token: "rtoken" });
  });

  test("caches the client across calls", async () => {
    armOauth();
    const a = await getOAuth2Client();
    const b = await getOAuth2Client();
    expect(a).toBe(b);
    expect(mockGoogleapis.google.auth.OAuth2).toHaveBeenCalledTimes(1);
  });

  test("rebuilds after a reset", async () => {
    armOauth();
    const a = await getOAuth2Client();
    _resetGoogleSheetsClients();
    const b = await getOAuth2Client();
    expect(a).not.toBe(b);
    expect(mockGoogleapis.google.auth.OAuth2).toHaveBeenCalledTimes(2);
  });
});

describe("getSheetsClient", () => {
  test("builds sheets v4 bound to the OAuth client and caches it", async () => {
    armOauth();
    const sheets = await getSheetsClient();
    const oauth = await getOAuth2Client();
    expect(mockGoogleapis.google.sheets).toHaveBeenCalledWith({ version: "v4", auth: oauth });
    expect(sheets).toBe(await getSheetsClient());
    expect(mockGoogleapis.google.sheets).toHaveBeenCalledTimes(1);
  });

  test("propagates the env error when OAuth is unconfigured", async () => {
    await expect(getSheetsClient()).rejects.toThrow(/GOOGLE_OAUTH_CLIENT_ID/);
  });

  test("rebuilds after a reset", async () => {
    armOauth();
    const a = await getSheetsClient();
    _resetGoogleSheetsClients();
    const b = await getSheetsClient();
    expect(a).not.toBe(b);
  });
});
