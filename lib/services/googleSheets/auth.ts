/**
 * Google Sheets OAuth2 + client singletons (spec 19 §4.A).
 *
 * The TradeNext Tracker spreadsheet is the durable, append-only log for swing
 * signals, daily recommendations, screener hits, custom scans, and decision
 * traces. Auth is OAuth2 *user consent*: a one-time browser consent mints a
 * refresh token, which is stored server-side (local `.env` + Netlify env vars)
 * and refreshed automatically by google-auth-library.
 *
 * Design notes:
 * - `googleapis` is imported DYNAMICALLY inside the lazy init, so importing this
 *   module (or the googleSheets barrel) costs nothing and the Next build graph
 *   never pulls the CJS SDK unless tracking is actually armed. Mirrors the
 *   `lib/services/laya/tokenizer.ts` lazy-singleton pattern.
 * - Singletons live on `global` so a dev-mode module reload (and the Jest module
 *   registry) reuses one client instead of rebuilding it per call.
 * - Types are imported type-only from `googleapis` (which re-exports `Auth` from
 *   google-auth-library), keeping the declared dependency surface to one package.
 */
import logger from "@/lib/logger";
import type { Auth, sheets_v4 } from "googleapis";

/** OAuth scope — read+write on the user's Tracker sheet. */
export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

/**
 * Loopback redirect used ONLY by the one-time consent script
 * (`scripts/dev-checks/google-oauth-consent.mjs`). A Desktop-app OAuth client
 * must use a loopback or OOB redirect; google-auth-library's `getToken` with a
 * `code` from the pasted URL works against this same value.
 */
export const GOOGLE_OAUTH_REDIRECT_URI = "http://localhost";

/**
 * Master switch. Only the exact string `"true"` arms the exporter — anything
 * else (including `"1"`) is off, so a typo can never silently start writing to
 * the user's sheet. Off is a byte-identical no-op (zero network calls).
 */
export function isTrackingEnabled(): boolean {
  return process.env.GOOGLE_SHEETS_TRACKING_ENABLED === "true";
}

/** Configured spreadsheet id, or `null` when unset/blank. */
export function trackerSheetId(): string | null {
  const id = process.env.GOOGLE_SHEET_ID?.trim();
  return id ? id : null;
}

declare global {
  var _googleSheetsOAuthClient: Auth.OAuth2Client | undefined;
  var _googleSheetsSheetsClient: sheets_v4.Sheets | undefined;
}

/**
 * Lazily build (and cache) the OAuth2 client from env.
 *
 * @throws when any of the 3 OAuth vars is missing — the message names the
 *   missing VARIABLES only, never their values. Callers (the exporter) catch;
 *   export is fire-and-forget so a throw must never reach business logic.
 */
export async function getOAuth2Client(): Promise<Auth.OAuth2Client> {
  if (global._googleSheetsOAuthClient) return global._googleSheetsOAuthClient;

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN?.trim();

  const missing: string[] = [];
  if (!clientId) missing.push("GOOGLE_OAUTH_CLIENT_ID");
  if (!clientSecret) missing.push("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!refreshToken) missing.push("GOOGLE_OAUTH_REFRESH_TOKEN");
  if (missing.length > 0) {
    throw new Error(
      `Google Sheets OAuth env incomplete — missing: ${missing.join(", ")}`
    );
  }

  const { google } = await import("googleapis");
  const client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    GOOGLE_OAUTH_REDIRECT_URI
  );
  // google-auth-library refreshes the (1h) access token transparently.
  client.setCredentials({ refresh_token: refreshToken });

  global._googleSheetsOAuthClient = client;
  return client;
}

/** Lazily build (and cache) the Sheets v4 client bound to the OAuth2 client. */
export async function getSheetsClient(): Promise<sheets_v4.Sheets> {
  if (global._googleSheetsSheetsClient) return global._googleSheetsSheetsClient;

  const auth = await getOAuth2Client();
  const { google } = await import("googleapis");
  const sheets = google.sheets({ version: "v4", auth });

  global._googleSheetsSheetsClient = sheets;
  return sheets;
}

/**
 * Test seam — drops the cached OAuth/Sheets clients so a test can change env
 * between cases. Mirrors `_resetDecisionClient` in the decision module.
 */
export function _resetGoogleSheetsClients(): void {
  global._googleSheetsOAuthClient = undefined;
  global._googleSheetsSheetsClient = undefined;
}

/** Log whether tracking is armed, with the reason when it is not (admin/debug aid). */
export function logTrackingStatus(): void {
  if (!isTrackingEnabled()) {
    logger.debug({ msg: "Google Sheets tracking disabled" });
    return;
  }
  logger.info({
    msg: "Google Sheets tracking enabled",
    sheetId: trackerSheetId(),
  });
}
