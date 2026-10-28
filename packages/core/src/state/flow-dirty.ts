/**
 * Transaction → dirty blocks, O(changed + touched
 * paragraphs; a section-end change: + the sections around it):
 *   - CONTENT tier: a new / deleted character, inline embed or format → its owning
 *     paragraph (the one whose ¶ follows it). A run terminated by a ¶ changes no link
 *     (every keystroke, local or remote). Only a run with no ¶ before the next object /
 *     the flow end (an implicit paragraph) has a gap bit: its appearing / vanishing is
 *     structural.
 *   - STRUCTURAL tier: a boundary item p (¶, section-end, object) inserted or deleted
 *     → the entity it ends, the entity owning p's position now, the entity ending at
 *     the boundary before p (its next link) and the entity after p (its prev link),
 *     each with its links. A section-end p re-parents exactly the entities between
 *     the previous section-end and the next one; those, the sections around p and the
 *     root are dirty.
 *   - Registry `keysChanged` → that block (attrs / type / ¶ keys); grid fields → the
 *     table, its rows and cells.
 * The previous-version side (blocks renamed or gone, the links that named them) comes
 * from the transaction's exact mapping (`tx-mapping.ts` `touched`). The content tier and
 * changed entries are dirty outright; the structural neighbourhoods and the mapping's
 * ids are CANDIDATES, dirty only when their record differs between the two
 * versions, so an untouched neighbour keeps its snapshot.
 */
import * as Y from "yjs";
import type { BlockId } from "./block-id";
import { asBlockId } from "./block-id";
import { getRegistry, entryShape, entryString, entryIdArray, entryFlow } from "./registry";
import { isBreakTagKey } from "./break-tags";
import { reconcileTransaction, transactionStructs, liveMarks, getMarkIndex, rawEntryShape } from "./mark-index";
import { isPiece, markOf, inDeletedFlow, prevUnit, firstUnitOfFlow } from "./y-flow";
import { cachedOwnerOf } from "./locator";
import { inlineContentLength } from "./inline-content";
import { deepValueEqual } from "./attrs";
import { txMappingOf, prevCtxOf } from "./tx-mapping";
import {
  readCtx,
  deriveBlock,
  ownerOfUnit,
  eff,
  clen,
  entityOf,
  scanBack,
  scanFwd,
  nextU,
  prevU,
  sectionBoundaryId,
  finalSectionId,
  gridOf,
  liveRows,
  deriveRecord,
  parentOfRecord,
  sharingSectionMemos,
  holderOfItem,
  visibleHolder,
  type ReadCtx,
  type Eff,
  type BlockRecord,
} from "./flow-read";

/**
 * The dirty ids of one transaction: the definite tier (content owners, attr-only
 * ids) plus the CANDIDATES — the structural neighbourhoods above and the exact mapping's
 * previous-version side — kept only where the record actually differs between the two
 * versions (exact compare: presence, type, attrs, links, ¶ keys, tags, and content
 * moved across a boundary). Untouched neighbours keep their snapshot identity.
 */
/** Test probe: previous-version record compares run by the dirty derivation. */
export const dirtyCompareStats = { compares: 0 };

