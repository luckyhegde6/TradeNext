/**
 * Laya batch collation (spec 18, P1 port of `laya/common.py` `collate_items`).
 *
 * Produces the exact tensor layouts the decision model consumes:
 * `input_ids` [n,L] (pad-filled), `attention_mask` [n,L] 0/1, `marker_pos`
 * [n,kmax] (zero-filled), `marker_mask` [n,kmax] bool, `qtype` [n], `label`
 * [n] (default -1). `target` is emitted only when at least one item carries it.
 */

import type { QtypeIndex } from "./qtypes";

export interface CollatedItem {
  ids: number[];
  markers: number[];
  qtype: QtypeIndex;
  target?: number[];
  label?: number;
  [k: string]: unknown;
}

export interface CollatedBatch {
  inputIds: number[][];
  attentionMask: number[][];
  markerPos: number[][];
  markerMask: boolean[][];
  qtype: number[];
  label: number[];
  meta: Record<string, unknown>[];
  target?: number[][];
}

/**
 * `collate_items(batch, pad_id)`: flatten groups, pad to the batch max
 * lengths, return null for an empty batch (Python `None`).
 */
export function collateItems(batch: CollatedItem[][], padId: number): CollatedBatch | null {
  const items = batch.flat();
  if (items.length === 0) return null;

  let L = 0;
  let kmax = 0;
  for (const it of items) {
    if (it.ids.length > L) L = it.ids.length;
    if (it.markers.length > kmax) kmax = it.markers.length;
  }
  const hasTarget = items.some((it) => it.target !== undefined);

  const inputIds: number[][] = [];
  const attentionMask: number[][] = [];
  const markerPos: number[][] = [];
  const markerMask: boolean[][] = [];
  for (const it of items) {
    const idsRow: number[] = new Array(L).fill(padId);
    it.ids.forEach((v, i) => {
      idsRow[i] = v;
    });
    const attRow: number[] = new Array(L).fill(0);
    for (let i = 0; i < it.ids.length; i++) attRow[i] = 1;
    const mposRow: number[] = new Array(kmax).fill(0);
    it.markers.forEach((v, i) => {
      mposRow[i] = v;
    });
    const mmaskRow: boolean[] = new Array(kmax).fill(false);
    for (let i = 0; i < it.markers.length; i++) mmaskRow[i] = true;
    inputIds.push(idsRow);
    attentionMask.push(attRow);
    markerPos.push(mposRow);
    markerMask.push(mmaskRow);
  }

  const res: CollatedBatch = {
    inputIds,
    attentionMask,
    markerPos,
    markerMask,
    qtype: items.map((it) => it.qtype),
    label: items.map((it) => it.label ?? -1),
    meta: items.map((it) => {
      const m: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(it)) {
        if (k !== "ids" && k !== "markers" && k !== "target") m[k] = v;
      }
      return m;
    }),
  };
  if (hasTarget) {
    const target: number[][] = [];
    for (const it of items) {
      const row: number[] = new Array(kmax).fill(0);
      it.target?.forEach((v, i) => {
        row[i] = v;
      });
      target.push(row);
    }
    res.target = target;
  }
  return res;
}