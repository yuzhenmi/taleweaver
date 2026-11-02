/**
 * Incremental derivation of one flow from Yjs change reports (core-architecture D5
 * amendment: `observeDeep` deltas, unknown → full re-derive).
 *
 * Per changed piece, the text delta (and the positions of changed embedded maps)
 * give a HULL in the piece's old index space. The hull widens to whole entities —
 * from after the last terminator before it to the first terminator at or after its
 * end, crossing into neighbouring pieces when the piece has none — and only that
 * REGION is re-grouped and its records rewritten; neighbours get their sibling /
 * container links patched.
 *
 * A flow reads as SEGMENTS (`scan.ts`): every piece, nested sub-flow pieces included,
 * is rescanned on its own delta. A change a single segment cannot absorb — a
 * sub-flow item inserted / deleted / re-kinded, an unrecognised change — rebuilds that
 * piece's subtree (its segments + its sub-flows'). New pieces of any piece array (the
 * flow's or a sub-flow's) are scanned and spliced in next to their existing siblings.
 *
 * Fallbacks to a from-scratch derivation of the flow (all correct, just O(flow)):
 *   - a piece removed from the flow array, or a changed piece the flow state does not know;
 *   - an `[S]` in a non-body flow (as an anchor or inside the region);
 *   - a flow that is synthetic (R17) or whose region empties it;
 *   - overlapping splices, an anchor whose old record is missing, a section list the
 *     region's old `[S]` cannot be found in (defensive: not produced by any known write).
 * ponytail: several dirty pieces in one transaction form ONE region spanning them all.
 */
import * as Y from "yjs";
import type { BlockId } from "./block";
import {
  type BlockEntity,
  type Entity,
  type FlowState,
  type Working,
  deriveFlow,
  deriveFootnote,
  scanCtxOf,
  group,
  indexSegments,
  piecesOf,
  removeFlow,
  sectionRecord,
  writeSections,
  type SectionInfo,
  segmentsOf,
  writeSegment,
} from "./derive";
import { footnoteBodyId, sectionIdOf } from "./ids";
import { SUBFLOW_DEPTH_CAP, pieceHoldingSubflow } from "./storage";
import { flattenPiece, scanRange, type FootnoteRef, type Segment, type TerminatorToken, type Token } from "./scan";

export interface DeltaOp {
  readonly insert?: unknown;
  readonly delete?: number;
  readonly retain?: number;
  readonly attributes?: unknown;
}

export interface PieceChange {
  /** Rebuild the piece's whole subtree (an unrecognised change inside it). */
  full: boolean;
  delta: readonly DeltaOp[] | null;
  /** Embedded items (¶, object, …) whose map keys changed. */
  readonly mapItems: Y.Item[];
}

export interface FlowChange {
  /** The flow's own (top-level) piece array changed. */
  arrayChanged: boolean;
  /** Sub-flow piece arrays that changed (their owning piece's subtree is rebuilt). */
  readonly subArrays: Set<Y.Array<Y.Text>>;
  /** Every changed piece, top-level or nested. */
  readonly pieces: Map<Y.Text, PieceChange>;
}

/** A from-scratch re-derivation of an existing flow. */
export function rederiveFlow(w: Working, fs: FlowState): void {
  removeFlow(w, fs.holderId);
  deriveFlow(w, fs.holderId, fs.tree, fs.array, fs.isRoot);
}

/**
 * Sub-flow depth of a piece array's pieces (0 = a holder's flow), counted up to
 * SUBFLOW_DEPTH_CAP + 1. A bounded loop: no recursion on peer-controlled nesting.
 */
function arrayDepth(arr: Y.Array<Y.Text>): number {
  let d = 0;
  for (let p = pieceHoldingSubflow(arr); p !== null && d <= SUBFLOW_DEPTH_CAP; ) {
    d++;
    const parent = p._item?.parent;
    p = parent instanceof Y.Array ? pieceHoldingSubflow(parent) : null;
  }
  return d;
}

/** A piece's sub-flow depth when it is within the read cap, else null (inert, or detached). */
function pieceDepthOrNull(piece: Y.Text): number | null {
  const parent = piece._item?.parent;
  if (!(parent instanceof Y.Array)) return null;
  const d = arrayDepth(parent);
  return d > SUBFLOW_DEPTH_CAP ? null : d;
}

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