export function dirtyIdsFromFlows(doc: Y.Doc, tx: Y.Transaction): Set<BlockId> {
  getMarkIndex(doc);
  reconcileTransaction(doc, tx);
  const ctx = readCtx(doc);
  // Definite: ids whose content / own entry keys changed. Candidates: compared below.
  const dirty = new Set<string>();
  const out = new Set<string>();
  const reg = getRegistry(doc);
  const regType: unknown = reg;
  const { inserted, deleted } = transactionStructs(tx);
  const structural: Y.Item[] = [];
  const memo = new Map<Y.Item, string | null>();
  const registryIds = new Set<string>();
  // A registry change that can move a root-flow parent: a section / table / row / cell /
  // container entry (sections end at their ¶s; a grid entry changes a cell holder's
  // visible holder). A paragraph's or atomic object's entry moves no parent.
  let parentsMoved = false;
  const movesParents = (shape: unknown): boolean => shape !== undefined && shape !== "text" && shape !== "atomic";
  // Ids whose change touched only the entry's `type` / `attrs` / ¶ keys: no link changed.
  const attrOnlyIds = new Set<string>();

  const owner = (it: Y.Item): string | null => {
    const hit = memo.get(it);
    if (hit !== undefined) return hit;
    // A cached run resolves its owner in O(piece); otherwise walk to the boundaries.
    const cached = markOf(it) === null ? cachedOwnerOf(doc, it) : null;
    const o = cached === null ? ownerOfUnit(ctx, it) : null;
    const id = cached ?? (o === null ? null : o.id);
    memo.set(it, id);
    return id;
  };

  // Content owned by an implicit paragraph, and the live length this transaction
  // inserted into each such owner (to tell an implicit that appeared).
  const implicitContent: Y.Item[] = [];
  const insertedLen = new Map<string, number>();

  const visit = (it: Y.Item): void => {
    const parent = it.parent;
    if (isPiece(parent)) {
      const m = markOf(it);
      if (inDeletedFlow(it)) {
        if (m !== null) out.add(m.end);
        return;
      }
      if (m !== null) {
        structural.push(it);
        return;
      }
      const o = owner(it);
      if (o === null) return;
      dirty.add(o);
      if (o.endsWith("#i")) {
        implicitContent.push(it);
        if (!it.deleted) insertedLen.set(o, (insertedLen.get(o) ?? 0) + clen(ctx, it));
      }
      return;
    }
    // Registry side: climb to the entry key.
    let t: Y.AbstractType<unknown> | null = parent instanceof Y.AbstractType ? parent : null;
    let key: string | null = it.parentSub;
    if (t === regType) {
      if (key !== null) registryIds.add(key);
      if (movesParents(rawEntryShape(it))) parentsMoved = true;
      return;
    }
    // A ¶ revision key set / deleted directly on an entry: its own paragraph only.
    const entryItem = t?._item ?? null;
    if (entryItem !== null && entryItem.parent === regType && key !== null && isBreakTagKey(key)) {
      if (entryItem.parentSub !== null) attrOnlyIds.add(entryItem.parentSub);
      return;
    }
    let below: string | null = null;
    while (t !== null) {
      const ti: Y.Item | null = t._item;
      if (ti === null) return;
      const up = ti.parent;
      if (up === regType) {
        key = ti.parentSub;
        const sub = below ?? it.parentSub;
        if (key === null || isPiece(parent)) return;
        if (sub === "attrs" || sub === "type" || sub === "markAttrs") attrOnlyIds.add(key);
        else {
          registryIds.add(key);
          if (movesParents(rawEntryShape(ti))) parentsMoved = true;
        }
        return;
      }
      below = ti.parentSub;
      // Items inside a flow's pieces are handled above; a new piece / sub-flow changes nothing visible.
      if (ti.parentSub === "flow" || ti.parentSub === "pieces") return;
      t = up instanceof Y.AbstractType ? up : null;
    }
  };
  for (const it of inserted) visit(it);
  for (const it of deleted) visit(it);

  const addWithLinks = (id: string | null): void => {
    if (id === null) return;
    out.add(id);
    const b = deriveBlock(ctx, id)?.block;
    if (b === undefined) return;
    if (b.prevSiblingId !== null) out.add(b.prevSiblingId);
    if (b.nextSiblingId !== null) out.add(b.nextSiblingId);
    if (b.parentId !== null && (b.prevSiblingId === null || b.nextSiblingId === null)) out.add(b.parentId);
  };
  /** The entities around a boundary change at `it` (live or a tombstone) in the current version. */
  const addAround = (it: Y.Item): void => {
    addWithLinks(owner(it));
    const before = scanBack(ctx, it).e;
    if (before !== null) {
      addWithLinks(entityOf(ctx, before));
      addWithLinks(`${entityOf(ctx, before)}#i`);
    } else {
      // No boundary before `it`: the holder start stands for it — its implicit run.
      const h = holderOfItem(it);
      if (h !== null) addWithLinks(`${visibleHolder(ctx, h)}#i`);
    }
    const after = scanFwd(ctx, it).e;
    if (after !== null) addWithLinks(entityOf(ctx, after));
  };

  let sectionChanged = false;
  for (const it of structural) {
    const m = markOf(it);
    if (m === null) continue;
    out.add(m.end);
    for (const id of m.section === undefined ? [m.end] : [m.end, m.section]) {
      for (const live of liveMarks(doc, id)) {
        const e = eff(ctx, live);
        if (e !== null) addWithLinks(entityOf(ctx, e));
      }
    }
    addAround(it);
    const self = it.deleted ? null : eff(ctx, it);
    if (self !== null) {
      addWithLinks(entityOf(ctx, self));
      addWithLinks(`${entityOf(ctx, self)}#i`);
    }
    if (m.section !== undefined) {
      sectionChanged = true;
      out.add(m.section);
      addSectionRegion(ctx, it, out);
    }
  }
  // An implicit paragraph appears / vanishes with its content: a link change around it
  // (the entities before and after it, its parent). O(implicit paragraph) for an edit
  // inside one; the neighbour walk only on a flip.
  const deletedSet = new Set<Y.Item>(deleted);
  const ownedBefore = (it: Y.Item): boolean => {
    for (let u = prevUnit(it); u !== null; u = prevUnit(u)) {
      if (markOf(u) === null) continue;
      if (deletedSet.has(u)) return false;
      if (eff(ctx, u) !== null) return true;
    }
    return true;
  };
  const flipped = new Set<string>();
  for (const it of implicitContent) {
    const o = owner(it);
    if (o === null || flipped.has(o)) continue;
    const d = deriveBlock(ctx, o);
    if (d !== null) {
      if (d.block.inlineContent !== null && (insertedLen.get(o) ?? 0) < inlineContentLength(d.block.inlineContent)) continue;
    } else if (!it.deleted || !ownedBefore(it)) continue;
    flipped.add(o);
    addWithLinks(o);
    addAround(it);
    if (sectionOfRootItem(ctx, it, out)) sectionChanged = true;
  }
  // The record compare reads attrs / type / ¶ keys / `columnWidths` off the CURRENT
  // entries (a View versions only the identity derivations), so an entry whose own keys
  // changed is dirty without the compare.
  for (const id of attrOnlyIds) {
    dirty.add(id);
    if (registryIds.has(id)) continue;
    for (const live of liveMarks(doc, id)) {
      const e = eff(ctx, live);
      if (e !== null) dirty.add(entityOf(ctx, e));
    }
  }
  for (const id of registryIds) {
    // Dirty outright (its own keys changed); the entities linking to it are covered by
    // addWithLinks / addAround / the section region / the grid below.
    dirty.add(id);
    const entry = reg.get(id);
    for (const live of liveMarks(doc, id)) {
      const e = eff(ctx, live);
      if (e !== null) addWithLinks(entityOf(ctx, e));
      addAround(live);
      const lm = markOf(live);
      // The entry of a ¶ that ends a section decides whether that ¶ is a section boundary.
      if (lm?.section !== undefined) parentsMoved = true;
      if (lm?.section === id) {
        sectionChanged = true;
        addSectionRegion(ctx, live, out);
      }
    }
    if (entry === undefined) continue;
    const shape = entryShape(entry);
    if (shape === "table") addGrid(ctx, id, out);
    else if (shape === "row") addGrid(ctx, entryString(entry, "table") ?? "", out);
    else if (shape === "cell") {
      const row = entryString(entry, "row");
      const re = row === undefined ? undefined : reg.get(row);
      if (re !== undefined) addGrid(ctx, entryString(re, "table") ?? "", out);
    }
  }
  if (sectionChanged) out.add(ctx.rootId);

  // The exact compare over the candidates (both versions' neighbourhoods).
  const m = txMappingOf(doc, tx);
  for (const id of m.touched) out.add(id);
  for (const [id, bm] of m.blocks) {
    // Content moved across a boundary (a split / join / chain change): the blocks it left and entered.
    const seg = bm.segs[0];
    if (bm.segs.length === 1 && seg !== undefined && seg.id === id && seg.from === 0 && bm.hunks.length === 0) continue;
    dirty.add(id);
    for (const sg of bm.segs) if (sg.length > 0) dirty.add(sg.id);
  }
  // A root-flow parent is a function of the section-ends after it: with no section-end or
  // parent-moving entry change, an entity whose position item is unchanged keeps its
  // parent, and both versions have the same section-ends — the previous version reads
  // through the current version's warm section memos (its own would walk a section per
  // transaction).
  const parentsStable = !sectionChanged && !parentsMoved;
  const result = new Set<BlockId>();
  for (const id of dirty) result.add(asBlockId(id));
  let prev: ReadCtx | null = null;
  const seen = new Set<string>();
  const work = [...out];
  for (let id = work.pop(); id !== undefined; id = work.pop()) {
    if (seen.has(id)) continue;
    seen.add(id);
    // A definite-dirty id is in the result already, and its rename closure adds nothing:
    // its siblings, edge parent and children are candidates by the neighbourhood, mapping
    // (relink), region and grid rules; a non-edge parent's record does not change. So a
    // keystroke (local or remote) derives nothing in the previous version.
    if (dirty.has(id)) continue;
    dirtyCompareStats.compares++;
    prev ??= parentsStable ? sharingSectionMemos(prevCtxOf(doc, tx)) : prevCtxOf(doc, tx);
    const a = deriveRecord(prev, id);
    const b = deriveRecord(ctx, id);
    // Rename closure: an id present in ONE version only (renamed / appeared / gone) —
    // everything that links to it there re-reads, children included (their parentId names it).
    const only = a === null ? (b === null ? null : { r: b, v: ctx }) : b === null ? { r: a, v: prev } : null;
    if (only !== null) {
      const { block } = only.r;
      for (const l of [block.prevSiblingId, block.nextSiblingId, block.firstChildId, block.lastChildId]) if (l !== null) work.push(l);
      const p = block.parentId ?? (only.r.at === null ? null : parentOfRecord(only.v, only.r.at));
      if (p !== null) work.push(p);
      for (let c = block.firstChildId; c !== null; c = deriveRecord(only.v, c)?.block.nextSiblingId ?? null) {
        work.push(c);
      }
    }
    if (recordChanged(prev, ctx, a, b, parentsStable)) result.add(asBlockId(id));
  }
  return result;
}

