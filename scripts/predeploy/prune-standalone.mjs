#!/usr/bin/env node
// scripts/predeploy/prune-standalone.mjs
//
// Runs at the END of the Netlify production build command (after quickbuild),
// before the @netlify/plugin-nextjs onPostBuild copy and function zipping.
// Deletes heavy non-runtime artifacts from .next so the function bundles
// uploaded to Netlify stay under the 250MB upload limit (deploy fix).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const removed = [];

function rm(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
    removed.push(p);
  } catch {
    /* non-fatal */
  }
}

function walk(d, out = []) {
  let es;
  try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return out; }
  for (const e of es) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// Turbopack build cache (~260MB inside the standalone tree) — not needed at runtime.
rm(path.join(root, ".next", "cache", "turbopack"));
// Worker engine logs shipped into the standalone tree.
rm(path.join(root, ".next", "standalone", "worker_logs"));
// Source maps — not served at runtime, and the two biggest non-runtime files.
for (const f of walk(path.join(root, ".next"))) {
  if (f.endsWith(".js.map")) rm(f);
}

console.log(`prune-standalone: removed ${removed.length} path(s) under .next`);
