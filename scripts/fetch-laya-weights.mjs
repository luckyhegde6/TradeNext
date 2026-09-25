#!/usr/bin/env node
/**
 * fetch-laya-weights — download the pinned Laya q8 ONNX checkpoint into the
 * runtime weights home (lib/services/laya/weights/, gitignored).
 *
 * Pins the exact v1 artifacts from HF `nvkudva/laya-web-q8` that the real
 * inference path (spec 18, P3) loads: encoder + head graphs (with external
 * `.onnx.data` siblings — ORT needs them next to the graphs), the tokenizer
 * files, and rl_agent_config.json (temperature tables). Only these names are
 * fetched; nothing else in the repo is allowed to grow this download.
 *
 * Usage:
 *   node scripts/fetch-laya-weights.mjs            # full download (skip-if-exists)
 *   node scripts/fetch-laya-weights.mjs --dry-run  # show what would download
 *   node scripts/fetch-laya-weights.mjs --to <dir> # custom target
 */
import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const HF_REPO = "nvkudva/laya-web-q8";
const SUBFOLDER = "v1";
const DEFAULT_OUT = join(__dirname, "..", "lib", "services", "laya", "weights");

/** Pinned artifact allowlist — do not add files without updating the runtime
 *  loader and the spec-18 P3 fixture list. */
const ARTIFACTS = [
  "encoder_q8.onnx",
  "encoder_q8.onnx.data",
  "head_q8.onnx",
  "head_q8.onnx.data",
  "tokenizer.json",
  "tokenizer_config.json",
  "rl_agent_config.json",
];

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

function parseArgs(argv) {
  const out = { outDir: DEFAULT_OUT, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dry-run") out.dryRun = true;
    else if (argv[i] === "--to" && argv[i + 1]) out.outDir = resolve(argv[++i]);
  }
  return out;
}

async function main() {
  const { outDir, dryRun } = parseArgs(process.argv.slice(2));
  console.log(`[fetch-laya-weights] repo ${HF_REPO}/${SUBFOLDER}${dryRun ? " (dry-run)" : ""} → ${outDir}`);

  let totalBytes = 0;
  for (const name of ARTIFACTS) {
    const path = `${SUBFOLDER}/${name}`;
    const dest = join(outDir, path); // preserve repo subfolder (ORT external-data siblings)
    totalBytes += await fetchOne(path, dest, dryRun);
  }
  console.log(`[fetch-laya-weights] done. ${ARTIFACTS.length} artifacts, ~${(totalBytes / 1048576).toFixed(1)} MB` +
    (dryRun ? " (dry-run: nothing written)" : ""));
}

async function fetchOne(path, dest, dryRun) {
  const url = `https://huggingface.co/${HF_REPO}/resolve/main/${path}`;
  if (dryRun) {
    console.log(`  would ↓ ${path} → ${dest}`);
    return 0;
  }
  if (await exists(dest)) {
    console.log(`  ✓ exists (skip): ${path}`);
    return 0;
  }
  await mkdir(dirname(dest), { recursive: true });
  const r = await fetch(url, { headers: { "User-Agent": "TradeNext-laya-spike" } });
  if (!r.ok) throw new Error(`download failed: ${url} → ${r.status} ${r.statusText}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await writeFile(dest, buf);
  console.log(`  ✓ ${path} (${(buf.length / 1048576).toFixed(1)} MB)`);
  return buf.length;
}

main().catch((e) => { console.error("[fetch-laya-weights] FAIL:", e.message); process.exit(1); });