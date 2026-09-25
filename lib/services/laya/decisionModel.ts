/**
 * Laya ONNX backbone (spec 18, P3 — plan step 14).
 *
 * Two chained `InferenceSession`s mirroring the spike's VERIFIED IO contract
 * (`scripts/spike-laya/smoke.mjs` + `smoke-results.json`):
 *
 *   encoder  input_ids i64[1,L]  → hidden f32[1,L,d]   (d = 1024 for v1)
 *            attention_mask i64[1,L]
 *   head     hidden (as-is), attention_mask i64[1,L], marker_pos i64[1,K],
 *            marker_mask bool[1,K], qtype i64[1]
 *            → logits f32[1,K]  (+ act_logits when the runtime emits it)
 *
 * Parity notes under the D2 self-consistency gate:
 *  - The head graph emits BOTH `logits` and `act_logits` for choice questions
 *    (verified against the real runtime by `scripts/dev-checks/laya-forward.ts`).
 *    The P3 spike recorded `actLogitsDims: null` for qtype=0 only because
 *    `smoke.mjs` looked up the output by the camelCase key `headOut.actLogits`
 *    while the graph names it snake_case `act_logits` (`logits` matched by
 *    coincidence). We read outputs by their graph names and keep the read
 *    defensive — an absent `act_logits` surfaces as `null`, never fabricated,
 *    never fatal (covers graphs that legitimately omit it).
 *  - K is clamped to >= 2 per upstream `topk` semantics: a degenerate
 *    single-criterion question pads to 2 marker slots, slot 1 getting
 *    `marker_mask=false` so the model's masked_fill ignores it (same path as
 *    `common.py`). A `CollatedBatch` with kmax=1 is re-laid-out to 2.
 *  - All tensors are int64/bool exactly as the spike fed them (BigInt64Array /
 *    Uint8Array) — no int32 shortcuts, so shapes are bit-identical.
 *
 * Deps: onnxruntime-node is imported DYNAMICALLY inside `load()` (D6) so the
 * barrel stays dep-free and Next.js build graph / SSG is untouched; only the
 * type-only import is static (fully erased at emit).
 */

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { InferenceSession, Tensor } from "onnxruntime-node";

import { layaWeightsDir } from "./tokenizer";
import type { CollatedBatch } from "./collate";

/** Runtime shape of the dynamically imported onnxruntime-node module. */
type OrtModule = typeof import("onnxruntime-node");

export const LAYA_ENCODER_ONNX = "encoder_q8.onnx";
export const LAYA_HEAD_ONNX = "head_q8.onnx";
/** v1 checkpoint record (sd: 802, hidden 1024) — asserted by the test. */
export const LAYA_HIDDEN_DIM = 1024;

export interface LayaForwardResult {
  /** logits flattened row-major: length = rows * slots (slots = effective K). */
  logits: Float32Array;
  /** [rows, A] flattened, or null when the graph/run omitted act_logits. */
  actLogits: Float32Array | null;
  /** effective marker slots (K after the >=2 clamp). */
  slots: number;
  rows: number;
  /** sequence length L (head attention_mask dim). */
  seq: number;
  hiddenDim: number;
  /** wall-clock for the chained forward only (both sessions). */
  latencyMs: number;
}

export interface LayaModelHealth {
  loaded: boolean;
  encoderFile: string;
  headFile: string;
  encoderBytes: number;
  headBytes: number;
  hiddenDim: number;
  loadMs: number;
  forwards: number;
  lastForwardMs: number | null;
}

function i64Tensor(ort: OrtModule, values: number[] | bigint[], shape: number[]): Tensor {
  const data = values.map((v) => BigInt(v));
  return new ort.Tensor("int64", BigInt64Array.from(data), shape);
}

function boolTensor(ort: OrtModule, values: boolean[], shape: number[]): Tensor {
  return new ort.Tensor("bool", Uint8Array.from(values.map((v) => (v ? 1 : 0))), shape);
}

/** Two sessions + probe-verified hidden dim; created once per `load()`. */
export class LayaDecisionModel {
  private readonly ort: OrtModule;
  private readonly encoder: InferenceSession;
  private readonly head: InferenceSession;
  private readonly hiddenDim: number;
  private readonly loadMs: number;
  private readonly encoderBytes: number;
  private readonly headBytes: number;
  private forwards = 0;
  private lastForwardMs: number | null = null;

  private constructor(
    ort: OrtModule,
    encoder: InferenceSession,
    head: InferenceSession,
    hiddenDim: number,
    loadMs: number,
    encoderBytes: number,
    headBytes: number,
  ) {
    this.ort = ort;
    this.encoder = encoder;
    this.head = head;
    this.hiddenDim = hiddenDim;
    this.loadMs = loadMs;
    this.encoderBytes = encoderBytes;
    this.headBytes = headBytes;
  }

