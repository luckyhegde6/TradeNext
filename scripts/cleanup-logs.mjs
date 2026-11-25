#!/usr/bin/env node
// scripts/cleanup-logs.mjs — clear stale logs/, keep the last 15 days and cap
// the logs/ directory at ~50 MB (oldest deleted first). Run manually:
//   node scripts/cleanup-logs.mjs [dir]
import fs from "node:fs";
import path from "node:path";

const ROOT = process.argv[2] ?? path.join(process.cwd(), "logs");
const MAX_AGE_DAYS = 15;
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

function walk(dir, out = []) {
  let ds;
  try { ds = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ds) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else {
      try { const st = fs.statSync(p); out.push({ p, s: st.size, mtime: st.mtimeMs }); } catch {}
    }
  }
  return out;
}

const files = walk(ROOT);
const fifteenDaysAgo = Date.now() - MAX_AGE_DAYS * 24 * 3600 * 1000;
const keep = files.filter((f) => f.mtime >= fifteenDaysAgo);
const del = files.filter((f) => f.mtime < fifteenDaysAgo);

let removed = 0;
for (const f of del) { try { fs.unlinkSync(f.p); removed += f.s; } catch {} }

const remaining = keep.sort((a, b) => a.mtime - b.mtime);
let total = remaining.reduce((s, f) => s + f.s, 0);
for (const f of remaining) {
  if (total <= MAX_BYTES) break;
  try { fs.unlinkSync(f.p); total -= f.s; removed += f.s; } catch {}
}

const mb = (n) => (n / 1048576).toFixed(1);
console.log(`cleanup-logs: removed ${mb(removed)} MB · remaining ${mb(total)} MB in ${ROOT}`);
