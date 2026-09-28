#!/usr/bin/env node
/**
 * THROWAWAY — DELETE AFTER USE. Do NOT commit this file.
 *
 * One-time OAuth2 user-consent run that mints a Google Sheets refresh token.
 * Desktop-app clients use the loopback flow (OOB was removed from
 * google-auth-library), so this script opens a temporary local HTTP listener,
 * prints the consent URL, exchanges the returned code, and prints the refresh
 * token. Nothing is written to disk.
 *
 * Usage (after putting GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET in
 * the environment or .env):
 *   node scripts/dev-checks/google-oauth-consent.mjs
 *
 * Then paste the printed refresh token into local .env and the Netlify
 * environment. Testing-mode refresh tokens expire after 7 days — re-run this
 * script (or publish the OAuth app) when that happens.
 */
import { createServer } from "node:http";

const PORT = 3005; // deliberately not 3000/3001 (dev servers) or 4096 (OpenCode UI)
const SCOPE = ["https://www.googleapis.com/auth/spreadsheets"];

// Plain `node` does NOT auto-load .env, so honour the usage note below.
// No-op when the file is absent or the running Node predates loadEnvFile.
try {
  process.loadEnvFile();
} catch {
  /* no .env, or unsupported — real env vars still win */
}

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();

if (!clientId || !clientSecret) {
  console.error(
    "Missing GOOGLE_OAUTH_CLIENT_ID and/or GOOGLE_OAUTH_CLIENT_SECRET.\n" +
      "Set them in the environment or in .env first, then re-run."
  );
  process.exit(1);
}

// Loaded lazily so the missing-env check above fails fast without paying the
// googleapis import cost.
const { google } = await import("googleapis");
const redirectUri = `http://localhost:${PORT}`;
const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", redirectUri);
  const code = url.searchParams.get("code");
  const denied = url.searchParams.get("error");

  if (denied) {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end(`Consent denied (${denied}). No token minted.`);
    console.error(`\nConsent denied: ${denied}`);
    server.close(() => process.exit(1));
    return;
  }

  if (!code) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Waiting for the consent callback...");
    return;
  }

  res.writeHead(200, { "content-type": "text/html" });
  res.end(
    "<html><body style='font-family:system-ui;padding:2rem'>" +
      "<h2>Consent captured.</h2><p>You can close this tab and return to the terminal.</p>" +
      "</body></html>"
  );
  server.close(() => void finish(code));
});

function finish(code) {
  client
    .getToken(code)
    .then((token) => {
      if (!token.tokens?.refresh_token) {
        console.error(
          "\nNo refresh_token in the response. Revoke the app grant at\n" +
            "https://myaccount.google.com/permissions and re-run (Google omits the\n" +
            "refresh token when a previous grant already exists)."
        );
        process.exit(1);
      }
      console.log(
        "\n=== GOOGLE_OAUTH_REFRESH_TOKEN (server-side only, never commit) ===\n" +
          token.tokens.refresh_token +
          "\n=== paste into .env and the Netlify environment ==="
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error("\nToken exchange failed:", err?.message ?? err);
      process.exit(1);
    });
}

server.listen(PORT, () => {
  const authUrl = client.generateAuthUrl({
    access_type: "offline", // required, else no refresh token is returned
    prompt: "consent", // force a fresh grant so a refresh token comes back
    scope: SCOPE,
  });
  console.log("Opening this URL in a browser (sign in as the sheet owner):\n");
  console.log(authUrl);
  console.log(`\nListening on ${redirectUri} for the callback...`);
});
