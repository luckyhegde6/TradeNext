/**
 * Google Sheets status payload for the admin console (spec 20 §5.C).
 *
 * Design rule that governs this whole file: **booleans and enums only — never a
 * secret value.** The console renders this verbatim, and status is also the
 * first thing anyone screenshots into an issue. So:
 *   - the spreadsheet id is only ever returned masked (`1AbC…XyZ`);
 *   - OAuth creds are reported as three booleans, never echoed;
 *   - the refresh token is never read from anywhere in this file.
 *
 * Every read is SQLite-first (the DB config) with the env fallback preserved
 * for the Spec 19 env-only deployment, and nothing here touches Prisma — the
 * console must keep working while the plan-limit hold is open.
 */
import logger from "@/lib/logger";
import { isTrackingEnabled } from "./auth";
import { getConfig, isTrackingActive, maskSheetId } from "./configService";
import { TRACKER_TABS, readHeaderState, type HeaderState, type TrackerTab } from "./tabs";

/** Per-tab status row rendered by the console. */
export interface TabStatus {
  tab: TrackerTab;
  /** Live header comparison — `unknown` when it could not be read. */
  headerState: HeaderState;
  /** ISO high-water mark for the next manual sync, or `null` if never synced. */
  lastMark: string | null;
}

/** The full status payload. Contains no secret values by construction. */
export interface SheetsStatus {
  /** `GOOGLE_SHEETS_TRACKING_ENABLED === "true"`. The master switch. */
  envEnabled: boolean;
  /** True when a config row exists in the mirror. */
  dbConfigured: boolean;
  /** Masked spreadsheet id, e.g. `1AbC…XyZ`. `null` when unset. */
  sheetIdMasked: string | null;
  /** Which half of the OAuth trio is present. Booleans only. */
  oauthConfigured: { clientId: boolean; clientSecret: boolean; refreshToken: boolean };
  /**
   * Whether a row could actually be written right now: the gate is open
   * (env master AND DB switch) **and** a spreadsheet id resolves.
   *
   * Deliberately stricter than the write gate alone — with the env flag on but
   * no spreadsheet configured, every append would fail, and a console that
   * reported "tracking on" there would be lying. `envEnabled`, `dbConfigured`
   * and `sheetIdMasked` are in the payload so the UI can explain *why*.
   */
  trackingEnabled: boolean;
  /** One entry per tab, in `TRACKER_TABS` declaration order. */
  perTab: TabStatus[];
}

/** True when an env var is present and non-blank. Never logs the value. */
function isSet(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.trim() !== "";
}

/**
 * Build the console status payload.
 *
 * Never throws — the console shows a status page, and a failure here must
 * render as "unknown", not as a 500 that hides the rest of the state.
 */
export async function getStatus(): Promise<SheetsStatus> {
  const config = getConfig();
  const configuredId = config.sheetId;

  // Read each tab's header sequentially-safe: `readHeaderState` swallows its own
  // errors, so a single bad tab degrades to "unknown" instead of failing the
  // whole payload. `Promise.all` here is safe (pure reads, no Sheets writes)
  // and keeps the console fast.
  const tabs = Object.keys(TRACKER_TABS) as TrackerTab[];
  const perTab = await Promise.all(
    tabs.map(async (tab) => ({
      tab,
      headerState: await readHeaderState(tab),
      lastMark: config.tabMarks[tab] ?? null,
    }))
  );

  const status: SheetsStatus = {
    envEnabled: isTrackingEnabled(),
    dbConfigured: Boolean(configuredId) || config.displayName !== null,
    sheetIdMasked: configuredId ? maskSheetId(configuredId) : null,
    oauthConfigured: {
      clientId: isSet("GOOGLE_OAUTH_CLIENT_ID"),
      clientSecret: isSet("GOOGLE_OAUTH_CLIENT_SECRET"),
      refreshToken: isSet("GOOGLE_OAUTH_REFRESH_TOKEN"),
    },
    trackingEnabled: isTrackingActive() && Boolean(config.sheetId),
    perTab,
  };

  logger.debug({
    msg: "Google Sheets status read",
    envEnabled: status.envEnabled,
    dbConfigured: status.dbConfigured,
    trackingEnabled: status.trackingEnabled,
    tabs: perTab.length,
  });

  return status;
}
