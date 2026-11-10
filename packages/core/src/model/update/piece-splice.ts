import * as Y from "yjs";
import { scanCtxOf } from "../derive/derive-flow";
import type { Working } from "../derive/working";
import type { FlowState } from "../document/types";
import { flattenPiece, isSubflow, subflowPieces } from "../scan/flatten-piece";
import { scanRanges } from "../scan/scan-range";
import { type ScanCtx, type Segment, type Token, isTerminator } from "../scan/tokens";
import { SUBFLOW_DEPTH_CAP } from "../storage/limits";
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
 * A changed token window of a splice: tokens `[startOld, endOld)` of its one old segment became tokens `startNew` of
 * `segs[pStart]` through `endNew` (exclusive) of `segs[pEnd]` (a window spans several new segments when a new
 * sub-flow splits its segment). `closed`: the window ends with an UNCHANGED terminator (the delta path found one past
 * its changes), which is its region's right anchor.
 */
export interface Window {
  readonly startOld: number;
  readonly startNew: number;
  readonly pStart: number;
  readonly endOld: number;
  readonly endNew: number;
  readonly pEnd: number;
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
const wholeWindow = (endOld: number, segs: readonly Segment[]): Window[] => [
  { startOld: 0, startNew: 0, pStart: 0, endOld, endNew: segs[segs.length - 1]?.tokens.length ?? 0, pEnd: Math.max(0, segs.length - 1), closed: false },
];

/** Insert new segments before old segment `at`. */
export function insertion(at: number, segs: readonly Segment[]): Splice {
  return { o1: at, o2: at, segs, windows: wholeWindow(0, segs) };
}

/** Replace a piece's whole subtree (its segments and its sub-flows' segments). */
export function subtreeSplice(fs: FlowState, piece: Y.Text, w: Working): Splice | null {
  const idx = fs.segIndex.get(piece);
  const o1 = idx?.[0];
  const oLast = idx?.[idx.length - 1];
  if (o1 === undefined || oLast === undefined) return null;
  const segs = flattenPiece(piece, scanCtxOf(w, fs.tree), [], fs.segments[o1]?.depth ?? 0);
  return { o1, o2: oLast + 1, segs, windows: wholeWindow(fs.segments[oLast]?.tokens.length ?? 0, segs) };
}

/** A sub-flow item a piece's delta inserted, at its new storage index. */
interface NewSub {
  readonly at: number;
  readonly map: Y.Map<unknown>;
}

/** The read sub-flow items (`depth` under the cap) `delta` inserts, in order. */
function newSubs(delta: readonly DeltaOp[] | null, depth: number): NewSub[] {
  const out: NewSub[] = [];
  if (depth >= SUBFLOW_DEPTH_CAP) return out; // inert: scanned as content
  let pos = 0;
  for (const op of delta ?? []) {
    if (op.retain !== undefined) pos += op.retain;
    else if (op.insert !== undefined) {
      if (isSubflow(op.insert)) out.push({ at: pos, map: op.insert });
      pos += insertLength(op.insert);
    }
  }
  return out;
}

type DeltaResult = { readonly splices: readonly Splice[]; readonly shifted: readonly [number, Segment][] } | "none" | "structural";

/**
 * Rescan the segments a piece's delta falls in, one splice per touched segment (an insertion at a segment's end belongs
 * to it). "structural" when a change is not one segment's: it crosses or deletes a sub-flow item. A new sub-flow item
 * is read in place: its segment splits there, around the sub-flow's segments (N4b step b′).
 */
export function deltaSplice(fs: FlowState, piece: Y.Text, pc: PieceChange, w: Working): DeltaResult {
  const idx = fs.segIndex.get(piece) ?? [];
  const segs = idx.map((i) => fs.segments[i]);
  let oldLen = idx.length - 1;
  for (const sg of segs) oldLen += sg?.len ?? 0;
  const runs = changeRuns(pc);
  if (runs.length === 0) return oldLen === piece.length ? "none" : "structural";
  let d = 0;
  for (const r of runs) d += r.d;
  if (oldLen + d !== piece.length) return "structural";
  const ctx = scanCtxOf(w, fs.tree);
  const subs = newSubs(pc.delta, segs[0]?.depth ?? SUBFLOW_DEPTH_CAP);
  const splices: Splice[] = [];
  const shifted: [number, Segment][] = [];
  let base = 0; // storage length change of the piece's segments before this one
  let ri = 0;
  let si = 0; // the next new sub-flow item (each lies in its run's segment)
  for (const [k, os] of segs.entries()) {
    const o1 = idx[k];
    if (os === undefined || o1 === undefined) return "structural";
    const mine: Run[] = [];
    for (let r = runs[ri]; r !== undefined && r.ob <= os.start + os.len; r = runs[++ri]) {
      if (r.oa < os.start) return "structural";
      mine.push(r);
    }
    if (mine.length === 0) {
      if (base !== 0) shifted.push([o1, { ...os, start: os.start + base }]);
      continue;
    }
    let dSeg = 0;
    for (const r of mine) dSeg += r.d;
    const ns = os.start + base;
    const s0 = si;
    while (subs[si] !== undefined && (subs[si]?.at ?? 0) < ns + os.len + dSeg) si++;
    const sp = segmentSplice(piece, os, o1, mine, ns, dSeg, subs.slice(s0, si), ctx);
    if (sp === null) return "structural";
    splices.push(sp);
    base += dSeg;
  }
  return ri < runs.length || si < subs.length ? "structural" : { splices, shifted };
}

/**
 * One segment's splice: each change run widens to whole entities (after the last terminator ending at or before it,
 * through the first terminator starting at or after its end); windows that overlap or touch merge. `ns`: the segment's
 * new start, `dSeg` its length change, `subs` the new sub-flow items in it.
 */
function segmentSplice(piece: Y.Text, os: Segment, o1: number, runs: readonly Run[], ns: number, dSeg: number, subs: readonly NewSub[], ctx: ScanCtx): Splice | null {
  const toks = os.tokens;
  const n = toks.length;
  // Token start offsets (segment-relative), the last terminator before each index, the first at or after it.
  const offs: number[] = [0];
  const prevTerm: number[] = [-1];
  for (let i = 0, pos = 0, last = -1; i < n; i++) {
    const t = toks[i];
    if (t === undefined) return null;
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
  // Each window's new storage range, cut at the new sub-flow items in it: its parts, scanned in one walk of the piece.
  const parts: [number, number][] = [];
  const cuts: number[] = []; // per window, its number of parts
  let si = 0;
  let shift = 0; // storage length change of the windows so far
  for (const wn of wins) {
    let from = ns + off(wn.start) + shift;
    const to = ns + wn.iR + shift + wn.d;
    let k = 1;
    for (let sub = subs[si]; sub !== undefined && sub.at < to; sub = subs[++si], k++) {
      if (sub.at < from) return null; // defensive: every new sub-flow item is inside a window
      parts.push([from, sub.at]);
      from = sub.at + 1;
    }
    parts.push([from, to]);
    cuts.push(k);
    shift += wn.d;
  }
  if (si < subs.length) return null; // defensive, as above
  const scanned = scanRanges(piece, parts, ctx, os.depth);
  if (scanned === null) return null;
  // The new segments: the open one (`cur` from `curStart`) closes at each new sub-flow item, whose pieces' segments
  // follow it (as `flattenPiece` reads them).
  const segs: Segment[] = [];
  let cur: Token[] = [];
  let curStart = ns;
  const windows: Window[] = [];
  let pi = 0; // the next part
  let sj = 0; // the next new sub-flow item
  let prevEnd = 0;
  for (const [i, wn] of wins.entries()) {
    for (let j = prevEnd; j < wn.start; j++) {
      const t = toks[j];
      if (t !== undefined) cur.push(t);
    }
    const pStart = segs.length;
    const startNew = cur.length;
    for (let k = (cuts[i] ?? 1) - 1; k > 0; k--) {
      cur.push(...(scanned[pi++] ?? []));
      const sub = subs[sj++];
      if (sub === undefined) return null;
      segs.push({ piece, depth: os.depth, start: curStart, len: sub.at - curStart, tokens: cur });
      for (const p of subflowPieces(sub.map)) flattenPiece(p, ctx, segs, os.depth + 1);
      cur = [];
      curStart = sub.at + 1;
    }
    // The closing terminator is outside the runs, so it must rescan as the window's last token.
    const fresh = scanned[pi++] ?? [];
    const lastFresh = fresh[fresh.length - 1];
    if (wn.closed && (lastFresh === undefined || !isTerminator(lastFresh))) return null;
    cur.push(...fresh);
    windows.push({ startOld: wn.start, startNew, pStart, endOld: wn.endOld, endNew: cur.length, pEnd: segs.length, closed: wn.closed });
    prevEnd = wn.endOld;
  }
  for (let j = prevEnd; j < n; j++) {
    const t = toks[j];
    if (t !== undefined) cur.push(t);
  }
  segs.push({ piece, depth: os.depth, start: curStart, len: ns + os.len + dSeg - curStart, tokens: cur });
  return { o1, o2: o1 + 1, segs, windows };
}
