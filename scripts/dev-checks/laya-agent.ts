/**
 * LayaAgent system_one decode probe (spec 18, plan step 17 support).
 *
 * Same native-realm strategy as laya-forward.ts: onnxruntime-node + the
 * tokenizer WASM create objects outside Jest's vm sandbox, so
 * `layaAgent.test.ts` spawns THIS script as a child process and asserts on its
 * JSON. Weights-gated: no weights → `{"available":false}` (CI skip).
 *
 * One batch of three questions (choice k=3, score k=3, noul k=2) is decoded
 * TWICE to prove determinism; health + usage ride along.
 *
 * Run manually:  npx tsx scripts/dev-checks/laya-agent.ts
 */

import type { DecisionQuestion } from "../../lib/services/decision/types";
import { LayaAgent, layaAgentAvailable } from "../../lib/services/laya/agent";

const QUESTIONS: DecisionQuestion[] = [
  { name: "trade", type: "choice", options: ["buy", "hold", "sell"], instruction: "what should we do" },
  { name: "conviction", type: "score", criteria: ["weak", "medium", "strong"], instruction: "rate conviction" },
  { name: "valid", type: "noul", instruction: "is this actionable" },
];

const STATE = { symbol: "RELIANCE", closePrice: 2870.5 };

async function main(): Promise<void> {
  if (!layaAgentAvailable()) {
    console.log(JSON.stringify({ available: false }));
    return;
  }

  const agent = await LayaAgent.load();
  const runA = await agent.systemOne(STATE, QUESTIONS);
  const runB = await agent.systemOne(STATE, QUESTIONS);

  console.log(
    JSON.stringify({
      available: true,
      model: runA.model,
      questionKeys: QUESTIONS.map((q) => q.name),
      answers: runA.answers,
      usage: runA.usage,
      determinismEqual: JSON.stringify(runA.answers) === JSON.stringify(runB.answers),
      health: agent.health(),
    }),
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});