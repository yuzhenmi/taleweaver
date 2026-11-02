import type { FlowState } from "../document/types";
import { type ParagraphLayout, type StoragePoint, type TerminatorRef, readLength, runsBefore } from "./paragraph-layout";

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
function storageOf(inert: readonly number[], q: number): number {
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

/**
 * The point before the block objects (TOCs) directly preceding paragraph `L` — with
 * nothing read between them — or null when none does. A LEADING endpoint
 * ({@link ModelPosition.leading}) sits there: the start of select-all over a leading
 * TOC, or of a TOC's object selection.
 */
export function objectsStart(L: ParagraphLayout): StoragePoint | null {
  let first: TerminatorRef | null = null;
  for (let t = L.before; t !== null && t.token.k === "toc"; ) {
    first = t;
    const { runs, before } = runsBefore(L.fs, t.seg, t.tok);
    if (runs.some((r) => {
      const token = L.fs.segments[r.seg]?.tokens[r.tok];
      return token !== undefined && token.k === "run" && readLength(token) > 0;
    })) break;
    t = before;
  }
  const seg = first === null ? undefined : L.fs.segments[first.seg];
  return first === null || seg === undefined ? null : { piece: seg.piece, index: first.index, seg: first.seg };
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
  return L.fs.synthetic ? L.head : flowEnd(L.fs);
}

/** Order of two storage points of one flow. */
export function comparePoints(a: StoragePoint, b: StoragePoint): number {
  return a.seg - b.seg || a.index - b.index;
}
