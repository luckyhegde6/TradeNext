#!/usr/bin/env node
// scripts/dev-checks/check-function-size.mjs
//
// Fail if any Netlify function artifact exceeds Netlify's 250MB upload limit.
// Run AFTER `npx netlify build` (which zips functions into .netlify/functions).
// Limit: 250 MB = 250 * 1024 * 1024 bytes (zipped artifact size, what Netlify measures).
import fs from "node:fs";
import path from "node:path";

const LIMIT_BYTES = 250 * 1024 * 1024; // 250MB
const DIRS = [".netlify/functions", ".netlify/functions-internal"];

const cwd = process.cwd();
let checked = 0;
let failed = 0;

for (const dir of DIRS) {
  const abs = path.resolve(cwd, dir);
  let entries = [];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    continue;
  }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".zip")) continue;
    const p = path.join(abs, e.name);
    const size = fs.statSync(p).size;
    checked++;
    const mb = (size / 1048576).toFixed(2);
    if (size > LIMIT_BYTES) {
      console.error(`FAIL: ${dir}/${e.name} = ${mb} MB (exceeds 250 MB Netlify limit)`);
      failed++;
    } else {
      console.log(`ok:   ${dir}/${e.name} = ${mb} MB`);
    }
  }
}

if (checked === 0) {
  console.error("no function zips found — did `npx netlify build` run successfully?");
  process.exit(1);
}

if (failed > 0) {
  console.error(`\n${failed} function(s) exceed the 250 MB Netlify upload limit.`);
  process.exit(1);
}

console.log(`\nAll ${checked} function(s) are under the 250 MB Netlify upload limit.`);
