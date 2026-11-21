// scripts/copy-sql-wasm-netlify.mjs
//
// Post-build copy for Netlify: Netlify's publish dir is `.next` (netlify.toml),
// so the sql.js WASM must live inside the published artifact for the Node
// runtime to read it at `process.cwd()/.next/sql-wasm.wasm`. This copies the
// `public/sql-wasm.wasm` (created by copy-sql-wasm.mjs) into the `.next` root.
//
// Also applies a Netlify/Next NFT bundling workaround: if the standalone output
// contains a traced semver package missing `preload.js`, create the shim so
// @vercel/nft / Netlify Functions bundling does not fail.
//
// Run AFTER `next build`. Non-fatal if sources/targets are missing.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "public", "sql-wasm.wasm");
const dest = path.join(root, ".next", "sql-wasm.wasm");

if (!existsSync(src)) {
  console.warn("[copy-sql-wasm-netlify] source not found: " + src);
} else {
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log("[copy-sql-wasm-netlify] copied " + src + " -> " + dest);
}

function ensureSemverPreloadShim(dir) {
  const preload = path.join(dir, "preload.js");
  const indexJs = path.join(dir, "index.js");
  if (existsSync(preload)) return false;
  if (!existsSync(indexJs)) return false;
  writeFileSync(preload, "'use strict'\n\n// XXX remove in v8 or beyond\nmodule.exports = require('./index.js')\n", "utf8");
  console.log("[copy-sql-wasm-netlify] created semver preload shim: " + preload);
  return true;
}

function walkForSemverDirs(baseDir, out = []) {
  if (!existsSync(baseDir)) return out;
  let entries;
  try {
    entries = readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(baseDir, entry.name);
    if (entry.name === "semver") {
      out.push(full);
      continue;
    }
    // prune obvious non-targets a bit, but keep node_modules traversal
    if (entry.name === ".git") continue;
    walkForSemverDirs(full, out);
  }
  return out;
}

function patchStandaloneSemverPreload() {
  const standaloneRoot = path.join(root, ".next", "standalone");
  if (!existsSync(standaloneRoot)) {
    console.log("[copy-sql-wasm-netlify] no .next/standalone directory; skipping semver shim");
    return;
  }
  const semverDirs = walkForSemverDirs(standaloneRoot);
  let created = 0;
  for (const dir of semverDirs) {
    try {
      if (ensureSemverPreloadShim(dir)) created++;
    } catch (e) {
      console.warn("[copy-sql-wasm-netlify] failed to shim " + dir + ": " + (e && e.message ? e.message : String(e)));
    }
  }
  console.log("[copy-sql-wasm-netlify] semver shim check complete (dirs=" + semverDirs.length + ", created=" + created + ")");
}

try {
  patchStandaloneSemverPreload();
} catch (e) {
  console.warn("[copy-sql-wasm-netlify] semver shim step failed: " + (e && e.message ? e.message : String(e)));
}