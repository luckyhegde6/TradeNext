#!/usr/bin/env node
/**
 * check-doc-sizes.mjs — context-budget guard (v3.39.4; extended v3.40.0 / W7).
 *
 * `.opencode/opencode.json` → `instructions` injects the FULL contents of every listed file
 * into EVERY request. A bloated injected set refills context immediately after each compaction
 * (compaction loop). This check fails when the injected set or any single injected file grows
 * past its budget, and warns when the `.context/out/` tool-output scratch dir outgrows retention.
 *
 * Budgets:
 *   - total injected set ....... <= 100 KB
 *   - any single injected file . <= 32 KB
 *   - .context/out scratch dir . warn above 5 MB (advisory — never fails the gate)
 *
 * Usage:  node scripts/dev-checks/check-doc-sizes.mjs [--json]
 * Exit:   0 = within budget, 1 = over budget / config unreadable
 */
import { readFileSync, statSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TOTAL_BUDGET = 100 * 1024;
const FILE_BUDGET = 32 * 1024;
const SCRATCH_DIR = ".context/out";
const SCRATCH_WARN_BYTES = 5 * 1024 * 1024;

const asJson = process.argv.includes("--json");
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

/** Recursive byte size of a directory (0 when the directory is absent). */
function dirBytes(dir) {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, item.name);
    total += item.isDirectory() ? dirBytes(p) : statSync(p).size;
  }
  return total;
}

/** Returns { ok, total, totalBudget, fileBudget, files: [{ path, bytes, ok }] }. */
function checkInjectedBudget() {
  const entries = Array.isArray(config.instructions) ? config.instructions : [];
  const files = [];
  let total = 0;

  for (const entry of entries) {
    const file = resolve(ROOT, entry);
    if (!existsSync(file)) {
      files.push({ path: entry, bytes: 0, ok: false, missing: true });
      continue;
    }
    const bytes = statSync(file).size;
    total += bytes;
    files.push({ path: entry, bytes, ok: bytes <= FILE_BUDGET });
  }

  const ok = total <= TOTAL_BUDGET && files.every((f) => f.ok);
  return { ok, total, totalBudget: TOTAL_BUDGET, fileBudget: FILE_BUDGET, files };
}

let config;
try {
  config = JSON.parse(readFileSync(resolve(ROOT, ".opencode/opencode.json"), "utf8"));
} catch (err) {
  const message = `FAIL: cannot read/parse .opencode/opencode.json — ${err.message}`;
  if (asJson) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  console.error(message);
  process.exit(1);
}

const budget = checkInjectedBudget();
const scratchBytes = dirBytes(resolve(ROOT, SCRATCH_DIR));
const scratch = {
  path: SCRATCH_DIR,
  bytes: scratchBytes,
  threshold: SCRATCH_WARN_BYTES,
  withinThreshold: scratchBytes <= SCRATCH_WARN_BYTES,
};

if (budget.files.length === 0) {
  const message = "FAIL: no `instructions` array found in .opencode/opencode.json";
  if (asJson) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  console.error(message);
  process.exit(1);
}

if (asJson) {
  console.log(JSON.stringify({ ...budget, scratch }, null, 2));
} else {
  console.log("Injected instruction files (per-request context cost):\n");
  for (const f of budget.files) {
    if (f.missing) {
      console.log(`  ?  ${f.path}  (NOT FOUND — check .opencode/opencode.json)`);
      continue;
    }
    console.log(`  ${f.ok ? "ok  " : "OVER"} ${kb(f.bytes).padStart(9)}  ${f.path}`);
  }
  console.log(`\n  TOTAL ${kb(budget.total).padStart(9)}  (budget ${kb(TOTAL_BUDGET)})`);

  if (!scratch.withinThreshold) {
    console.log(
      `\n  WARN: ${SCRATCH_DIR} is ${kb(scratchBytes)} (retention threshold ${kb(SCRATCH_WARN_BYTES)}).\n` +
        "        Tool-output scratch is disposable — delete stale captures."
    );
  }
}

if (!budget.ok) {
  console.error(
    "\nFAIL: injected context over budget. Keep injected files as thin INDEXES — move detail to\n" +
      "`.agents/changelog/`, `.agents/session-archive/`, or `.agents/docs/` and link from `.agents/INDEX.md`."
  );
  process.exit(1);
}

if (!asJson) console.log("\nOK: injected context is within budget.");