  static async load(dir: string = layaWeightsDir()): Promise<LayaDecisionModel> {
    const ort = await import("onnxruntime-node");
    const encoderPath = join(dir, LAYA_ENCODER_ONNX);
    const headPath = join(dir, LAYA_HEAD_ONNX);

    const t0 = performance.now();
    // Probe the encoder with a trivial [1,2] row to (a) fail fast on a corrupt
    // checkpoint and (b) capture the real hidden dim for health/ping.
    const probe = await ort.InferenceSession.create(encoderPath, { executionMode: "sequential" });
    const probeOut = await probe.run({
      input_ids: i64Tensor(ort, [1, 2], [1, 2]),
      attention_mask: i64Tensor(ort, [1, 1], [1, 2]),
    });
    const hidden = probeOut.hidden as Tensor | undefined;
    const dims = hidden?.dims ?? [];
    if (!hidden || dims.length !== 3) {
      throw new Error(
        `laya decision model: encoder probe produced unexpected output (dims=${JSON.stringify(dims)})`,
      );
    }
    const hiddenDim = dims[2];

    const head = await ort.InferenceSession.create(headPath, { executionMode: "sequential" });
    const loadMs = performance.now() - t0;

    const encoderBytes = statSync(encoderPath).size;
    const headBytes = statSync(headPath).size;

    return new LayaDecisionModel(ort, probe, head, hiddenDim, loadMs, encoderBytes, headBytes);
  }

  /**
   * Run the chained encoder → head forward for a collated batch.
   * `markerPos`/`markerMask` rows shorter than 2 are re-laid-out to 2 slots
   * (K>=2 pad), the masked slot getting `marker_mask=false`.
   */
  async forward(batch: CollatedBatch): Promise<LayaForwardResult> {
    const rows = batch.inputIds.length;
    if (rows === 0) throw new Error("laya decision model: empty batch");
    const seq = batch.inputIds[0].length;

    let kmax = 0;
    for (const row of batch.markerPos) {
      if (row.length > kmax) kmax = row.length;
    }
    const slots = Math.max(kmax, 2);

    const markerPos = batch.markerPos.map((row) =>
      row.length >= slots
        ? Array.from(row)
        : [...Array.from(row), ...new Array<number>(slots - row.length).fill(0)],
    );
    const markerMask = batch.markerMask.map((row) =>
      row.length >= slots ? Array.from(row) : [...Array.from(row), ...new Array<boolean>(slots - row.length).fill(false)],
    );

    const t0 = performance.now();
    const encOut = await this.encoder.run({
      input_ids: i64Tensor(this.ort, batch.inputIds.flat(), [rows, seq]),
      attention_mask: i64Tensor(this.ort, batch.attentionMask.flat(), [rows, seq]),
    });
    const hidden = encOut.hidden as Tensor;

    const headOut = await this.head.run({
      hidden,
      attention_mask: i64Tensor(this.ort, batch.attentionMask.flat(), [rows, seq]),
      marker_pos: i64Tensor(this.ort, markerPos.flat(), [rows, slots]),
      marker_mask: boolTensor(this.ort, markerMask.flat(), [rows, slots]),
      qtype: i64Tensor(this.ort, batch.qtype, [rows]),
    });
    const latencyMs = performance.now() - t0;

    const logitsTensor = headOut.logits as Tensor | undefined;
    if (!logitsTensor) throw new Error("laya decision model: head returned no logits");
    const logits = Float32Array.from(logitsTensor.data as ArrayLike<number>);

    const actTensor = (headOut.act_logits as Tensor | undefined) ?? null;
    const actLogits = actTensor ? Float32Array.from(actTensor.data as ArrayLike<number>) : null;

    this.forwards += 1;
    this.lastForwardMs = latencyMs;

    return {
      logits,
      actLogits,
      slots,
      rows,
      seq,
      hiddenDim: this.hiddenDim,
      latencyMs,
    };
  }

  health(): LayaModelHealth {
    return {
      loaded: true,
      encoderFile: LAYA_ENCODER_ONNX,
      headFile: LAYA_HEAD_ONNX,
      encoderBytes: this.encoderBytes,
      headBytes: this.headBytes,
      hiddenDim: this.hiddenDim,
      loadMs: this.loadMs,
      forwards: this.forwards,
      lastForwardMs: this.lastForwardMs,
    };
  }
}

/** True when both ONNX checkpoints exist in dir (CI has none → tests skip, D5). */
export function layaModelAvailable(dir: string = layaWeightsDir()): boolean {
  return existsSync(join(dir, LAYA_ENCODER_ONNX)) && existsSync(join(dir, LAYA_HEAD_ONNX));
}

let singleton: Promise<LayaDecisionModel> | null = null;

/**
 * Lazy singleton (analogue of `getLayaTokenizer`): a failed load clears the
 * promise so a retry re-attempts rather than poisoning the process.
 */
export function getLayaDecisionModel(dir: string = layaWeightsDir()): Promise<LayaDecisionModel> {
  if (!singleton) {
    singleton = LayaDecisionModel.load(dir).catch((err) => {
      singleton = null;
      throw err;
    });
  }
  return singleton;
}