function recordChanged(prev: ReadCtx, next: ReadCtx, a: BlockRecord | null, b: BlockRecord | null, parentsStable: boolean): boolean {
  if (a === null || b === null) return a !== b;
  if (a.tree !== b.tree || !deepValueEqual(a.block, b.block)) return true;
  if (a.at === null || b.at === null) return a.at !== b.at;
  if (parentsStable && a.at.x === b.at.x && a.at.holder === b.at.holder) return false;
  return parentOfRecord(prev, a.at) !== parentOfRecord(next, b.at);
}

/** A root-flow implicit run flipped at `it`: its section's first / last child may have changed. */
function sectionOfRootItem(ctx: ReadCtx, it: Y.Item, out: Set<string>): boolean {
  const o = ownerOfUnit(ctx, it);
  const parent = o === null ? null : (deriveBlock(ctx, o.id)?.block.parentId ?? null);
  if (parent === null || deriveBlock(ctx, parent)?.block.type !== "section") return false;
  out.add(parent);
  return true;
}

/** A grid change: the table, its rows, cells and each cell's children. */
function addGrid(ctx: ReadCtx, tableId: string, out: Set<string>): void {
  if (tableId === "") return;
  out.add(tableId);
  const g = gridOf(ctx, tableId);
  const t = ctx.reg.get(tableId);
  const allRows = t === undefined ? [] : (entryIdArray(t, "rows")?.toArray() ?? []);
  for (const r of allRows) {
    out.add(r);
    const re = ctx.reg.get(r);
    for (const c of re === undefined ? [] : (entryIdArray(re, "cells")?.toArray() ?? [])) out.add(c);
  }
  for (const r of liveRows(ctx, tableId)) {
    for (const gc of g?.byRow.get(r) ?? []) {
      out.add(gc.id);
      const d = deriveBlock(ctx, gc.id);
      if (d === null) continue;
      // Concatenation changes re-own the cell's children: dirty them all.
      for (let c = d.block.firstChildId; c !== null; ) {
        out.add(c);
        const cd = deriveBlock(ctx, c);
        c = cd === null ? null : cd.block.nextSiblingId;
      }
    }
  }
}