const isTerminator = (t: Token): t is TerminatorToken => t.k !== "run";

/**
 * A splice of a flow's segment list: old segments `[o1, o2)` become `segs`. Tokens
 * changed from token `start` of the first segment (the same in old and new) to
 * `endOld` / `endNew` (exclusive) of the last old / new segment. `closed`: the
 * window ends with an UNCHANGED terminator (the delta path found one past the hull),
 * which is the region's right anchor.
 */
interface Splice {
  readonly o1: number;
  readonly o2: number;
  readonly segs: readonly Segment[];
  readonly start: number;
  readonly endOld: number;
  readonly endNew: number;
  readonly closed: boolean;
}

/** Insert new segments before old segment `at`. */
function insertion(at: number, segs: readonly Segment[]): Splice {
  return { o1: at, o2: at, segs, start: 0, endOld: 0, endNew: segs[segs.length - 1]?.tokens.length ?? 0, closed: false };
}

/** Replace a piece's whole subtree (its segments and its sub-flows' segments). */
function subtreeSplice(fs: FlowState, piece: Y.Text, w: Working): Splice | null {
  const idx = fs.segIndex.get(piece);
  const o1 = idx?.[0];
  const oLast = idx?.[idx.length - 1];
  if (o1 === undefined || oLast === undefined) return null;
  const segs = flattenPiece(piece, scanCtxOf(w, fs.tree), [], fs.segments[o1]?.depth ?? 0);
  return { o1, o2: oLast + 1, segs, start: 0, endOld: fs.segments[oLast]?.tokens.length ?? 0, endNew: segs[segs.length - 1]?.tokens.length ?? 0, closed: false };
}

type DeltaResult = { readonly splice: Splice; readonly shifted: readonly [number, Segment][] } | "none" | "structural";

