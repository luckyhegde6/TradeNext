#!/usr/bin/env node
/**
 * Spike Laya — ONNX weight downloader (P0)
 * Fetches prebuilt int8-quantized ONNX weights from HF `nvkudva/laya-web-q8`.
 * Real finding: model is SPLIT into encoder + head graphs (NOT one whole-model
 * graph) and graphs reference EXTERNAL data (.onnx.data siblings) — so we must
 * preserve the repo subdir layout and download .onnx + .onnx.data + tokenizer.
 * Plan 16 §F0 export gate: SKIPPED (prebuilt int8 exists).
 */
import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { basename } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HF_REPO = "nvkudva/laya-web-q8";
const HF_API = `https://huggingface.co/api/models/${HF_REPO}`;
const OUT_DIR = join(__dirname, "weights");

/** Discover files under the repo tree (flattened — recursive=true). */
async function listModelFiles() {
  const res = await fetch(`${HF_API}/tree/main?recursive=true`, { headers: { "User-Agent": "TradeNext-laya-spike" } });
  if (!res.ok) throw new Error(`HF tree failed: ${res.status} ${res.statusText}`);
  return await res.json();
}
async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

const IS_ARTIFACT = (path) => /\.onnx(\.data)?$/i.test(path) || /tokenizer/i.test(path);

async function main() {
  console.log(`[spike-laya] probing ${HF_REPO} tree…`);
  let files;
  try { files = await listModelFiles(); }
  catch (e) { console.error("[spike-laya] tree probe failed (network?).", e.message); process.exit(1); }

  const flat = (files || []).filter((it) => it.type === "file" && IS_ARTIFACT(it.path));
  if (flat.length === 0) { console.error("[spike-laya] no artifacts found — export would be required."); process.exit(1); }

  console.log(`[spike-laya] found ${flat.length} artifact(s). Downloading to ${OUT_DIR}…`);
  let totalMB = 0;
  for (const f of flat) {
    totalMB += f.size / 1048576;
    const dest = join(OUT_DIR, f.path); // preserve repo layout (ORT external-data needs sibling paths)
    if (await exists(dest)) { console.log(`  ✓ exists (skip): ${f.path}`); continue; }
    await mkdir(dirname(dest), { recursive: true });
    const url = `https://huggingface.co/${HF_REPO}/resolve/main/${f.path}`;
    console.log(`  ↓ ${f.path} (${(f.size / 1048576).toFixed(1)} MB)`);
    const r = await fetch(url, { headers: { "User-Agent": "TradeNext-laya-spike" } });
    if (!r.ok) throw new Error(`download failed: ${url} → ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    await writeFile(dest, buf);
    console.log(`  ✓ saved ${dest}`);
  }
  console.log(`[spike-laya] done. total artifacts: ${flat.length}, ~${totalMB.toFixed(1)} MB on disk.`);
}

main().catch((e) => { console.error(e); process.exit(1); });