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
 * Fallbacks to a from-scratch derivation of the flow (all correct, just O(flow)):
 *   - a piece removed from the flow array, or a changed piece the flow state does not know;
 *   - an `[S]` in a non-body flow (as an anchor or inside the region);
 *   - a flow that is synthetic (R17) or whose region empties it;
 *   - overlapping splices, an anchor whose old record is missing, a section list the
 *     region's old `[S]` cannot be found in (defensive: not produced by any known write).
 * ponytail: several dirty pieces in one transaction form ONE region spanning them all.
 */
import * as Y from "yjs";
import type { BlockId } from "../block";
import { deriveFlow, deriveFootnote, piecesOf, regridTable, removeFlow, removeTable, scanCtxOf, segmentsOf, writeSegment } from "../derive/derive-flow";
import { type BlockEntity, type Entity, type TableEntity, group, indexSegments, isBlockEntity, isParaEntity, isSectionBreakEntity, isTableEntity } from "../derive/entities";
import { sectionRecord } from "../derive/records";
import { writeSections } from "../derive/sections";
import type { Working } from "../derive/working";
import type { FlowState, SectionInfo } from "../document/types";
import { footnoteBodyId, sectionIdOf } from "../ids";
import { flattenPiece } from "../scan/flatten-piece";
import { isBlockObject, isSectionBreak } from "../scan/kinds";
import { type FootnoteRef, type Segment, isTerminator } from "../scan/tokens";
import { SUBFLOW_DEPTH_CAP } from "../storage/limits";
import { pieceHoldingSubflow } from "../storage/pieces";
import { type Anchor, type Pos, between, leftAnchor, rightAnchor } from "./anchors";
import type { FlowChange } from "./flow-change";
import { type Splice, deltaSplice, insertion, subtreeSplice } from "./piece-splice";

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
  for (const e of ents) if (isParaEntity(e)) for (const f of e.footnotes) m.set(f.id, f);
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
  // The region starts after L: a block object there reads its implicit paragraph (if any) in the region. (R is an
  // unchanged terminator past every change, and so is what follows it: its implicit paragraph, if any, stays.)
  const objectBefore = L !== null && isBlockObject(L.tok.k) ? L.tok.id : null;
  const oldEnts = group(between(oldScans, oldL, oldR), R === null, holderId, { withItems: false, objectBefore });
  const newEnts = group(between(newScans, L, R), R === null, holderId, { objectBefore });
  if (!fs.isRoot && (isSectionBreak(L?.tok.k) || isSectionBreak(R?.tok.k) || newEnts.some(isSectionBreakEntity) || oldEnts.some(isSectionBreakEntity))) {
    return rederiveFlow(w, fs);
  }
  const sectionsChanged = fs.isRoot && sectionBreakIds(oldEnts) !== sectionBreakIds(newEnts);

  const tree = fs.tree;
  const prevBlockId = L !== null && !isSectionBreak(L.tok.k) ? L.tok.id : null;
  const rEndsWithS = R !== null && isSectionBreak(R.tok.k);
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

  // Tables: a vanished one loses its rows / cells, a new one is read (both: kept, re-linked by writeSegment).
  const tablesOf = (ents: readonly Entity[]): Map<BlockId, TableEntity> => new Map(ents.filter(isTableEntity).map((e) => [e.id, e]));
  const oldTables = tablesOf(oldEnts);
  const newTables = tablesOf(newEnts);
  for (const id of oldTables.keys()) if (!newTables.has(id)) removeTable(w, id);
  for (const [id, e] of newTables) if (!oldTables.has(id)) regridTable(w, id, e.map, tree);

  // [S] entities are not block records (their section is `${id}/section`): an item whose
  // `k` changed from ¶ / TOC to `[S]` keeps its id but loses its record.
  const newIds = new Set(newEnts.filter(isBlockEntity).map((e) => e.id));
  for (const e of oldEnts) if (isBlockEntity(e) && !newIds.has(e.id)) w.del(tree, e.id);

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
  const containers = newEnts.some(isBlockEntity) ? [] : fs.isRoot ? sections.map((s) => s.id) : [holderId];
  if (containers.length > 0 && containers.every((c) => (w.get(tree, c)?.firstChildId ?? null) === null)) {
    const now = w.flows.get(holderId);
    if (now !== undefined) rederiveFlow(w, now);
  }
}
