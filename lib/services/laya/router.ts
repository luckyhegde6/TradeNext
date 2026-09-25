/**
 * Checkpoint routing for Laya (spec 18, P1 verbatim port of `laya/router.py`
 * —— pure functions; the `Router` class with LRU model lifecycle is NOT ported
 * (TradeNext holds one checkpoint at a time).
 *
 * Three checkpoints (shared benchmark, 17,416 questions, one T4):
 *   english          convaiinnovations/laya                   421M ModernBERT-large, 512 tokens
 *   multilingual     convaiinnovations/laya-multilingual      322M mmBERT-base, 1024 tokens, 100+ langs
 *   typed-decisions  convaiinnovations/laya-typed-decisions   421M ModernBERT-large, 1024 tokens,
 *                                                             fine-tuned on the typed-decisions workflows
 *
 * The English checkpoint does not gently degrade off English, it collapses
 * (0.100 on Hindi against 0.050 random on 20-option MASSIVE intent, ECE 0.855).
 * Script detection is therefore the primary routing signal; `typed-decisions`
 * is never selected automatically without opting in (`autoTaskDetection`).
 */

import { analyse, LangAnalysis } from "./lang";

/** `(repo, subfolder)` model spec, one tuple per Python. */
export type ModelSpec = [string, string | null];

export type LayaModelName = "english" | "multilingual" | "typed-decisions";

/** The hub repo bundles all three checkpoints; only the requested subfolder is downloaded. */
export const BUNDLE_REPO = "convaiinnovations/laya";

export const DEFAULT_MODELS: Record<LayaModelName, ModelSpec> = {
  english: [BUNDLE_REPO, null],
  multilingual: [BUNDLE_REPO, "multilingual"],
  "typed-decisions": [BUNDLE_REPO, "typed-decisions"],
};

/** The same checkpoints also live in their own repos, for anyone who prefers them. */
export const STANDALONE_MODELS: Record<LayaModelName, string> = {
  english: "convaiinnovations/laya",
  multilingual: "convaiinnovations/laya-multilingual",
  "typed-decisions": "convaiinnovations/laya-typed-decisions",
};

/** `_repo_str`: human-readable id for a model spec: 'repo' or 'repo/subfolder'. */
export function repoStr(spec: ModelSpec): string {
  const [repo, sub] = splitSpec(spec);
  return sub ? `${repo}/${sub}` : repo;
}

/** `_split`: normalise a model spec to (repo, subfolder). */
function splitSpec(spec: ModelSpec | string): ModelSpec {
  if (Array.isArray(spec)) {
    const [repo, sub] = spec.length >= 2 ? spec : [...spec, null];
    return [String(repo), sub ?? null];
  }
  return [String(spec), null];
}

/** Aliases people are likely to type (`_ALIASES`). */
const ALIASES: Record<string, LayaModelName> = {
  en: "english",
  laya: "english",
  default: "english",
  multi: "multilingual",
  ml: "multilingual",
  "laya-multilingual": "multilingual",
  typed: "typed-decisions",
  typed_decisions: "typed-decisions",
  "laya-typed-decisions": "typed-decisions",
  decisions: "typed-decisions",
};

/**
 * Question-id signatures of the four typed-decisions workflows, used only when
 * auto-task-detection is enabled. Matched by EXACT id-set equality, so an
 * unrelated schema that happens to contain "urgency" is never captured.
 */
const TYPED_DECISION_WORKFLOWS: Record<string, ReadonlySet<string>> = {
  agent_trace_observability: new Set(["action", "needs_review", "outcome", "risk", "urgency"]),
  customer_service: new Set(["action", "category", "churn_risk", "needs_human", "urgency"]),
  invoice_processing: new Set(["discrepancy_severity", "disposition", "duplicate", "matches_order", "urgency"]),
  security_incidents: new Set(["credential_compromise", "disposition", "severity", "true_positive", "urgency"]),
};

/** Python ValueError raised by `normalise_name` on an unknown model/task. */
export class LayaRouterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LayaRouterError";
  }
}

/** Python `%r` on a string: single-quoted repr. */
function pyRepr(value: unknown): string {
  if (typeof value === "string") {
    return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  }
  return String(value);
}

/** Python `str(sorted(list_of_strings))` → `['a', 'b', 'c']`. */
function pyStrList(items: string[]): string {
  return `[${items.map(pyRepr).join(", ")}]`;
}

const DEFAULT_MODEL_KEYS = Object.keys(DEFAULT_MODELS).sort();
const ALIAS_KEYS = Object.keys(ALIASES).sort();

