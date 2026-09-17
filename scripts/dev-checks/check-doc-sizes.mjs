#!/usr/bin/env node
/**
 * check-doc-sizes.mjs — context-budget guard (v3.39.4).
 *
 * `.opencode/opencode.json` → `instructions` injects the FULL contents of every listed file
 * into EVERY request. A bloated injected set refills context immediately after each compaction
 * (compaction loop). This check fails when the injected set or any single injected file grows
 * past its budget.
 *
 * Budgets:
 *   - total injected set ............ <= 100 KB
 *   - any single injected file ...... <= 32 KB
 *
 * Usage:  node scripts/dev-checks/check-doc-sizes.mjs
 * Exit:   0 = within budget, 1 = over budget / config unreadable
 */
import { readFileSync, statSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TOTAL_BUDGET = 100 * 1024;
const FILE_BUDGET = 32 * 1024;

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

let config;
try {
  config = JSON.parse(readFileSync(resolve(ROOT, ".opencode/opencode.json"), "utf8"));
} catch (err) {
  console.error(`FAIL: cannot read/parse .opencode/opencode.json — ${err.message}`);
  process.exit(1);
}

const entries = Array.isArray(config.instructions) ? config.instructions : [];
if (entries.length === 0) {
  console.error("FAIL: no `instructions` array found in .opencode/opencode.json");
  process.exit(1);
}

let total = 0;
let over = 0;

console.log("Injected instruction files (per-request context cost):\n");

for (const entry of entries) {
  const file = resolve(ROOT, entry);
  if (!existsSync(file)) {
    console.log(`  ?  ${entry}  (NOT FOUND — check .opencode/opencode.json)`);
    over++;
    continue;
  }
  const size = statSync(file).size;
  total += size;
  const flag = size > FILE_BUDGET ? "OVER" : "ok  ";
  if (size > FILE_BUDGET) over++;
  console.log(`  ${flag} ${kb(size).padStart(9)}  ${entry}`);
}

console.log(`\n  TOTAL ${kb(total).padStart(9)}  (budget ${kb(TOTAL_BUDGET)})`);
if (total > TOTAL_BUDGET) over++;

if (over > 0) {
  console.error(
    `\nFAIL: ${over} over budget. Keep injected files as thin INDEXES — move detail to\n` +
      "`.agents/changelog/`, `.agents/session-archive/`, or `.agents/docs/` and link from `.agents/INDEX.md`."
  );
  process.exit(1);
}

console.log("\nOK: injected context is within budget.");
