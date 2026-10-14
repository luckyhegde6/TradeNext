/**
 * Spec 31: verify Google Sheets production environment.
 *
 * Exit codes:
 *   0 — all 5 required env vars are present and non-blank.
 *   1 — some vars are missing (non-fatal: the console will show "env missing").
 *   2 — the critical refresh token is missing (fatal: no Oauth, no writes).
 *
 * Never logs secrets; only reports presence/absence of variable names.
 */
require("events").EventEmitter.defaultMaxListeners = Infinity; // silence node -e noise

const required = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REFRESH_TOKEN",
  "GOOGLE_SHEETS_TRACKING_ENABLED",
  "GOOGLE_SHEET_ID",
];

const missing: string[] = [];
const present: string[] = [];

for (const name of required) {
  const val = process.env[name];
  if (typeof val === "string" && val.trim() !== "") {
    present.push(name);
  } else {
    missing.push(name);
  }
}

if (missing.includes("GOOGLE_OAUTH_REFRESH_TOKEN")) {
  // Critical: without a refresh token we cannot OAuth, period.
  console.error(
    "GS verify FAIL (exit 2): missing critical env var GOOGLE_OAUTH_REFRESH_TOKEN\n" +
      `Missing: ${missing.join(", ")}`
  );
  process.exit(2);
}

if (missing.length > 0) {
  console.warn(
    "GS verify WARN (exit 1): some required env vars are missing\n" +
      `Present: ${present.join(", ")}\nMissing: ${missing.join(", ")}`
  );
  process.exit(1);
}

console.log(
  "GS verify OK (exit 0): all 5 required env vars are present"
);
process.exit(0);