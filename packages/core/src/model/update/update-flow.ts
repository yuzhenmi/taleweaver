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
 * A flow reads as SEGMENTS (`scan/`): every piece, nested sub-flow pieces included,
 * is rescanned on its own delta. A change a single segment cannot absorb — a
 * sub-flow item inserted / deleted / re-kinded, an unrecognised change — rebuilds that
 * piece's subtree (its segments + its sub-flows'). New pieces of any piece array (the
 * flow's or a sub-flow's) are scanned and spliced in next to their existing siblings.
 *
 * The region is parsed in its container (`parseRegion`), with the table marks at its ends read
 * by their faces (design §1); the marks it reads inert become inert run units, as from scratch.
 * Whole tables in it (inserted / deleted at any depth) are written with their forms.
 *
 * Fallbacks to a from-scratch derivation of the flow (all correct, just O(flow)):
 *   - a piece removed from the flow array, or a changed piece the flow state does not know;
 *   - an `[S]` in a non-body flow (as an anchor or inside the region);
 *   - a flow that is synthetic (R17) or whose region empties it;
 *   - a region not balanced in its container (`parseRegion`: a mark binding to an enclosing
 *     table, an `[S]` / `<end>` closing one, a table left open), holding a cell-less table's
 *     leads, in a table's / row's lead, emptying / filling an empty cell, or next to content its cell
 *     reads from outside its own marks (a lead, a cell past the width cap) (N2 steps 3–4 narrow these);
 *   - overlapping splices, an anchor whose old record is missing, a section list the
 *     region's old `[S]` cannot be found in (defensive: not produced by any known write).
 * ponytail: several dirty pieces in one transaction form ONE region spanning them all.
 */
import * as Y from "yjs";
import { BLOCK_TYPES, type BlockId } from "../block";
import { deriveFlow, deriveFootnote, parasOf, piecesOf, removeDescendants, removeFlow, scanCtxOf, segmentsOf, writeSegment } from "../derive/derive-flow";
import { type BlockEntity, type Entity, indexSegments, isBlockEntity, isSectionBreakEntity } from "../derive/entities";
import { withInertMarks } from "../derive/table/inert-marks";
import { type RegionEnd, parseRegion } from "../derive/table/parse-tables";
import { sectionRecord } from "../derive/records";
import { writeSections } from "../derive/sections";
import type { Working } from "../derive/working";
import type { FlowState, SectionInfo } from "../document/types";
import { footnoteBodyId, sectionIdOf } from "../ids";
import { flattenPiece } from "../scan/flatten-piece";
import { holdsFlows, isSectionBreak } from "../scan/kinds";
import { isObjectEnd } from "../position/table-extent";
import { type FootnoteRef, type Segment, depthOf, isTerminator, roleOf } from "../scan/tokens";
import { SUBFLOW_DEPTH_CAP } from "../storage/limits";
import { pieceHoldingSubflow } from "../storage/pieces";
import { type Anchor, type Pos, between, leftAnchor, rightAnchor } from "./anchors";
import type { FlowChange } from "./flow-change";
import { type Splice, deltaSplice, insertion, subtreeSplice } from "./piece-splice";
import { rowSplice } from "./row-splice";

