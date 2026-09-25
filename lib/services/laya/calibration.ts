/**
 * Laya temperature calibration + confidence helpers (spec 18, P1 port of
 * `laya/common.py`: `TEMP_MIN`, `TEMP_MAX`, `clamp_temperature`,
 * `temp_bucket`, `calibrate_temperature`, `confidence_from_probs`,
 * `ece_score`).
 *
 * Numerics deliberately mirror the Python: `confidenceFromProbs` uses the
 * natural log and 1e-12 clipping; `tempBucket` takes the qtype INDEX (0/1/2),
 * not its name.
 */

import { QTYPE_NAMES, type QtypeIndex } from "./qtypes";

export const TEMP_MIN = 0.5;
export const TEMP_MAX = 5.0;

/** Python `float(value)` — accepts numbers and numeric strings; else 1.0. */
function toFloat(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 1.0; // NaN (incl. parse failure) / ±Infinity → 1.0
  return n;
}

/** `clamp_temperature`: non-numeric / NaN / inf → 1.0, else clamp to [lo, hi]. */
export function clampTemperature(value: unknown, lo = TEMP_MIN, hi = TEMP_MAX): number {
  const n = toFloat(value);
  return Math.min(hi, Math.max(lo, n));
}

/** `temp_bucket(qtype, n_options)`: "choice:2" | "choice:3-5" | … key form. */
export function tempBucket(qtype: QtypeIndex, nOptions: number): string {
  const size = nOptions <= 2 ? "2" : nOptions <= 5 ? "3-5" : nOptions <= 10 ? "6-10" : "11+";
  return `${QTYPE_NAMES[qtype]}:${size}`;
}

/** Raw runtime config shape = rl_agent_config.json subset. */
export interface LayaRuntimeConfig {
  temperature: number[];
  temperatureByOptions: Record<string, number>;
}

/**
 * `calibrate_temperature(cfg, qtype, n_options)`: bucket override wins,
 * else per-qtype table, with the Python 1e-4 floor.
 */
export function calibrateTemperature(cfg: LayaRuntimeConfig, qtype: QtypeIndex, nOptions: number): number {
  const fallback = cfg.temperature[qtype];
  const t = typeof fallback === "number" ? fallback : 1.0;
  const bucket = tempBucket(qtype, nOptions);
  const scored = cfg.temperatureByOptions[bucket] ?? t;
  return scored >= 1e-4 ? scored : 1e-4;
}

/** Python `"%.4g"` — 4 significant digits, exponent trimmed of trailing zeros. */
export function pyG(value: number): string {
  const s = value.toPrecision(4);
  if (s.includes("e")) return s; // exponent form left as-is (rare for temps)
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/**
 * Clamped temperature tables as applied at Agent load (Python agent.py):
 * every entry passes `clampTemperature`; entries that changed are reported in
 * `rejected` with Python "%.4g" formatting. Raw config is preserved untouched.
 */
export function clampedTemperatureTables(raw: LayaRuntimeConfig): {
  temperature: number[];
  temperatureByOptions: Record<string, number>;
  rejected: string[];
} {
  const temperature = raw.temperature.map((t) => clampTemperature(t));
  const temperatureByOptions: Record<string, number> = {};
  const rejected: string[] = [];
  for (const [k, v] of Object.entries(raw.temperatureByOptions)) {
    const c = clampTemperature(v);
    temperatureByOptions[k] = c;
    if (c !== v) rejected.push(`${k}=${pyG(v)}`);
  }
  raw.temperature.forEach((t, i) => {
    if (typeof t === "number") {
      const c = clampTemperature(t);
      if (c !== t) rejected.push(`temperature[${i}]=${pyG(t)}`);
    } else {
      rejected.push(`temperature[${i}]=${pyG(Number(t) || 1)}`);
    }
  });
  return { temperature, temperatureByOptions, rejected };
}

/**
 * `confidence_from_probs(p, k)`: normalized entropy confidence over the first k
 * probabilities, natural log, 1e-12 clip; k<2 → 1.0.
 */
export function confidenceFromProbs(p: number[], k: number): number {
  if (k < 2) return 1.0;
  let ent = 0;
  for (let i = 0; i < k; i++) {
    const v = Math.min(1, Math.max(1e-12, p[i] ?? 0));
    ent -= v * Math.log(v);
  }
  return Math.min(1, Math.max(0, 1 - ent / Math.log(k)));
}

function linspace(a: number, b: number, n: number): number[] {
  const step = n <= 1 ? 0 : (b - a) / (n - 1);
  return Array.from({ length: n }, (_, i) => a + i * step);
}

/** `ece_score`: expected calibration error over binned confidence vs correctness. */
export function eceScore(conf: number[], correct: number[], bins = 15): number {
  if (conf.length === 0) return NaN;
  const edges = linspace(0, 1, bins + 1);
  let ece = 0;
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i];
    const hi = edges[i + 1];
    const sel: number[] = [];
    for (let j = 0; j < conf.length; j++) {
      const c = conf[j];
      if (c > lo && c <= hi) sel.push(j);
    }
    if (sel.length > 0) {
      let confMean = 0;
      let corrMean = 0;
      for (const j of sel) {
        confMean += conf[j];
        corrMean += correct[j] ?? 0;
      }
      confMean /= sel.length;
      corrMean /= sel.length;
      ece += (sel.length / conf.length) * Math.abs(confMean - corrMean);
    }
  }
  return ece;
}