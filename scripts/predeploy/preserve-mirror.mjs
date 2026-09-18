#!/usr/bin/env node
// scripts/predeploy/preserve-mirror.mjs
//
// Predeploy mirror-preservation guard (v3.40.3, spec 14, §4D).
//
// Runs as the FIRST step of the Netlify production build command and asks the
// currently-live instance to: snapshot the SQLite mirror (disk + canonical
// Blobs), write a versioned point-in-time Blobs backup, and drain the
// SQLite→Prisma outbox when the plan-limit breaker is closed (or preserve it
// as the backup when Prisma is on hold).
//
// Contract:
//   - Production-only: `CONTEXT === "production"`, or `--force` for local runs.
//   - Pure Node 20 (global fetch + AbortSignal.timeout) — zero new deps.
//   - SOFT by design: always exits 0. A guard problem must NEVER wedge a deploy.
//   - Never logs the token; never logs live NSE data.

const FORCE = process.argv.includes("--force");

if (process.env.CONTEXT !== "production" && !FORCE) {
  console.log(
    `predeploy:preserve — skipped (CONTEXT="${process.env.CONTEXT ?? "(unset)"}" is not production; use --force to run locally)`,
  );
  process.exit(0);
}

const token = process.env.DEPLOY_GUARD_TOKEN;
if (!token) {
  console.warn("⚠️ predeploy:preserve — DEPLOY_GUARD_TOKEN is not set; skipping preservation (deploy will NOT be blocked)");
  process.exit(0);
}

// Target the instance being replaced: the deploy's own prime URL first.
const base =
  process.env.DEPLOY_PRIME_URL ||
  process.env.URL ||
  process.env.NEXT_PUBLIC_BASE_URL ||
  "https://tradenext6.netlify.app";
const endpoint = `${base.replace(/\/+$/, "")}/api/admin/predeploy/preserve`;

let res;
try {
  res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-deploy-guard-token": token,
    },
    signal: AbortSignal.timeout(20_000),
  });
} catch (err) {
  console.warn(
    `⚠️ predeploy:preserve — request to ${endpoint} failed (${err instanceof Error ? err.message : String(err)}); deploy continues`,
  );
  process.exit(0);
}

let body = null;
try {
  body = await res.json();
} catch {
  // Non-JSON (proxy/maintenance page) — treated as a soft failure below.
}

if (!res.ok || !body || body.success !== true) {
  const code = body?.error ?? res.statusText ?? res.status;
  console.warn(`⚠️ predeploy:preserve — endpoint responded ${res.status} (${code}); deploy continues`);
  process.exit(0);
}

const { mode, pendingBefore, pushed, synced, failed, backupKey, pruned } = body;
const pending = Object.entries(pendingBefore ?? {}).reduce(
  (n, [, v]) => n + (v?.pending ?? 0),
  0,
);
console.log(
  `predeploy:preserve — mode=${mode ?? "unknown"} pending=${pending} pushed=${pushed ?? false} synced=${synced ?? 0} failed=${failed ?? 0} backup=${backupKey ?? "none"} pruned=${(pruned ?? []).length}`,
);
process.exit(0);