/** A from-scratch re-derivation of an existing flow (a non-root holder keeps its record's type, attrs and links). */
export function rederiveFlow(w: Working, fs: FlowState): void {
  const old = fs.isRoot ? undefined : w.get(fs.tree, fs.holderId);
  removeFlow(w, fs.holderId);
  const holder =
    old === undefined
      ? undefined
      : { type: old.type, attrs: old.attrs, links: { parentId: old.parentId, prevSiblingId: old.prevSiblingId, nextSiblingId: old.nextSiblingId } };
  deriveFlow(w, fs.holderId, fs.tree, fs.array, fs.isRoot, holder);
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

const footnotesOf = (ents: readonly Entity[]): Map<string, FootnoteRef> => {
  const m = new Map<string, FootnoteRef>();
  for (const p of parasOf(ents)) for (const f of p.footnotes) m.set(f.id, f);
  return m;
};

const sectionBreakIds = (ents: readonly Entity[]): string => ents.filter(isSectionBreakEntity).map((e) => e.id).join("\n");

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
  // The faces of table marks at the region's ends (design §1): a `⟨c⟩` before it starts its cell; a `⟧` before it is
  // its table, a block object; a `⟦` after it is the table; any other mark after it ends the container. R is then not
  // in the region (it is unchanged: a changed item is always inside the hull).
  const tree = fs.tree;
  // Rung 0 declined: whole rows of an enclosing table (rung 1), else the flow.
  const fallback = (): void => {
    if (!rowSplice({ w, fs, newScans, newIdx, L, R })) rederiveFlow(w, fs);
  };
  const lRole = L !== null && holdsFlows(L.tok.k) ? roleOf(L.tok) : undefined;
  const rRole = R !== null && holdsFlows(R.tok.k) ? roleOf(R.tok) : undefined;
  // A region in a table's / row's lead: rung 1.
  // So does one starting in a cell-less table's lead (its records hang after the table, outside its bracket).
  if (lRole === "open" || lRole === "newRow" || lRole === null || rRole === null || (L !== null && fs.leadsAfter.has(L.tok.id))) return fallback();
  const lDepth = L === null || lRole === undefined ? null : depthOf(L.tok);
  const depth =
    lRole === "newCell" || lRole === "close"
      ? lDepth === null ? null : lDepth + (lRole === "newCell" ? 1 : 0)
      : L === null || isSectionBreak(L.tok.k) ? 0 : tableDepthOf(w, fs, L.tok.id);
  if (depth === null) return fallback();
  const end: RegionEnd = R === null ? null : rRole === undefined ? undefined : { id: R.tok.id, opens: rRole === "open", d: depthOf(R.tok) };
  // The region starts after L: a block object there reads its implicit paragraph (if any) in the region. (R is an
  // unchanged terminator past every change, and so is what follows it: its implicit paragraph, if any, stays.)
  const objectBefore = L !== null && isObjectEnd(L.tok) ? L.tok.id : null;
  const withR = rRole === undefined;
  const oldP = parseRegion(between(oldScans, oldL, oldR, withR), holderId, { depth, end, withItems: false, objectBefore });
  const newP = parseRegion(between(newScans, L, R, withR), holderId, { depth, end, objectBefore, rescanned: true });
  // An unbalanced region (a row / cell mark edit, concurrency strays) goes to rung 1; so does one holding a cell-less
  // table's leads (concurrency only: they read outside the bracket they are stored in).
  if (oldP === null || newP === null || oldP.leadsAfter.size > 0 || newP.leadsAfter.size > 0) return fallback();
  const oldEnts = oldP.ents;
  const newEnts = newP.ents;
  if (!fs.isRoot && (isSectionBreak(L?.tok.k) || isSectionBreak(R?.tok.k) || newEnts.some(isSectionBreakEntity) || oldEnts.some(isSectionBreakEntity))) {
    return fallback();
  }
  const sectionsChanged = fs.isRoot && sectionBreakIds(oldEnts) !== sectionBreakIds(newEnts);

  // The region's neighbours. At a mark face they are checked against the old records: content a container reads from
  // outside its own marks (a lead joining a cell, a cell past the width cap) re-derives (concurrency only).
  const oldBlocks = oldEnts.filter(isBlockEntity);
  const oldFirst = oldBlocks[0] === undefined ? undefined : w.get(tree, oldBlocks[0].id);
  const oldLast = oldBlocks[oldBlocks.length - 1];
  let prevBlockId = L !== null && !isSectionBreak(L.tok.k) ? L.tok.id : null;
  let cellStart: BlockId | null = null;
  if (lRole === "newCell" && L !== null) {
    if (w.get(tree, L.tok.id)?.type !== BLOCK_TYPES.tableCell || oldFirst === undefined || oldFirst.prevSiblingId !== null) return fallback();
    prevBlockId = null;
    cellStart = L.tok.id;
  } else if (lRole === "close") {
    // The previous sibling must be the table L closes, and not itself a cell-less table's lead (which reads outside it).
    const table = oldFirst?.prevSiblingId ?? null;
    if (table === null || fs.tables.get(table)?.closeId !== L?.tok.id || fs.leadsAfter.has(table)) return fallback();
    prevBlockId = table;
  }
  const rEndsWithS = R !== null && isSectionBreak(R.tok.k);
  let nextBlockId: BlockId | null = null;
  let endsContainer = false;
  let trailingContainer: BlockId = fs.isRoot ? (fs.sections[fs.sections.length - 1]?.id ?? holderId) : holderId;
  if (R !== null && rRole === "open") {
    const parent = w.get(tree, R.tok.id)?.parentId ?? null;
    if (parent === null || (cellStart !== null && parent !== cellStart)) return fallback();
    nextBlockId = R.tok.id;
    trailingContainer = parent;
  } else if (rRole !== undefined) {
    // A container end: the region's last old block (or L) is its container's last child.
    if (cellStart !== null && (oldLast === undefined || !newEnts.some(isBlockEntity))) return fallback(); // the cell reads `/empty`
    const lastId = oldLast?.id ?? prevBlockId;
    const lastRec = lastId === null ? undefined : w.get(tree, lastId);
    const container = cellStart ?? lastRec?.parentId ?? null;
    if (container === null || lastRec === undefined || lastRec.nextSiblingId !== null || lastRec.parentId !== container) return fallback();
    trailingContainer = container;
    endsContainer = true;
  } else if (R !== null && !rEndsWithS) {
    const rRec = w.get(tree, R.tok.id);
    if (rRec === undefined || rRec.parentId === null) return fallback();
    nextBlockId = rRec.nextSiblingId;
    trailingContainer = rRec.parentId;
  }
  // Marks the region reads inert become inert run units of its segments, as from scratch (`inert-marks.ts`). The stack
  // at the region's end is the old one, so no mark outside it changes binding.
  if (newP.inert.size > 0) {
    const p0 = L?.p ?? 0;
    const p1 = R?.p ?? newScans.length - 1;
    withInertMarks(newScans.slice(p0, p1 + 1), newP.inert).forEach((sg, i) => (newScans[p0 + i] = sg));
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
    const oldS = oldEnts.filter(isSectionBreakEntity).map((e) => sectionIdOf(e.id));
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
  const newIds = new Set(newEnts.filter(isBlockEntity).map((e) => e.id));
  for (const e of oldEnts) {
    // A whole table in the region: its old rows / cells / contents go (rewritten below when it stays).
    if (oldP.tables.has(e.id)) removeDescendants(w, tree, e.id, false);
    if (isBlockEntity(e) && !newIds.has(e.id)) w.del(tree, e.id);
  }

  const lastSeg = rEndsWithS ? m - 1 : m;
  for (let j = 0; j <= lastSeg; j++) {
    const seg: readonly BlockEntity[] = segments[j] ?? [];
    const container = containerOf(j);
    const isTrailing = j === m;
    writeSegment(w, tree, seg, container, j === 0 ? prevBlockId : null, isTrailing ? nextBlockId : null);
    const firstId = seg[0]?.id ?? null;
    const lastId = seg[seg.length - 1]?.id ?? null;
    if (j > 0 || prevBlockId === null) w.patch(tree, container, { firstChildId: firstId ?? (isTrailing ? nextBlockId : null) });
    if (!isTrailing || R === null || endsContainer) w.patch(tree, container, { lastChildId: lastId ?? (j === 0 ? prevBlockId : null) });
    if (j === 0 && prevBlockId !== null) w.patch(tree, prevBlockId, { nextSiblingId: firstId ?? (isTrailing ? nextBlockId : null) });
    if (isTrailing && nextBlockId !== null) w.patch(tree, nextBlockId, { prevSiblingId: lastId ?? (j === 0 ? prevBlockId : null) });
  }

  for (const id of removedSections) w.del(tree, id);
  let tables = fs.tables;
  for (const id of oldP.tables.keys()) tables = tables.delete(id);
  for (const [id, f] of newP.tables) tables = tables.set(id, f);
  w.flows = w.flows.set(holderId, { ...fs, segments: newScans, segIndex: newIdx, sections, tables });
  if (sectionsChanged) writeSections(w);
  for (const [id, f] of newFn) if (!oldFn.has(id)) deriveFootnote(w, f);

  // R17: only a region left with no block can have emptied the flow.
  const containers = newEnts.some(isBlockEntity) ? [] : fs.isRoot ? sections.map((s) => s.id) : [holderId];
  if (containers.length > 0 && containers.every((c) => (w.get(tree, c)?.firstChildId ?? null) === null)) {
    const now = w.flows.get(holderId);
    if (now !== undefined) rederiveFlow(w, now);
  }
}

/**
 * The nesting depth of record `id`'s container: its nearest enclosing table's parse depth + 1, 0 with none. The
 * depth comes from the parse, not the record chain: a cell-less table's leads hang after it, outside its bracket.
 * O(depth).
 */
function tableDepthOf(w: Working, fs: FlowState, id: BlockId): number {
  for (let p = w.get(fs.tree, id)?.parentId ?? null; p !== null; p = w.get(fs.tree, p)?.parentId ?? null) {
    const f = fs.tables.get(p);
    if (f !== undefined) return f.depth + 1;
  }
  return 0;
}
