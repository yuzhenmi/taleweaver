import * as Y from "yjs";
import { scanCtxOf } from "../derive/derive-flow";
import type { Working } from "../derive/working";
import type { FlowState } from "../document/types";
import { flattenPiece } from "../scan/flatten-piece";
import { scanRange } from "../scan/scan-range";
import { type Segment, type Token, isTerminator } from "../scan/tokens";
import type { DeltaOp, PieceChange } from "./flow-change";

// ---------------------------------------------------------------------------
// Piece level
// ---------------------------------------------------------------------------

const insertLength = (ins: unknown): number => (typeof ins === "string" ? ins.length : 1);

/** Storage index of `item` in its piece. O(piece). */
function indexOfItem(item: Y.Item): number | null {
  const piece = item.parent;
  if (!(piece instanceof Y.Text)) return null;
  let n = 0;
  for (let it = piece._start; it !== null; it = it.right) {
    if (it === item) return n;
    if (!it.deleted && it.countable) n += it.length;
  }
  return null;
}

/** Map a new-space index of a pre-existing item to the old space through `delta`. */
function newToOld(delta: readonly DeltaOp[] | null, i: number): number | null {
  if (delta === null) return i;
  let oldPos = 0;
  let newPos = 0;
  for (const op of delta) {
    if (op.retain !== undefined) {
      if (i < newPos + op.retain) return oldPos + (i - newPos);
      oldPos += op.retain;
      newPos += op.retain;
    } else if (op.insert !== undefined) {
      const n = insertLength(op.insert);
      if (i < newPos + n) return null;
      newPos += n;
    } else if (op.delete !== undefined) {
      oldPos += op.delete;
    }
  }
  return oldPos + (i - newPos);
}

/** One change of a piece's delta (or one changed map item): old storage `[oa, ob)`, new length − old length `d`. */
interface Run {
  readonly oa: number;
  readonly ob: number;
  readonly d: number;
}

/** The piece's change runs, in old-space order. */
function changeRuns(pc: PieceChange): Run[] {
  const runs: Run[] = [];
  let oldPos = 0;
  for (const op of pc.delta ?? []) {
    if (op.retain !== undefined) {
      if (op.attributes !== undefined) runs.push({ oa: oldPos, ob: oldPos + op.retain, d: 0 });
      oldPos += op.retain;
    } else if (op.insert !== undefined) {
      runs.push({ oa: oldPos, ob: oldPos, d: insertLength(op.insert) });
    } else if (op.delete !== undefined) {
      runs.push({ oa: oldPos, ob: oldPos + op.delete, d: -op.delete });
      oldPos += op.delete;
    }
  }
  // ponytail: indexOfItem / newToOld are O(piece) per changed map item; an index walk if many map edits show.
  for (const item of pc.mapItems) {
    if (item.deleted) continue;
    const ni = indexOfItem(item);
    const o = ni === null ? null : newToOld(pc.delta, ni);
    if (o !== null) runs.push({ oa: o, ob: o + 1, d: 0 });
  }
  return runs.sort((a, b) => a.oa - b.oa || a.ob - b.ob);
}

/** The first `i` in `[lo, hi)` with `pred(i)` (`pred` monotone), else `hi`. */
function lowerBound(lo: number, hi: number, pred: (i: number) => boolean): number {
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pred(mid)) hi = mid;
    else lo = mid + 1;
  }
  return hi;
}

/**
 * A changed token window of a splice: tokens `[startOld, endOld)` became `[startNew, endNew)`. `start*` index the
 * splice's first segment, `end*` its last (old / new) one. `closed`: the window ends with an UNCHANGED terminator
 * (the delta path found one past its changes), which is its region's right anchor.
 */
export interface Window {
  readonly startOld: number;
  readonly startNew: number;
  readonly endOld: number;
  readonly endNew: number;
  readonly closed: boolean;
}

/** A splice of a flow's segment list: old segments `[o1, o2)` become `segs`; its changed token windows, in order. */
export interface Splice {
  readonly o1: number;
  readonly o2: number;
  readonly segs: readonly Segment[];
  readonly windows: readonly Window[];
}

/** The one window of a splice whose tokens are all new. */
const wholeWindow = (endOld: number, endNew: number): Window[] => [{ startOld: 0, startNew: 0, endOld, endNew, closed: false }];

/** Insert new segments before old segment `at`. */
export function insertion(at: number, segs: readonly Segment[]): Splice {
  return { o1: at, o2: at, segs, windows: wholeWindow(0, segs[segs.length - 1]?.tokens.length ?? 0) };
}

/** Replace a piece's whole subtree (its segments and its sub-flows' segments). */
export function subtreeSplice(fs: FlowState, piece: Y.Text, w: Working): Splice | null {
  const idx = fs.segIndex.get(piece);
  const o1 = idx?.[0];
  const oLast = idx?.[idx.length - 1];
  if (o1 === undefined || oLast === undefined) return null;
  const segs = flattenPiece(piece, scanCtxOf(w, fs.tree), [], fs.segments[o1]?.depth ?? 0);
  return { o1, o2: oLast + 1, segs, windows: wholeWindow(fs.segments[oLast]?.tokens.length ?? 0, segs[segs.length - 1]?.tokens.length ?? 0) };
}

