import * as Y from "yjs";
import { scanCtxOf } from "../derive/derive-flow";
import type { Working } from "../derive/working";
import type { FlowState } from "../document/types";
import { flattenPiece } from "../scan/flatten-piece";
import { scanRange } from "../scan/scan-range";
import { type Segment, isTerminator } from "../scan/tokens";
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

interface Hull {
  readonly oa: number;
  readonly ob: number;
  /** New length − old length. */
  readonly d: number;
}

function computeHull(pc: PieceChange): Hull | null {
  let oa = Infinity;
  let ob = -Infinity;
  let d = 0;
  let oldPos = 0;
  for (const op of pc.delta ?? []) {
    if (op.retain !== undefined) {
      if (op.attributes !== undefined) {
        oa = Math.min(oa, oldPos);
        ob = Math.max(ob, oldPos + op.retain);
      }
      oldPos += op.retain;
    } else if (op.insert !== undefined) {
      oa = Math.min(oa, oldPos);
      ob = Math.max(ob, oldPos);
      d += insertLength(op.insert);
    } else if (op.delete !== undefined) {
      oa = Math.min(oa, oldPos);
      ob = Math.max(ob, oldPos + op.delete);
      oldPos += op.delete;
      d -= op.delete;
    }
  }
  for (const item of pc.mapItems) {
    if (item.deleted) continue;
    const ni = indexOfItem(item);
    const o = ni === null ? null : newToOld(pc.delta, ni);
    if (o === null) continue;
    oa = Math.min(oa, o);
    ob = Math.max(ob, o + 1);
  }
  return oa === Infinity ? null : { oa, ob, d };
}


/**
 * A splice of a flow's segment list: old segments `[o1, o2)` become `segs`. Tokens
 * changed from token `start` of the first segment (the same in old and new) to
 * `endOld` / `endNew` (exclusive) of the last old / new segment. `closed`: the
 * window ends with an UNCHANGED terminator (the delta path found one past the hull),
 * which is the region's right anchor.
 */
export interface Splice {
  readonly o1: number;
  readonly o2: number;
  readonly segs: readonly Segment[];
  readonly start: number;
  readonly endOld: number;
  readonly endNew: number;
  readonly closed: boolean;
}

/** Insert new segments before old segment `at`. */
export function insertion(at: number, segs: readonly Segment[]): Splice {
  return { o1: at, o2: at, segs, start: 0, endOld: 0, endNew: segs[segs.length - 1]?.tokens.length ?? 0, closed: false };
}

/** Replace a piece's whole subtree (its segments and its sub-flows' segments). */
export function subtreeSplice(fs: FlowState, piece: Y.Text, w: Working): Splice | null {
  const idx = fs.segIndex.get(piece);
  const o1 = idx?.[0];
  const oLast = idx?.[idx.length - 1];
  if (o1 === undefined || oLast === undefined) return null;
  const segs = flattenPiece(piece, scanCtxOf(w, fs.tree), [], fs.segments[o1]?.depth ?? 0);
  return { o1, o2: oLast + 1, segs, start: 0, endOld: fs.segments[oLast]?.tokens.length ?? 0, endNew: segs[segs.length - 1]?.tokens.length ?? 0, closed: false };
}

type DeltaResult = { readonly splice: Splice; readonly shifted: readonly [number, Segment][] } | "none" | "structural";

/** Rescan the one segment a piece's delta falls in; "structural" when it is not one segment's. */
export function deltaSplice(fs: FlowState, piece: Y.Text, pc: PieceChange, w: Working): DeltaResult {
  const idx = fs.segIndex.get(piece) ?? [];
  const segs = idx.map((i) => fs.segments[i]);
  let oldLen = idx.length - 1;
  for (const sg of segs) oldLen += sg?.len ?? 0;
  const hull = computeHull(pc);
  if (hull === null) return oldLen === piece.length ? "none" : "structural";
  if (oldLen + hull.d !== piece.length) return "structural";
  // The one segment holding the hull (an insertion at a segment's end belongs to it).
  const k = segs.findIndex((sg) => sg !== undefined && sg.start <= hull.oa && hull.ob <= sg.start + sg.len);
  const os = segs[k];
  const o1 = idx[k];
  if (os === undefined || o1 === undefined) return "structural";
  const oa = hull.oa - os.start;
  const ob = hull.ob - os.start;
  const toks = os.tokens;
  // Left: after the last terminator ending at or before oa.
  let start = 0;
  let iL = 0;
  let pos = 0;
  let i = 0;
  for (; i < toks.length; i++) {
    const t = toks[i];
    if (t === undefined || pos + t.len > oa) break;
    pos += t.len;
    if (isTerminator(t)) {
      start = i + 1;
      iL = pos;
    }
  }
  // Right: through the first terminator starting at or after ob.
  pos = iL;
  let endOld = toks.length;
  let iR = os.len;
  let closed = false;
  for (i = start; i < toks.length; i++) {
    const t = toks[i];
    if (t === undefined) break;
    if (isTerminator(t) && pos >= ob) {
      endOld = i + 1;
      iR = pos + t.len;
      closed = true;
      break;
    }
    pos += t.len;
  }
  const fresh = scanRange(piece, os.start + iL, os.start + iR + hull.d, scanCtxOf(w, fs.tree), os.depth);
  if (fresh === null) return "structural";
  // The closing terminator is outside the hull, so it must rescan as the window's last token.
  const lastFresh = fresh[fresh.length - 1];
  if (closed && (lastFresh === undefined || !isTerminator(lastFresh))) return "structural";
  const seg: Segment = { piece, depth: os.depth, start: os.start, len: os.len + hull.d, tokens: [...toks.slice(0, start), ...fresh, ...toks.slice(endOld)] };
  const shifted: [number, Segment][] = [];
  if (hull.d !== 0) {
    for (let j = k + 1; j < segs.length; j++) {
      const sg = segs[j];
      const at = idx[j];
      if (sg !== undefined && at !== undefined) shifted.push([at, { ...sg, start: sg.start + hull.d }]);
    }
  }
  return { splice: { o1, o2: o1 + 1, segs: [seg], start, endOld, endNew: start + fresh.length, closed }, shifted };
}
