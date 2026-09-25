/**
 * Python-faithful JSON rendering for Laya prompt construction (spec 18, P1
 * port of `laya/common.py`: `serialize_state`, `render_criterion`,
 * `render_options`).
 *
 * Laya's Python side renders criteria/state with `json.dumps(..., ensure_ascii=False)`,
 * which uses `", "` / `": "` separators and preserves key insertion order. JS
 * `JSON.stringify` uses compact `,`/`:` separators, so prompts built from it
 * tokenize differently and diverge from the reference softmax path. These
 * helpers reproduce the Python output for the value shapes Laya handles
 * (string / null / boolean / number / array / object of those).
 */

import type { QtypeName } from "./qtypes";

/** Internal question shape as produced by Laya's `_to_internal` (agent.py). */
export interface InternalQuestion {
  t: QtypeName;
  ins: string;
  crit?: Record<string, unknown> | unknown[];
}

function pythonString(value: string): string {
  // JSON.stringify escapes the same set Python's json escapes with
  // ensure_ascii=False (" \ \b \f \n \r \t + \u00XX) — with one difference:
  // Python does NOT escape U+2028/U+2029, JS does. Accepted micro-disparity
  // (those code points never occur in TradeNext criteria).
  return JSON.stringify(value);
}

function pythonNumber(value: number): string {
  if (!Number.isFinite(value)) {
    // Python json.dumps raises for NaN/Infinity — never reached for validated
    // criteria; JSON.stringify emits "null".
    return JSON.stringify(value);
  }
  // Python renders whole floats with a trailing ".0" (1.0 -> "1.0"); JS emits
  // "1". Criteria in TradeNext are strings/null, so whole-valued floats are the
  // only affected corner — keep the JS form (documented micro-disparity).
  return String(value);
}

/**
 * Port of `json.dumps(value, ensure_ascii=False)` plus the optional
 * `default=str` fallback (used by render_criterion). Throws TypeError when the
 * value is unsupported and no default is supplied — mirroring Python.
 */
export function pythonDumps(value: unknown, opts: { default?: (v: unknown) => unknown } = {}): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return pythonString(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return pythonNumber(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map((v) => pythonDumps(v, opts)).join(", ")}]`;
      const entries = Object.entries(value as Record<string, unknown>);
      return `{${entries.map(([k, v]) => `${pythonString(k)}: ${pythonDumps(v, opts)}`).join(", ")}}`;
    }
    default: {
      if (opts.default) return pythonDumps(opts.default(value), opts);
      throw new TypeError(`Object of type ${typeof value} is not JSON serializable`);
    }
  }
}

/** `serialize_state`: string passthrough, else Python-style json.dumps. */
export function serializeState(state: string | Record<string, unknown> | unknown[]): string {
  if (typeof state === "string") return state;
  return pythonDumps(state);
}

/** `render_criterion`: string passthrough, else dumps with `default=str`. */
export function renderCriterion(value: unknown): string {
  if (typeof value === "string") return value;
  return pythonDumps(value, { default: String });
}

interface ChoiceCrit {
  [k: string]: unknown;
}

/**
 * `render_options`: the exact option strings Laya renders for a question.
 * - choice: `"opt"` or `"opt: desc"` — 0/False ARE descriptions (only null/"" mean none)
 * - score:  `"level i: desc"`
 * - noul:   `"false: <crit>"` / `"true: <crit>"` with default hold texts
 */
export function renderOptions(q: InternalQuestion): string[] {
  const t = q.t;
  const crit = q.crit;
  if (t === "choice") {
    if (typeof crit !== "object" || crit === null || Array.isArray(crit)) return [];
    const out: string[] = [];
    for (const [k, v] of Object.entries(crit as ChoiceCrit)) {
      out.push(v === null || v === "" ? k : `${k}: ${renderCriterion(v)}`);
    }
    return out;
  }
  if (t === "score") {
    if (typeof crit !== "object" || crit === null || !Array.isArray(crit)) return [];
    return crit.map((c, i) => `level ${i}: ${renderCriterion(c)}`);
  }
  if (t === "noul") {
    const c = (crit as ChoiceCrit) ?? {};
    const falseV = c.false;
    const trueV = c.true;
    const falseC = falseV == null || falseV === "" ? "no, the statement does not hold" : renderCriterion(falseV);
    const trueC = trueV == null || trueV === "" ? "yes, the statement holds" : renderCriterion(trueV);
    return [`false: ${falseC}`, `true: ${trueC}`];
  }
  return [];
}