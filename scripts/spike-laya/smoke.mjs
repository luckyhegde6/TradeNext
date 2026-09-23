#!/usr/bin/env node
/**
 * Spike Laya — onnxruntime-node smoke (P0, spike-laya)
 * Loads BOTH int8 graphs (encoder + decision head — prebuilt repo is SPLIT, not
 * one whole-model graph as plan §F0 assumed), then runs the TRUE chained
 * pipeline: encoder forward (input_ids/attention_mask → hidden) → head forward
 * (hidden + markers → logits/act_logits). Measures load RSS + per-decision latency.
 * Parity is P2 — this measures runtime FEASIBILITY + RSS + latency only.
 * Output: smoke-results.json → feeds VERDICT.md.
 */
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import * as ort from "onnxruntime-node";

const OUT_DIR = join(process.cwd(), "weights", "v1");
const SEQ = 128; // shortest practical decision horizon

async function loadSession(file, out) {
  const modelPath = join(OUT_DIR, file);
  const { size } = await stat(modelPath);
  const t0 = performance.now();
  const session = await ort.InferenceSession.create(modelPath, { executionMode: "sequential" });
  out.session = session;
  out.sizeMB = +(size / 1048576).toFixed(1);
  out.loadMs = +(performance.now() - t0).toFixed(1);
  out.io = { inputs: session.inputNames, outputs: session.outputNames };
}

function i64(len, fill = 1n) { return new ort.Tensor("int64", new BigInt64Array(len).fill(fill), [1, len]); }
function i64_1d(len, fill = 0n) { return new ort.Tensor("int64", new BigInt64Array(len).fill(fill), [len]); }
function bool01(len) { const a = new Uint8Array(len).fill(1); return new ort.Tensor("bool", a, [1, len]); }
function f32(len, fill = 0) { return new ort.Tensor("float32", new Float32Array(len).fill(fill), [1, len]); }

async function main() {
  const results = { date: new Date().toISOString(), node: process.version, seq: SEQ };
  results.rssBeforeMB = +(process.memoryUsage().rss / 1048576).toFixed(1);

  // 1) Encoder: input_ids + attention_mask -> hidden
  const enc = {};
  await loadSession("encoder_q8.onnx", enc);
  const encT0 = performance.now();
  const encOut = await enc.session.run({ input_ids: i64(SEQ, 1n), attention_mask: i64(SEQ, 1n) });
  const encMs = performance.now() - encT0;
  const hidden = encOut.hidden; // tensor(float) [1, seq, d]
  const d = hidden.dims[2];
  const S = hidden.dims[1];
  enc.forwardMs = +encMs.toFixed(1);
  enc.hiddenDim = d;
  results.encoder = { sizeMB: enc.sizeMB, loadMs: enc.loadMs, io: enc.io, forwardMs: enc.forwardMs, hiddenDim: d, rssAfterMB: +(process.memoryUsage().rss / 1048576).toFixed(1) };

  // 2) Head: hidden (encoder output) + decision markers -> logits/act_logits
  const head = {};
  await loadSession("head_q8.onnx", head);
  const headT0 = performance.now();
  const headOut = await head.session.run({
    hidden,                                        // chained from encoder
    attention_mask: i64(S, 1n),
    marker_pos: i64(2, 0n),                        // decision anchors at token 0,1
    marker_mask: bool01(2),
    qtype: i64_1d(1, 0n),                             // decision query type
  });
  const headMs = performance.now() - headT0;
  head.logits = headOut.logits ? headOut.logits.dims : null;
  head.actLogits = headOut.actLogits ? headOut.actLogits.dims : null;
  head.forwardMs = +headMs.toFixed(1);
  results.head = { sizeMB: head.sizeMB, loadMs: head.loadMs, io: head.io, forwardMs: head.forwardMs, logitsDims: head.logits, actLogitsDims: head.actLogits, rssAfterMB: +(process.memoryUsage().rss / 1048576).toFixed(1) };

  // 3) Full-decision latency: repeat full chain 3x for median
  const chain = [];
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    const encOut2 = await enc.session.run({ input_ids: i64(SEQ, 1n), attention_mask: i64(SEQ, 1n) });
    await head.session.run({ hidden: encOut2.hidden, attention_mask: i64(S, 1n), marker_pos: i64(2, 0n), marker_mask: bool01(2), qtype: i64_1d(1, 0n) });
    chain.push(+(performance.now() - t).toFixed(1));
  }
  results.fullDecisionMs = chain;
  results.rssFinalMB = +(process.memoryUsage().rss / 1048576).toFixed(1);

  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(process.cwd(), "smoke-results.json"), JSON.stringify(results, null, 2));
  console.log(`[spike-laya] encoder fwd ${enc.forwardMs}ms (hidden d=${d}), head fwd ${head.forwardMs}ms, chain median ${[...chain].sort((a,b)=>a-b)[1]}ms, RSS ${results.rssBeforeMB}→${results.rssFinalMB}MB`);
}

main().catch((e) => { console.error("[spike-laya] FAIL:", e.stack || e.message); process.exit(1); });