type DeltaResult = { readonly splice: Splice; readonly shifted: readonly [number, Segment][] } | "none" | "structural";

/**
 * Rescan the one segment a piece's delta falls in, window by window: each change run widens to whole entities (after
 * the last terminator ending at or before it, through the first terminator starting at or after its end); windows
 * that overlap or touch merge. "structural" when the changes are not one segment's.
 */
export function deltaSplice(fs: FlowState, piece: Y.Text, pc: PieceChange, w: Working): DeltaResult {
  const idx = fs.segIndex.get(piece) ?? [];
  const segs = idx.map((i) => fs.segments[i]);
  let oldLen = idx.length - 1;
  for (const sg of segs) oldLen += sg?.len ?? 0;
  const runs = changeRuns(pc);
  if (runs.length === 0) return oldLen === piece.length ? "none" : "structural";
  let d = 0;
  let oa = Infinity;
  let ob = -Infinity;
  for (const r of runs) {
    d += r.d;
    oa = Math.min(oa, r.oa);
    ob = Math.max(ob, r.ob);
  }
  if (oldLen + d !== piece.length) return "structural";
  // The one segment holding every run (an insertion at a segment's end belongs to it).
  const k = segs.findIndex((sg) => sg !== undefined && sg.start <= oa && ob <= sg.start + sg.len);
  const os = segs[k];
  const o1 = idx[k];
  if (os === undefined || o1 === undefined) return "structural";
  const toks = os.tokens;
  const n = toks.length;
  // Token start offsets (segment-relative), the last terminator before each index, the first at or after it.
  const offs: number[] = [0];
  const prevTerm: number[] = [-1];
  for (let i = 0, pos = 0, last = -1; i < n; i++) {
    const t = toks[i];
    if (t === undefined) return "structural";
    pos += t.len;
    if (isTerminator(t)) last = i;
    offs.push(pos);
    prevTerm.push(last);
  }
  const nextTerm: number[] = new Array<number>(n + 1).fill(n);
  for (let i = n - 1; i >= 0; i--) {
    const t = toks[i];
    nextTerm[i] = t !== undefined && isTerminator(t) ? i : (nextTerm[i + 1] ?? n);
  }
  const off = (i: number): number => offs[i] ?? os.len;
  // Each run's window, merged with the previous one when they overlap or touch.
  interface Win {
    start: number;
    endOld: number;
    iR: number;
    closed: boolean;
    d: number;
  }
  const wins: Win[] = [];
  for (const r of runs) {
    const a = r.oa - os.start;
    const b = r.ob - os.start;
    // Left: after the last terminator among the tokens ending at or before a.
    const m = lowerBound(0, n, (i) => off(i + 1) > a);
    const start = (prevTerm[m] ?? -1) + 1;
    // Right: through the first terminator starting at or after b.
    const e = nextTerm[lowerBound(start, n, (i) => off(i) >= b)] ?? n;
    const win: Win = e < n ? { start, endOld: e + 1, iR: off(e + 1), closed: true, d: r.d } : { start, endOld: n, iR: os.len, closed: false, d: r.d };
    const prev = wins[wins.length - 1];
    if (prev === undefined || win.start > prev.endOld) wins.push(win);
    else {
      prev.d += win.d;
      // The later end wins; at the same end, an open window (no terminator past its changes) beats a closed one.
      if (win.endOld > prev.endOld || (win.endOld === prev.endOld && !win.closed)) {
        prev.endOld = win.endOld;
        prev.iR = win.iR;
        prev.closed = win.closed;
      }
    }
  }
  const tokens: Token[] = [];
  const windows: Window[] = [];
  let shift = 0; // storage length change of the windows so far
  let prevEnd = 0;
  for (const wn of wins) {
    const iL = off(wn.start);
    const fresh = scanRange(piece, os.start + iL + shift, os.start + wn.iR + shift + wn.d, scanCtxOf(w, fs.tree), os.depth);
    if (fresh === null) return "structural";
    // The closing terminator is outside the runs, so it must rescan as the window's last token.
    const lastFresh = fresh[fresh.length - 1];
    if (wn.closed && (lastFresh === undefined || !isTerminator(lastFresh))) return "structural";
    for (let i = prevEnd; i < wn.start; i++) {
      const t = toks[i];
      if (t !== undefined) tokens.push(t);
    }
    const startNew = tokens.length;
    tokens.push(...fresh);
    windows.push({ startOld: wn.start, startNew, endOld: wn.endOld, endNew: tokens.length, closed: wn.closed });
    prevEnd = wn.endOld;
    shift += wn.d;
  }
  for (let i = prevEnd; i < n; i++) {
    const t = toks[i];
    if (t !== undefined) tokens.push(t);
  }
  const seg: Segment = { piece, depth: os.depth, start: os.start, len: os.len + d, tokens };
  const shifted: [number, Segment][] = [];
  if (d !== 0) {
    for (let j = k + 1; j < segs.length; j++) {
      const sg = segs[j];
      const at = idx[j];
      if (sg !== undefined && at !== undefined) shifted.push([at, { ...sg, start: sg.start + d }]);
    }
  }
  return { splice: { o1, o2: o1 + 1, segs: [seg], windows }, shifted };
}