/**
 * A section-end `it` was inserted / deleted (or its section entry appeared / vanished):
 * every entity between the previous section-end and the next one changed parent (the
 * one inherent unbounded window — every layout engine re-paginates that section); the
 * sections ending there (and the final section) changed children / siblings.
 */
function addSectionRegion(ctx: ReadCtx, it: Y.Item, out: Set<string>): void {
  let start: Y.Item | null = null;
  for (let u = prevU(ctx, it); u !== null; u = prevU(ctx, u)) {
    const e = eff(ctx, u);
    if (e === null) continue;
    const s = sectionBoundaryId(ctx, e);
    if (s !== null) {
      out.add(s);
      start = u;
      break;
    }
  }
  let passed = it.deleted;
  for (let u = start === null ? firstOfRoot(ctx) : nextU(ctx, start); u !== null; u = nextU(ctx, u)) {
    if (u === it) passed = true;
    const e = eff(ctx, u);
    if (e === null) continue;
    addEntity(ctx, e, out);
    const s = u === it ? null : sectionBoundaryId(ctx, e);
    if (s !== null) {
      out.add(s);
      if (passed) return;
    }
  }
  out.add(finalSectionId(ctx));
}

function addEntity(ctx: ReadCtx, e: Eff, out: Set<string>): void {
  const id = entityOf(ctx, e);
  out.add(id);
  if (deriveBlock(ctx, `${id}#i`) !== null) out.add(`${id}#i`);
  const prev = deriveBlock(ctx, id)?.block.prevSiblingId ?? null;
  if (prev !== null) out.add(prev);
}

function firstOfRoot(ctx: ReadCtx): Y.Item | null {
  const root = ctx.reg.get(ctx.rootId);
  const flow = root === undefined ? null : entryFlow(root);
  return flow === null ? null : firstUnitOfFlow(flow);
}
