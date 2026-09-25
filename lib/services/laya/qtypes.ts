/**
 * Laya question types (spec 18, P1 port of `laya/common.py`).
 *
 * The model head takes `qtype` as an int (choice=0, score=1, noul=2) and embeds
 * it per-token; `QTYPE_NAMES` reverses that mapping for prompts and diagnostics.
 */

export const QTYPES = { choice: 0, score: 1, noul: 2 } as const;

export type QtypeName = keyof typeof QTYPES;
export type QtypeIndex = (typeof QTYPES)[QtypeName];

export const QTYPE_NAMES: Record<QtypeIndex, QtypeName> = { 0: "choice", 1: "score", 2: "noul" };

export type QtypeMap<T> = Record<QtypeIndex, T>;

export function qtypeIndex(name: QtypeName): QtypeIndex {
  return QTYPES[name];
}

export function qtypeName(index: QtypeIndex): QtypeName {
  return QTYPE_NAMES[index];
}