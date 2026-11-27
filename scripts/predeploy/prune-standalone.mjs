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

// Windows/Turbopack + Netlify edge-runtime bug: generated `[turbopack]_runtime.js`
// computes `RUNTIME_ROOT = path.resolve(__filename, relativePathToRuntimeRoot)`.
// On Windows inside the edge sandbox `relativePathToRuntimeRoot` resolves to ''
// and `path.resolve(<runtime-file>, ...)` appends `server/chunks/<X>` to the
// FILE path, so `require(.../chunks/[turbopack]_runtime.js/server/chunks/X)`
// fails. Root RUNTIME_ROOT at the chunks dir + up two (…/server/.next).
let patched = 0;
for (const f of walk(path.join(root, ".next"))) {
  if (!f.endsWith("[turbopack]_runtime.js")) continue;
  try {
    const src = fs.readFileSync(f, "utf8");
    const next = src.replace(
      /const RUNTIME_ROOT = path\.resolve\(__filename, relativePathToRuntimeRoot\);/,
      'const RUNTIME_ROOT = path.resolve(path.dirname(__filename), "..", "..");',
    );
    if (next !== src) {
      fs.writeFileSync(f, next);
      patched++;
    }
  } catch {
    /* non-fatal */
  }
}

console.log(`prune-standalone: removed ${removed.length} path(s) under .next · patched ${patched} [turbopack]_runtime.js`);

// node_modules is NOT committed — re-apply the local @netlify/plugin-nextjs
// patches (fresh `npm ci` on Netlify/GitHub would otherwise lose them):
//   - content/server.js: standalone-copy filter excludes logs/worker_logs/cache/
//     docs/tests/mocks + all `*.js.map`, so function bundles stay under 250MB.
//   - edge-runtime/lib/cjs.ts: Windows/Turbopack chunk resolution.
const PLUGIN = path.join(root, "node_modules", "@netlify", "plugin-nextjs");

// 1) standalone-copy filter in copyNextDependencies (content/server.js)
try {
  const serverFile = path.join(PLUGIN, "dist", "build", "content", "server.js");
  let src = fs.readFileSync(serverFile, "utf8");
  if (!src.includes("excludedSegs")) {
    const anchor = "if (posixSourcePath === dotNextDir) {\n          return false;\n        }";
    const insert = `
        // Deploy fix: exclude non-production folders + source maps from function bundles.
        const excludedSegs = ["logs", "worker_logs", "sample", "samples", "graphify-out", "mocks", "__mocks__", "docs", "tests", "__tests__", "e2e", "cache", ".opencode", ".continue", ".archify", ".claude"];
        if (excludedSegs.some((seg) => posixSourcePath.split("/").includes(seg))) {
          return false;
        }
        if (posixSourcePath.endsWith(".js.map")) {
          return false;
        }`;
    if (src.includes(anchor)) {
      src = src.replace(anchor, anchor + insert);
      fs.writeFileSync(serverFile, src);
      console.log(`patched: ${serverFile}`);
    }
  }
} catch {
  /* non-fatal */
}

// 2) Windows/Turbopack chunk matching in edge-runtime/lib/cjs.ts
try {
  const cjsFile = path.join(PLUGIN, "edge-runtime", "lib", "cjs.ts");
  let src = fs.readFileSync(cjsFile, "utf8");
  if (!src.includes("lastSeg")) {
    const anchor = "const normTarget = norm(target).replace(/\\\\/g, '/');";
    const insert = `
        // Windows/Turbopack: broken RUNTIME_ROOT appends request to runtime
        // FILE; match a registered key by last path segment.
        const lastSeg = normTarget.split('/').pop() ?? '';`;
    if (src.includes(anchor)) {
      src = src.replace(anchor, anchor + insert);
      // extend the matching condition
      src = src.replace(
        /if \(\n(\s*)normTarget\.includes\(normKey\) \|\|\n\s*normKey\.includes\(normTarget\) \|\|\n\s*normTarget\.includes\(normKey\) \|\| normKey\.includes\(normTarget\)\n/,
        (m, ind) => m + `${ind}  (lastSeg.length > 0 && (normKey === lastSeg || normKey.endsWith('/' + lastSeg))) ||\n`,
      );
      src = src.replace(
        "if (normTarget.includes(normKey) || normKey.includes(normTarget)) {",
        "if (normTarget.includes(normKey) || normKey.includes(normTarget) || (lastSeg.length > 0 && (normKey === lastSeg || normKey.endsWith('/' + lastSeg)))) {",
      );
      fs.writeFileSync(cjsFile, src);
      console.log(`patched: ${cjsFile}`);
    }
  }
} catch {
  /* non-fatal */
}
