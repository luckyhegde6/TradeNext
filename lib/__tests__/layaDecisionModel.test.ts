/**
 * Laya ONNX backbone tests (spec 18, plan step 15) — weights-gated per D5:
 * CI has no checkpoints → suite skips.
 *
 * The forward itself runs in a CHILD Node process (`scripts/dev-checks/
 * laya-forward.ts`): onnxruntime-node's outputs are created in Node's main
 * realm, which fails ort's `instanceof Float32Array` guard under Jest's vm
 * sandbox (see the helper's docblock). The child inherits the repo weights and
 * emits the spike-matching IO contract as JSON — determinism, int64/bool IO,
 * K>=2 pad, act_logits absent for qtype=0, hidden dim 1024, health stats —
 * which this suite asserts.
 *
 * @jest-environment node
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { LAYA_HIDDEN_DIM, layaModelAvailable } from "../services/laya/decisionModel";

const maybeDescribe = layaModelAvailable() ? describe : describe.skip;

interface ProbeOut {
  available: boolean;
  hiddenDim?: number;
  singletonSame?: boolean;
  contract?: {
    rows: number;
    seq: number;
    slots: number;
    logitsLen: number;
    latencyMs: number;
    actLogitsLen: number;
    logitsA: number[];
  };
  determinismEqual?: boolean;
  degenerate?: { slots: number; logitsLen: number; allFinite: boolean };
  scoreActLogitsNull?: boolean;
  health?: {
    loaded: boolean;
    encoderFile: string;
    headFile: string;
    encoderBytes: number;
    headBytes: number;
    hiddenDim: number;
    loadMs: number;
    forwards: number;
    lastForwardMs: number | null;
  };
}

maybeDescribe("laya decision model (weights, child-process forward)", () => {
  let probe: ProbeOut;

  beforeAll(() => {
    const script = join(process.cwd(), "scripts", "dev-checks", "laya-forward.ts");
    const raw = execFileSync(process.execPath, ["--import", "tsx", script], {
      encoding: "utf8",
      timeout: 120_000,
    });
    probe = JSON.parse(raw) as ProbeOut;
    if (!probe || probe.available !== true) {
      throw new Error(`laya-forward probe did not run: ${raw.slice(0, 200)}`);
    }
  });

  it("runs the chained forward with spike-matching IO dims", () => {
    const c = probe.contract;
    expect(c).toBeDefined();
    expect(c!.rows).toBe(1);
    expect(c!.seq).toBe(6);
    expect(c!.slots).toBe(2); // two markers
    expect(c!.logitsLen).toBe(2); // rows * slots
    expect(c!.latencyMs).toBeGreaterThan(0);
  });

  it("exposes the v1 hidden dim and real byte sizes", () => {
    expect(probe.hiddenDim).toBe(LAYA_HIDDEN_DIM);
    expect(probe.health?.encoderBytes).toBeGreaterThan(1_000_000);
    expect(probe.health?.headBytes).toBeGreaterThan(100_000);
  });

  it("is deterministic across repeated forwards", () => {
    expect(probe.determinismEqual).toBe(true);
    expect(probe.contract?.logitsA.length).toBe(2);
  });

  it("pads degenerate single-marker questions to K>=2 with a masked slot", () => {
    expect(probe.degenerate?.slots).toBe(2);
    expect(probe.degenerate?.logitsLen).toBe(2);
    expect(probe.degenerate?.allFinite).toBe(true);
  });

  it("returns act_logits for qtype=0 (spike's null was a camelCase key bug)", () => {
    // smoke-results.json recorded `actLogitsDims: null`, but smoke.mjs read
    // `headOut.actLogits` while the graph output is snake_case `act_logits`
    // (`logits` matched only because it has no underscore). The real runtime
    // emits act_logits for choice questions — verified by this probe.
    expect(probe.contract?.actLogitsLen).toBeGreaterThan(0);
  });

  it("reports health stats after forwards (load + 4 forwards)", () => {
    expect(probe.health?.loaded).toBe(true);
    expect(probe.health?.forwards).toBe(4);
    expect(probe.health?.lastForwardMs).not.toBeNull();
    expect(probe.health?.loadMs).toBeGreaterThan(0);
  });

  it("singleton lazy init returns the same instance (child-process side)", () => {
    expect(probe.singletonSame).toBe(true);
  });
});