/** Rescan the one segment a piece's delta falls in; "structural" when it is not one segment's. */
function deltaSplice(fs: FlowState, piece: Y.Text, pc: PieceChange, w: Working): DeltaResult {
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

// ---------------------------------------------------------------------------
// Flow level
// ---------------------------------------------------------------------------

interface Pos {
  readonly p: number;
  readonly t: number;
}
interface Anchor extends Pos {
  readonly tok: TerminatorToken;
}

/** Tokens strictly after `from` (null = flow start) up to and including `to` (null = flow end). */
function* between(scans: readonly Segment[], from: Pos | null, to: Pos | null): Generator<Token> {
  let t = from === null ? 0 : from.t + 1;
  for (let p = from === null ? 0 : from.p; p < scans.length; p++, t = 0) {
    const toks = scans[p]?.tokens ?? [];
    for (; t < toks.length; t++) {
      const tok = toks[t];
      if (tok !== undefined) yield tok;
      if (to !== null && p === to.p && t === to.t) return;
    }
  }
}

function leftAnchor(scans: readonly Segment[], p0: number, t0: number): Anchor | null {
  for (let p = p0; p >= 0; p--) {
    const toks = scans[p]?.tokens ?? [];
    for (let t = p === p0 ? t0 : toks.length - 1; t >= 0; t--) {
      const tok = toks[t];
      if (tok !== undefined && isTerminator(tok)) return { p, t, tok };
    }
  }
  return null;
}

function rightAnchor(scans: readonly Segment[], p0: number, t0: number): Anchor | null {
  for (let p = p0; p < scans.length; p++) {
    const toks = scans[p]?.tokens ?? [];
    for (let t = p === p0 ? t0 : 0; t < toks.length; t++) {
      const tok = toks[t];
      if (tok !== undefined && isTerminator(tok)) return { p, t, tok };
    }
  }
  return null;
}

const footnotesOf = (ents: readonly Entity[]): Map<string, FootnoteRef> => {
  const m = new Map<string, FootnoteRef>();
  for (const e of ents) if (e.k === "para") for (const f of e.footnotes) m.set(f.id, f);
  return m;
};

const sectionBreakIds = (ents: readonly Entity[]): string => ents.filter((e) => e.k === "S").map((e) => e.id).join("\n");

/** Apply one flow's changes to the working state. */
export function updateFlow(w: Working, holderId: BlockId, ch: FlowChange): void {
  const fs = w.flows.get(holderId);
  if (fs === undefined || w.fresh.has(holderId)) return;
  if (fs.synthetic) return rederiveFlow(w, fs);
  const oldScans = fs.segments;

  // 1. Splices: whole subtrees (structural changes, new top-level pieces) and single-segment deltas.
  const structural = new Set<Y.Text>();
  for (const [piece, pc] of ch.pieces) if (pc.full && (fs.segIndex.has(piece) || pieceDepthOrNull(piece) !== null)) structural.add(piece);
  const deltas: { splice: Splice; shifted: readonly [number, Segment][] }[] = [];
  for (const [piece, pc] of ch.pieces) {
    if (structural.has(piece)) continue;
    if (!fs.segIndex.has(piece)) {
      if (pieceDepthOrNull(piece) === null) continue; // inside an inert sub-flow: not read
      if (!ch.arrayChanged && ch.subArrays.size === 0) return rederiveFlow(w, fs);
      continue; // a new piece: scanned with its array's change
    }
    const r = deltaSplice(fs, piece, pc, w);
    if (r === "structural") structural.add(piece);
    else if (r !== "none") deltas.push(r);
  }
  const splices: Splice[] = [];
  for (const piece of structural) {
    const sp = subtreeSplice(fs, piece, w);
    if (sp === null) return rederiveFlow(w, fs);
    splices.push(sp);
  }
  // New pieces of a changed array (the flow's or a sub-flow's) go before the array's
  // next existing piece, or after the subtree of its last existing piece.
  const arrays: Y.Array<Y.Text>[] = [...ch.subArrays];
  if (ch.arrayChanged && fs.array !== null) arrays.push(fs.array);
  for (const arr of arrays) {
    const depth = arrayDepth(arr);
    if (depth > SUBFLOW_DEPTH_CAP) continue; // inside an inert sub-flow: not read
    const pieces = piecesOf(arr);
    const live = new Set(pieces);
    for (const sg of oldScans) if (sg.piece._item?.parent === arr && !live.has(sg.piece)) return rederiveFlow(w, fs);
    let pending: Segment[] = [];
    let lastExisting: Y.Text | null = null;
    for (const piece of pieces) {
      const at = fs.segIndex.get(piece)?.[0];
      if (at === undefined) {
        flattenPiece(piece, scanCtxOf(w, fs.tree), pending, depth);
        continue;
      }
      lastExisting = piece;
      if (pending.length > 0) {
        splices.push(insertion(at, pending));
        pending = [];
      }
    }
    if (pending.length === 0) continue;
    const tail = lastExisting === null ? undefined : fs.segIndex.get(lastExisting);
    const end = tail?.[tail.length - 1];
    if (end !== undefined) splices.push(insertion(end + 1, pending));
    else if (arr === fs.array) splices.push(insertion(0, pending));
    else {
      // A sub-flow with no known piece: rebuild the piece holding it.
      const owner = arr._item?.parent;
      const holderPiece = owner instanceof Y.Map ? owner._item?.parent : undefined;
      const sp = holderPiece instanceof Y.Text ? subtreeSplice(fs, holderPiece, w) : null;
      if (sp === null) return rederiveFlow(w, fs);
      splices.push(sp);
    }
  }
  // Drop splices inside a wider one: a nested piece's subtree, or a sub-flow insertion,
  // inside a rebuilt subtree.
  const inside = (a: Splice, b: Splice): boolean =>
    b !== a && b.o2 > b.o1 && (a.o2 > a.o1 ? b.o1 <= a.o1 && a.o2 <= b.o2 && b.o2 - b.o1 > a.o2 - a.o1 : b.o1 < a.o1 && a.o1 < b.o2);
  const wide = splices.filter((a) => !splices.some((b) => inside(a, b)));
  const shifted = new Map<number, Segment>();
  for (const d of deltas) {
    if (wide.some((b) => b.o1 <= d.splice.o1 && d.splice.o2 <= b.o2 && b.o2 > b.o1)) continue;
    wide.push(d.splice);
    for (const [i, sg] of d.shifted) shifted.set(i, sg);
  }
  wide.sort((a, b) => a.o1 - b.o1 || a.o2 - b.o2);
  for (let i = 1; i < wide.length; i++) {
    const prev = wide[i - 1];
    const cur = wide[i];
    if (prev !== undefined && cur !== undefined && cur.o1 < prev.o2) return rederiveFlow(w, fs);
  }
  const first = wide[0];
  const last = wide[wide.length - 1];
  if (first === undefined || last === undefined) return;

  // 2. The new segment list.
  const sameShape = wide.every((sp) => sp.o2 - sp.o1 === sp.segs.length) && structural.size === 0;
  let newScans: Segment[];
  const n1s: number[] = [];
  if (sameShape) {
    // ponytail: copies the segment-pointer array (segments ≈ flow structs / PIECE_SOFT_MAX); a persistent vector if it shows.
    newScans = oldScans.slice();
    for (const [i, sg] of shifted) newScans[i] = sg;
    for (const sp of wide) {
      sp.segs.forEach((sg, j) => (newScans[sp.o1 + j] = sg));
      n1s.push(sp.o1);
    }
  } else {
    newScans = [];
    let o = 0;
    for (const sp of wide) {
      for (; o < sp.o1; o++) {
        const sg = shifted.get(o) ?? oldScans[o];
        if (sg !== undefined) newScans.push(sg);
      }
      n1s.push(newScans.length);
      newScans.push(...sp.segs);
      o = sp.o2;
    }
    for (; o < oldScans.length; o++) {
      const sg = shifted.get(o) ?? oldScans[o];
      if (sg !== undefined) newScans.push(sg);
    }
  }
  const newIdx = sameShape ? fs.segIndex : indexSegments(newScans);

  // 3. The region: from the terminator before the first splice to the one ending the last.
  const fN1 = n1s[0] ?? first.o1;
  const zN1 = n1s[n1s.length - 1] ?? last.o1;
  const zNLast = zN1 + last.segs.length - 1;
  const L = leftAnchor(newScans, fN1, first.start - 1);
  const closingTok = last.closed ? newScans[zNLast]?.tokens[last.endNew - 1] : undefined;
  const R: Anchor | null =
    closingTok !== undefined && isTerminator(closingTok)
      ? { p: zNLast, t: last.endNew - 1, tok: closingTok }
      : rightAnchor(newScans, zNLast, last.endNew);
  const growth = newScans.length - oldScans.length;
  const oldL: Pos | null = L;
  const oldR: Pos | null = R === null ? null : R.p === zNLast && last.closed ? { p: last.o2 - 1, t: last.endOld - 1 } : { p: R.p - growth, t: R.t };
  const oldEnts = group(between(oldScans, oldL, oldR), R === null, holderId, false);
  const newEnts = group(between(newScans, L, R), R === null, holderId);
  if (!fs.isRoot && (L?.tok.k === "S" || R?.tok.k === "S" || newEnts.some((e) => e.k === "S") || oldEnts.some((e) => e.k === "S"))) {
    return rederiveFlow(w, fs);
  }
  const sectionsChanged = fs.isRoot && sectionBreakIds(oldEnts) !== sectionBreakIds(newEnts);

  const tree = fs.tree;
  const prevBlockId = L !== null && L.tok.k !== "S" ? L.tok.id : null;
  const rEndsWithS = R !== null && R.tok.k === "S";
  let nextBlockId: BlockId | null = null;
  let trailingContainer: BlockId = fs.isRoot ? (fs.sections[fs.sections.length - 1]?.id ?? holderId) : holderId;
  if (R !== null && !rEndsWithS) {
    const rRec = w.get(tree, R.tok.id);
    if (rRec === undefined || rRec.parentId === null) return rederiveFlow(w, fs);
    nextBlockId = rRec.nextSiblingId;
    trailingContainer = rRec.parentId;
  }

  const { segments, breaks } = segmentsOf(newEnts);
  const m = breaks.length;
  const containerOf = (j: number): BlockId => {
    const brk = breaks[j];
    return j < m && brk !== undefined ? sectionIdOf(brk.id) : trailingContainer;
  };

  // R4: the region's [S]s changed. Splice the section list, create the new sections,
  // and move the blocks before the region (back to the previous [S]) to their new section.
  let sections = fs.sections;
  const removedSections: BlockId[] = [];
  if (sectionsChanged) {
    const oldS = oldEnts.filter((e) => e.k === "S").map((e) => sectionIdOf(e.id));
    const newS: SectionInfo[] = breaks.map((b) => ({ id: sectionIdOf(b.id), map: b.map }));
    const at = sections.findIndex((x) => x.id === (oldS[0] ?? trailingContainer));
    if (at < 0) return rederiveFlow(w, fs);
    sections = [...sections.slice(0, at), ...newS, ...sections.slice(at + oldS.length)];
    const kept = new Set(newS.map((x) => x.id));
    for (const id of oldS) if (!kept.has(id)) removedSections.push(id);
    for (const x of newS) if (w.get(tree, x.id) === undefined) w.put(tree, sectionRecord(x.id, holderId));
    if (prevBlockId !== null) {
      const from = w.get(tree, prevBlockId)?.parentId ?? null;
      const to = containerOf(0);
      if (from === null) return rederiveFlow(w, fs);
      if (from !== to) {
        let firstMoved: BlockId = prevBlockId;
        for (let id: BlockId | null = prevBlockId; id !== null; ) {
          const b = w.get(tree, id);
          if (b === undefined || b.parentId !== from) break;
          w.put(tree, Object.freeze({ ...b, parentId: to }));
          firstMoved = id;
          id = b.prevSiblingId;
        }
        w.patch(tree, to, { firstChildId: firstMoved });
      }
    }
  }

  // Footnote bodies anchored in the region.
  const oldFn = footnotesOf(oldEnts);
  const newFn = footnotesOf(newEnts);
  for (const id of oldFn.keys()) if (!newFn.has(id)) removeFlow(w, footnoteBodyId(id));

  // [S] entities are not block records (their section is `${id}/section`): an item whose
  // `k` changed from ¶ / TOC to `[S]` keeps its id but loses its record.
  const newIds = new Set(newEnts.filter((e) => e.k !== "S").map((e) => e.id));
  for (const e of oldEnts) if (e.k !== "S" && !newIds.has(e.id)) w.del(tree, e.id);

  const lastSeg = rEndsWithS ? m - 1 : m;
  for (let j = 0; j <= lastSeg; j++) {
    const seg: readonly BlockEntity[] = segments[j] ?? [];
    const container = containerOf(j);
    const isTrailing = j === m;
    writeSegment(w, tree, seg, container, j === 0 ? prevBlockId : null, isTrailing ? nextBlockId : null);
    const firstId = seg[0]?.id ?? null;
    const lastId = seg[seg.length - 1]?.id ?? null;
    if (j > 0 || prevBlockId === null) w.patch(tree, container, { firstChildId: firstId ?? (isTrailing ? nextBlockId : null) });
    if (!isTrailing || R === null) w.patch(tree, container, { lastChildId: lastId ?? (j === 0 ? prevBlockId : null) });
    if (j === 0 && prevBlockId !== null) w.patch(tree, prevBlockId, { nextSiblingId: firstId ?? (isTrailing ? nextBlockId : null) });
    if (isTrailing && nextBlockId !== null) w.patch(tree, nextBlockId, { prevSiblingId: lastId ?? (j === 0 ? prevBlockId : null) });
  }

  for (const id of removedSections) w.del(tree, id);
  w.flows = w.flows.set(holderId, { ...fs, segments: newScans, segIndex: newIdx, sections });
  if (sectionsChanged) writeSections(w);
  for (const [id, f] of newFn) if (!oldFn.has(id)) deriveFootnote(w, f);

  // R17: only a region left with no block can have emptied the flow.
  const containers = newEnts.some((e) => e.k !== "S") ? [] : fs.isRoot ? sections.map((s) => s.id) : [holderId];
  if (containers.length > 0 && containers.every((c) => (w.get(tree, c)?.firstChildId ?? null) === null)) {
    const now = w.flows.get(holderId);
    if (now !== undefined) rederiveFlow(w, now);
  }
}
