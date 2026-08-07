// lib/cron-parser.ts
// Shared 5-field cron next-run calculator used by the worker scheduler and
// admin cron config. Supports:
//   * minute hour day-of-month month day-of-week
//   * lists (1,2,3), ranges (1-5), steps (*/15), wildcards (*)
//   * weekday names (MON-FRI, SUN..SAT) and ranges
//   * weekday ranges (e.g. "0 16 * * 1-5" = Mon-Fri at 16:00)
// See lib/__tests__/cronParser.test.ts for coverage.

const DAY_NAMES: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

interface ParsedField {
  values: number[];
  isWildcard: boolean;
}

/** Parse a single cron field (minute|hour|dom|month|dow) into allowed values. */
function parseField(field: string, min: number, max: number, names?: Record<string, number>): ParsedField {
  const resolved: number[] = [];
  let isWildcard = false;

  const expand = (token: string): number[] => {
    if (names && names[token.toUpperCase()] !== undefined) return [names[token.toUpperCase()]];
    if (token.includes("-")) {
      const [a, b] = token.split("-").map((t) => {
        if (names && names[t.toUpperCase()] !== undefined) return names[t.toUpperCase()];
        return parseInt(t, 10);
      });
      if (Number.isNaN(a) || Number.isNaN(b)) return [];
      const out: number[] = [];
      for (let v = a; v <= b; v++) out.push(v);
      return out;
    }
    const v = parseInt(token, 10);
    return Number.isNaN(v) ? [] : [v];
  };

  if (field === "*") {
    isWildcard = true;
    for (let v = min; v <= max; v++) resolved.push(v);
  } else if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10) || 1;
    for (let v = min; v <= max; v += step) resolved.push(v);
  } else {
    for (const token of field.split(",")) {
      resolved.push(...expand(token));
    }
  }

  // Normalize dow: cron allows 7 for Sunday; we keep 0..6. This cap must only
  // apply to the day-of-week field (the only one with max === 6) — applying it
  // to every field truncates minutes (30 > 6) and months (only Jan–Jun),
  // breaking the parser.
  const isDowField = max === 6;
  return {
    values: resolved.filter((v) => v >= min && v <= max && (!isDowField || v <= 6)),
    isWildcard,
  };
}

/**
 * Compute the next run time for a 5-field cron expression strictly after `from`.
 * Falls back to now + 60s for invalid expressions (never throws).
 */
export function calculateNextRun(cronExpression: string, from: Date = new Date()): Date {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return new Date(from.getTime() + 60_000);
  }

  const [minuteF, hourF, domF, monthF, dowF] = parts;
  const minutes = parseField(minuteF, 0, 59);
  const hours = parseField(hourF, 0, 23);
  const doms = parseField(domF, 1, 31);
  const months = parseField(monthF, 1, 12);
  const dows = parseField(dowF, 0, 6, DAY_NAMES);

  const start = new Date(from);
  start.setSeconds(0, 0);
  const candidate = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);

  // Search forward up to 400 days (covers yearly + leap day cases).
  for (let day = 0; day < 400; day++) {
    const date = new Date(candidate);
    date.setDate(candidate.getDate() + day);

    if (!months.values.includes(date.getMonth() + 1)) continue;

    // Standard cron semantics: when BOTH dom and dow are restricted they are OR'd.
    const domMatch = doms.isWildcard || doms.values.includes(date.getDate());
    const dowMatch = dows.isWildcard || dows.values.includes(date.getDay());
    const dayMatches = !doms.isWildcard && !dows.isWildcard ? domMatch || dowMatch : domMatch && dowMatch;
    if (!dayMatches) continue;

    for (const h of hours.values) {
      for (const m of minutes.values) {
        const t = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m, 0, 0);
        if (t.getTime() > from.getTime()) return t;
      }
    }
  }

  return new Date(from.getTime() + 60_000);
}