/** `normalise_name`: strip, lowercase, alias-resolve, validate. Throws `LayaRouterError`. */
export function normaliseName(name: string): LayaModelName {
  let key = String(name).trim().toLowerCase();
  key = ALIASES[key] ?? key;
  if (!(key in DEFAULT_MODELS)) {
    const msg =
      `unknown model ${pyRepr(name)}; choose one of ${pyStrList(DEFAULT_MODEL_KEYS)}` +
      ` (or an alias: ${pyStrList(ALIAS_KEYS)})`;
    throw new LayaRouterError(msg);
  }
  return key as LayaModelName;
}

/** `match_typed_decisions_workflow`: id-set exact match → workflow name or null. */
export function matchTypedDecisionsWorkflow(questions: Record<string, unknown> | null): string | null {
  const ids = new Set(Object.keys(questions ?? {}));
  for (const [wf, sig] of Object.entries(TYPED_DECISION_WORKFLOWS)) {
    if (ids.size === sig.size && [...ids].every((id) => sig.has(id))) return wf;
  }
  return null;
}

export type RouteState = string | Record<string, unknown> | unknown[] | null | undefined;

export interface RouteDecision {
  model: string;
  /** String id in every branch EXCEPT the workflow branch, which faithfully passes the raw tuple. */
  repo: string | ModelSpec;
  reason: string;
  detection: LangAnalysis | null;
  workflow: string | null;
}

export interface RouteOptions {
  model?: string | null;
  task?: string | null;
  lang?: string | null;
  autoTaskDetection?: boolean;
  /** Replaces `Router(default=...)`; `normaliseName`d when the unknown-script branch needs it. */
  defaultModel?: string;
}

/**
 * `route(state, questions?, opts?)`: decide which checkpoint to use without
 * loading or running anything.
 *
 * Precedence: explicit `model` > explicit `task` > detected workflow (opt-in) >
 * explicit `lang` > detected script/language > default.
 */
export function route(state: RouteState, questions?: Record<string, unknown> | null, opts: RouteOptions = {}): RouteDecision {
  const { model = null, task = null, lang = null, autoTaskDetection = false, defaultModel = "english" } = opts;

  if (model !== null) {
    const key = normaliseName(model as string);
    return {
      model: key,
      repo: repoStr(DEFAULT_MODELS[key]),
      reason: `explicit model=${pyRepr(model)}`,
      detection: null,
      workflow: null,
    };
  }

  if (task !== null) {
    const raw = String(task).toLowerCase().replaceAll("-", "_") === "typed_decisions" ? "typed-decisions" : task;
    const key = normaliseName(raw as string);
    return {
      model: key,
      repo: repoStr(DEFAULT_MODELS[key]),
      reason: `explicit task=${pyRepr(task)}`,
      detection: null,
      workflow: null,
    };
  }

  const workflow = matchTypedDecisionsWorkflow(questions ?? {});
  if (workflow && autoTaskDetection) {
    // Upstream quirk preserved: repo here is the RAW (repo, subfolder) tuple,
    // not _repo_str() — see router.py line 282.
    return {
      model: "typed-decisions",
      repo: DEFAULT_MODELS["typed-decisions"],
      reason: `question ids match the ${pyRepr(workflow)} typed-decisions workflow`,
      detection: null,
      workflow,
    };
  }

  if (lang !== null) {
    const key: LayaModelName = ["en", "eng", "english"].includes(String(lang).toLowerCase().split("-")[0])
      ? "english"
      : "multilingual";
    return {
      model: key,
      repo: repoStr(DEFAULT_MODELS[key]),
      reason: `explicit lang=${pyRepr(lang)}`,
      detection: null,
      workflow,
    };
  }

  const det = analyse(state);
  let key: LayaModelName;
  let reason: string;
  if (det.script === "unknown") {
    key = normaliseName(defaultModel as string);
    reason = `no letters detected in state; using default (${key})`;
  } else if (det.script !== "latin") {
    key = "multilingual";
    reason =
      `non-Latin script (${det.script}, ${formatPercent(100 * det.nonLatinFraction)}% of letters); ` +
      `the English checkpoint cannot read it`;
  } else if (!det.isEnglish) {
    key = "multilingual";
    if (det.language) {
      reason = `Latin script but language looks like ${pyRepr(det.language)}, not English`;
    } else {
      // Unidentified Latin-script language: routed on the non-English letters
      // alone, because no stopword list here covers it.
      reason =
        `Latin script, language not identified but ${formatPercent(100 * det.diacriticRate)}% ` +
        `non-English letters; not safe for the English checkpoint`;
    }
  } else {
    key = "english";
    reason = "English Latin text";
  }
  return { model: key, repo: repoStr(DEFAULT_MODELS[key]), reason, detection: det, workflow };
}

/** Python `"%.0f"` — round-half-even integer formatting. */
function formatPercent(x: number): string {
  const floor = Math.floor(x);
  const frac = x - floor;
  if (frac > 0.5) return String(floor + 1);
  if (frac < 0.5) return String(floor);
  return String(floor % 2 === 0 ? floor : floor + 1);
}