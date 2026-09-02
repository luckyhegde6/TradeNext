// scripts/copy-sql-wasm.mjs
//
// Copies the sql.js WASM binary into `public/` so it is part of the deployable
// artifact. sql.js is kept in `serverExternalPackages` (next.config.ts) so it is
// NOT webpack-bundled into `.next` — on Netlify's runtime the raw
// `node_modules/sql.js/dist/sql-wasm.wasm` is NOT present, so `initSqlJs`
// (via `lib/sqlite.ts` `resolveSqlWasm()`) must locate the binary in
// `process.cwd()/public/sql-wasm.wasm`.
//
// Cross-platform (Windows local + Linux Netlify). Non-fatal: if the source WASM
// is missing (e.g. already bundled elsewhere), log a warning and exit 0.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "node_modules", "sql.js", "dist", "sql-wasm.wasm");
const dest = path.join(root, "public", "sql-wasm.wasm");

if (!existsSync(src)) {
  console.warn("[copy-sql-wasm] source not found (already bundled elsewhere?): " + src);
  process.exit(0);
}

mkdirSync(path.dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log("[copy-sql-wasm] copied " + src + " -> " + dest);