// scripts/copy-sql-wasm-netlify.mjs
//
// Post-build copy for Netlify: Netlify's publish dir is `.next` (netlify.toml),
// so the sql.js WASM must live inside the published artifact for the Node
// runtime to read it at `process.cwd()/.next/sql-wasm.wasm`. This copies the
// `public/sql-wasm.wasm` (created by copy-sql-wasm.mjs) into the `.next` root.
//
// Run AFTER `next build`. Non-fatal if the source is missing.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "public", "sql-wasm.wasm");
const dest = path.join(root, ".next", "sql-wasm.wasm");

if (!existsSync(src)) {
  console.warn("[copy-sql-wasm-netlify] source not found: " + src);
  process.exit(0);
}
mkdirSync(path.dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log("[copy-sql-wasm-netlify] copied " + src + " -> " + dest);