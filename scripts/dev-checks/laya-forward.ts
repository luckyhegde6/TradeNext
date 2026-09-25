/**
 * Laya decision-model forward probe (spec 18, plan step 15 support).
 *
 * onnxruntime-node's native binding creates output typed arrays in Node's
 * main realm, but Jest runs test modules inside a `vm` sandbox whose
 * `Float32Array` differs — ort's own `instanceof` guard (`tensor-impl.ts`
 * :256/:272) then rejects every output with "A float32 tensor's data must be
 * type of Float32Array". Plain Node has no such boundary (the P3 spike ran
 * under `npx tsx`). So `layaDecisionModel.test.ts` spawns THIS script as a
 * child process and asserts on its JSON: real regression signal locally,
 * weights-gated skip in CI (no weights → prints `{"available":false}`).
 *
 * Run manually:  npx tsx scripts/dev-checks/laya-forward.ts
 */

import { collateItems } from "../../lib/services/laya/collate";
import type { QtypeIndex } from "../../lib/services/laya/qtypes";
import {
  getLayaDecisionModel,
  layaModelAvailable,
  type LayaDecisionModel,
} from "../../lib/services/laya/decisionModel";

function batch(ids: number[], markers: number[], qtype: QtypeIndex) {
  const items = collateItems([[{ ids, markers, qtype }]], 0);
  if (!items) throw new Error("collateItems returned null for a non-empty batch");
  return items;
}

async function main(): Promise<void> {
  if (!layaModelAvailable()) {
    console.log(JSON.stringify({ available: false }));
    return;
  }

  const model: LayaDecisionModel = await getLayaDecisionModel();
  const singletonSame = (await getLayaDecisionModel()) === model;

  const a = await model.forward(batch([1, 2, 3, 4, 5, 6], [1, 3], 0));
  const a2 = await model.forward(batch([1, 2, 3, 4, 5, 6], [1, 3], 0));
  const degenerate = await model.forward(batch([1, 2, 3, 4], [1], 0));
  const score = await model.forward(batch([1, 2, 3, 4, 5, 6, 7, 8], [2, 5], 1));

  const logitsEqual =
    a.logits.length === a2.logits.length &&
    Array.from(a.logits).every((v, i) => v === a2.logits[i]);

  console.log(
    JSON.stringify({
      available: true,
      hiddenDim: model.health().hiddenDim,
      singletonSame,
      contract: {
        rows: a.rows,
        seq: a.seq,
        slots: a.slots,
        logitsLen: a.logits.length,
        latencyMs: a.latencyMs,
        actLogitsLen: a.actLogits?.length ?? 0,
        logitsA: Array.from(a.logits),
      },
      determinismEqual: logitsEqual,
      degenerate: {
        slots: degenerate.slots,
        logitsLen: degenerate.logits.length,
        allFinite: Array.from(degenerate.logits).every(Number.isFinite),
      },
      scoreActLogitsNull: score.actLogits === null,
      health: model.health(),
    }),
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});