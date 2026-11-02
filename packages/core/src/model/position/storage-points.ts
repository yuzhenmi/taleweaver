import type { FlowState } from "../document/types";
import type { ParagraphLayout, StoragePoint, TerminatorRef } from "./paragraph-layout";

/** Storage offset (run-relative) just after the `q`-th read unit of a run, q ≥ 1. */
function storageAfter(inert: readonly number[], q: number): number {
  let s = q;
  for (const g of inert) {
    if (g < s) s++;
    else break;
  }
  return s;
}

/** Storage offset (run-relative) of the `q`-th read unit (0-based) of a run. */
export function storageOf(inert: readonly number[], q: number): number {
  let s = q;
  for (const g of inert) {
    if (g <= s) s++;
    else break;
  }
  return s;
}

/** The flow's end point (after its last segment), or null for a flow with no piece. */
function flowEnd(fs: FlowState): StoragePoint | null {
  const j = fs.segments.length - 1;
  const seg = fs.segments[j];
  return seg === undefined ? null : { piece: seg.piece, index: seg.start + seg.len, seg: j };
}

/** The storage point of terminator `t` (just before it). */
export function pointOf(fs: FlowState, t: TerminatorRef): StoragePoint | null {
  const seg = fs.segments[t.seg];
  return seg === undefined ? null : { piece: seg.piece, index: t.index, seg: t.seg };
}

/** R16: the insertion point of `offset` (clamped): right after the read unit before it. */
export function pointAfter(L: ParagraphLayout, offset: number): StoragePoint | null {
  const off = Math.min(Math.max(0, offset), L.length);
  if (off === 0) return L.head;
  for (const p of L.parts) {
    if (p.read === 0 || off > p.readStart + p.read) continue;
    return { piece: p.piece, index: p.start + storageAfter(p.token.inert, off - p.readStart), seg: p.seg };
  }
  return L.head;
}

/** The storage index OF the read unit at `offset` (at the paragraph's end: its terminator, or the flow end). */
export function pointBefore(L: ParagraphLayout, offset: number): StoragePoint | null {
  const off = Math.min(Math.max(0, offset), L.length);
  if (off < L.length) {
    for (const p of L.parts) {
      if (p.read === 0 || off >= p.readStart + p.read) continue;
      return { piece: p.piece, index: p.start + storageOf(p.token.inert, off - p.readStart), seg: p.seg };
    }
  }
  if (L.end !== null) {
    const seg = L.fs.segments[L.end.seg];
    return seg === undefined ? null : { piece: seg.piece, index: L.end.index, seg: L.end.seg };
  }
  return L.implicit ? L.head : flowEnd(L.fs);
}

/** Order of two storage points of one flow. */
export function comparePoints(a: StoragePoint, b: StoragePoint): number {
  return a.seg - b.seg || a.index - b.index;
}
