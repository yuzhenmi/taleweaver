/**
 * Structural primitives over flows (schema 3, END marks). Every op is a
 * SEQUENCE edit — no op moves a character:
 *   - split = insert a ¶ at the cut (the HEAD gets the new id, the tail keeps B);
 *   - join = delete the left paragraph's ¶ (the survivor is the right paragraph);
 *   - remove = delete its content + item(s) (a leaf's registry entry survives; a
 *     container's entry is deleted — delete wins);
 *   - insert = content then ¶ per paragraph, one item per object (containers: entry +
 *     fresh flow, which always holds ≥ 1 ¶);
 *   - move = delete the source raw, then re-insert at the target items with the SAME
 *     ids + re-minted content (entries kept; a paragraph carries its section-end).
 *
 * INVARIANT I (Word / Google Docs: every story ends with a ¶, text belongs to a
 * ¶-terminated paragraph, a paragraph follows every table) is kept by exactly two
 * primitives and nothing else: {@link deleteUnits} (the only code deleting content /
 * ¶ / object items for an edit: it skips a ¶ whose deletion would break I) and
 * {@link insertItemsAt} (the only code placing items at a boundary / re-inserting
 * moved ones: it repairs I with a fresh ¶). Undo / redo and remote merges bypass them;
 * the read model's implicit paragraph covers what they leave (see `flow-read.ts`).
 *
 * Ops update the `MarkIndex` eagerly (composed in-tx steps see their own writes).
 * Piece / sub-flow items are never deleted.
 */
import * as Y from "yjs";
import type { BlockId } from "./block-id";
import { asBlockId, productionAllocator } from "./block-id";
import type { ReadonlyAttrs } from "./attrs";
import type { InlineContent, InlineItem } from "./inline-content";
import { spanValue } from "./table-cell-span";
import { toYAttributes, inlineItemsFromYText, snapRange } from "./y-inline";
import { bookmarksRemovedBy, deleteKeepingBookmarks, type DeletedPart } from "./bookmarks";
import { assertNoNestedYTypes } from "./y-utils";
import { deepValueEqual } from "./attrs";
import {
  getRegistry,
  buildEntry,
  entryShape,
  entryFlow,
  entryIdArray,
  entryString,
  entryMarkAttrsMap,
  type BlockShape,
  type TreeKind,
} from "./registry";
import { indexMark, unindexMark, canonicalMark, clearDerivedCaches } from "./mark-index";
import { noteMarkInserted, noteMarkDeleted, notePieceWrite, noteEntryChanged } from "./locator";
import {
  PIECE_SOFT_MAX,
  invalidatePiece,
  markOf,
  pieceOf,
  pieceIndexOf,
  pieceStructCount,
  firstUnitOfFlow,
  nextUnit,
  prevUnit,
  topPieces,
  topFlowOfPiece,
  type MarkContent,
} from "./y-flow";
import {
  readCtx,
  resolveEntity,
  regionOf,
  holderFlows,
  gridOf,
  deriveBlock,
  eff,
  clen,
  scanBack,
  chainForward,
  entityOf,
  attrsBefore,
  sectionBoundaryId,
  type ReadCtx,
  type Eff,
} from "./flow-read";
import { pointInRegion, sizedPoint, BlockText, blockText, type FlowPoint } from "./block-text";
import { storageShapeFor } from "./storage-shapes";
import { breakKeyOf, BREAK_TAG_KEYS, type BreakSuggestion } from "./break-tags";
import { markAttrsOfRun, inclusiveKeysOf } from "./mark-attrs";
import { deleteRowEntry, insertRowEntry, insertColumnEntry, liveColumns, freshColumnId } from "./table-storage";

// ---------------------------------------------------------------------------
// Tree input
// ---------------------------------------------------------------------------

/** A block subtree to write (ids preserved). */
export interface TreeNode {
  readonly id: BlockId;
  readonly type: string;
  readonly attrs: ReadonlyAttrs;
  readonly inlineContent: InlineContent | null;
  readonly children: readonly TreeNode[];
  /** Break-suggestion tags to store on the entry (codec / upgrade round-trips; never fragments). */
  readonly breakSuggestion?: BreakSuggestion;
  /** A text node's ¶ character props (upgrade: the last run's inclusive attrs). */
  readonly markAttrs?: ReadonlyAttrs;
}

/** The storage shape of node `n` (component registry, via the doc's bound resolver). */
export function shapeOfNode(doc: Y.Doc, n: TreeNode): BlockShape {
  return storageShapeFor(doc, { type: n.type, inline: n.inlineContent !== null, hasChildren: n.children.length > 0 });
}

function freshId(): string {
  return productionAllocator.allocate();
}

/** A derived read-model id (an implicit run): never a registry key. */
const isDerivedId = (id: string): boolean => id.endsWith("#i");

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Sequential writer at a flow point, applying the piece-size rule. */
export class FlowWriter {
  private count = -1;
  private cursor: Y.Item | null = null;
  /** The last boundary item this writer inserted. */
  lastItem: Y.Item | null = null;

  constructor(
    readonly doc: Y.Doc,
    public p: FlowPoint,
  ) {}

  private ensure(budget: number): void {
    if (this.count < 0) this.count = pieceStructCount(this.p.piece);
    if (this.count + budget <= PIECE_SOFT_MAX) return;
    const before = this.p.piece;
    this.p = sizedPoint(this.p, PIECE_SOFT_MAX);
    if (this.p.piece !== before) {
      this.count = 0;
      this.cursor = null;
    }
  }

  /** Insert a ¶ / object item here; returns its Item (indexed eagerly). */
  mark(content: MarkContent): Y.Item {
    this.ensure(3);
    const obj: MarkContent = {
      end: content.end,
      ...(content.section === undefined ? {} : { section: content.section }),
      ...(content.implicitOf === undefined ? {} : { implicitOf: content.implicitOf }),
    };
    this.p.piece.insertEmbed(this.p.index, obj, {});
    invalidatePiece(this.p.piece);
    this.count += 3;
    const item = this.find(obj);
    this.p = { piece: this.p.piece, index: this.p.index + 1 };
    indexMark(this.doc, item);
    noteMarkInserted(this.doc, item);
    this.lastItem = item;
    return item;
  }

  private find(obj: object): Y.Item {
    const scan = (from: Y.Item | null): Y.Item | null => {
      for (let it = from; it !== null; it = it.right) {
        if (it.content instanceof Y.ContentEmbed && it.content.embed === obj) return it;
      }
      return null;
    };
    const hit = scan(this.cursor ?? this.p.piece._start) ?? scan(this.p.piece._start);
    if (hit === null) throw new Error("flow: inserted mark not found");
    this.cursor = hit;
    return hit;
  }

  /** Insert inline items here (complete attrs each). */
  items(items: ReadonlyArray<InlineItem>): void {
    for (const item of items) {
      if (item.kind === "text") {
        if (item.text.length === 0) continue;
        this.ensure(3);
        this.p.piece.insert(this.p.index, item.text, toYAttributes(item.attrs));
        invalidatePiece(this.p.piece);
        notePieceWrite(this.doc, this.p.piece);
        this.p = { piece: this.p.piece, index: this.p.index + item.text.length };
      } else {
        this.ensure(3);
        for (const v of Object.values(item.properties)) assertNoNestedYTypes(v, "properties");
        this.p.piece.insertEmbed(this.p.index, { embedType: item.embedType, properties: { ...item.properties } }, toYAttributes(item.attrs));
        invalidatePiece(this.p.piece);
        notePieceWrite(this.doc, this.p.piece);
        this.p = { piece: this.p.piece, index: this.p.index + 1 };
      }
      this.count += 3;
    }
  }
}

/** Create the registry entry for a node. Returns it. */
function writeEntry(doc: Y.Doc, n: TreeNode, tree: TreeKind, shape: BlockShape, root = false): Y.Map<unknown> {
  const reg = getRegistry(doc);
  const e = buildEntry({ type: n.type, attrs: n.attrs, tree, shape, root, markAttrs: n.markAttrs });
  if (n.breakSuggestion !== undefined && shape === "text") {
    for (const [field, id] of Object.entries(n.breakSuggestion)) {
      if (typeof id === "string") e.set(breakKeyOf(field as keyof BreakSuggestion), id);
    }
  }
  reg.set(n.id, e);
  noteEntryChanged(doc, n.id);
  const got = reg.get(n.id);
  if (got === undefined) throw new Error("registry: entry not integrated");
  return got;
}

/** Register a new section entry (its end item is written by the op placing the break). */
export function writeSectionEntry(doc: Y.Doc, n: TreeNode): void {
  writeEntry(doc, n, "block", "section");
}

function entryAttrsMapOrThrow(e: Y.Map<unknown>): Y.Map<unknown> {
  const a = e.get("attrs");
  if (!(a instanceof Y.Map)) throw new Error("registry: entry has no attrs");
  return a as Y.Map<unknown>;
}

/** The first piece of a flow array. */
export function firstPiece(flow: Y.Array<Y.Text>): Y.Text {
  const p = topPieces(flow)[0];
  if (p === undefined) throw new Error("flow: no pieces");
  return p;
}

/** Write a FRESH empty paragraph's ¶ at `w` (invariant I's mandatory paragraph). */
function writeFreshPara(doc: Y.Doc, w: FlowWriter, tree: TreeKind, section?: string, markAttrs?: ReadonlyAttrs, implicitOf?: string): Y.Item {
  const id = freshId();
  writeEntry(doc, { id: asBlockId(id), type: "paragraph", attrs: {}, inlineContent: { items: [] }, children: [], markAttrs }, tree, "text");
  return w.mark({ end: id, section, implicitOf });
}

export interface WriteOptions {
  /**
   * Filling `holder`'s FRESH flow from its start (codec / builder round-trips): a
   * derived `#i` node coming back from a read model is written as the implicit run it
   * names (markless content) where storage would read it so.
   */
  readonly holder?: string | null;
  /** The node list ends at the flow end: a trailing object / an empty list gets its ¶. */
  readonly atFlowEnd?: boolean;
  /** The last top-level node's ¶ ends this section (an object / section last → a fresh ¶ does). */
  readonly sectionEnd?: string;
  /** Moved nodes (keep their entries; a paragraph re-inserts the section-end it carried). */
  readonly moved?: ReadonlyMap<string, { readonly section?: string }>;
}

/** True iff `n`'s first leaf is a paragraph (a section's children are written first). */
function startsWithText(doc: Y.Doc, n: TreeNode | undefined): boolean {
  if (n === undefined) return false;
  const shape = existingShape(doc, n) ?? shapeOfNode(doc, n);
  if (shape === "text") return true;
  if (shape !== "section") return false;
  return n.children.length === 0 || startsWithText(doc, n.children[0]);
}

function existingShape(doc: Y.Doc, n: TreeNode): BlockShape | null {
  const e = getRegistry(doc).get(n.id);
  return e === undefined ? null : entryShape(e);
}

/**
 * Write `nodes` as consecutive entities at `w`'s point: a paragraph = its content then
 * its ¶; an object = its item; a section = its children, the last one's ¶ ending the
 * section (a section ending in an object, or empty, gets a fresh terminating ¶).
 * Two consecutive objects get a fresh ¶ between them (invariant I).
 */
export function writeNodes(doc: Y.Doc, w: FlowWriter, nodes: readonly TreeNode[], tree: TreeKind, opts: WriteOptions = {}): void {
  writeSeq(doc, w, nodes, tree, opts, { prevId: null, implicitLast: false });
}

interface SeqState {
  /** The id of the entity ending at the last written boundary (null = the holder start). */
  prevId: string | null;
  implicitLast: boolean;
}

function writeSeq(doc: Y.Doc, w: FlowWriter, nodes: readonly TreeNode[], tree: TreeKind, opts: WriteOptions, st: SeqState): void {
  const holder = opts.holder ?? null;
  nodes.forEach((n, i) => {
    const last = i === nodes.length - 1;
    const next = nodes[i + 1];
    const ends = last ? opts.sectionEnd : undefined;
    const atEnd = last && opts.atFlowEnd === true;
    const kept = opts.moved?.has(n.id) === true ? existingShape(doc, n) : null;
    const shape = kept ?? shapeOfNode(doc, n);
    st.implicitLast = false;
    if (shape === "section") {
      if (kept === null && !isDerivedId(n.id)) writeEntry(doc, n, tree, "section");
      const sid = isDerivedId(n.id) ? freshSection(doc, n, tree) : n.id;
      writeSeq(doc, w, n.children, tree, { ...opts, sectionEnd: sid, atFlowEnd: false }, st);
      if (n.children.length === 0) writeFreshPara(doc, w, tree, sid);
      if (ends !== undefined) writeFreshPara(doc, w, tree, ends);
      else if (atEnd) writeFreshPara(doc, w, tree);
      return;
    }
    if (shape === "text") {
      const items = n.inlineContent?.items ?? [];
      if (holder !== null && isImplicitAt(doc, n, st.prevId, holder, next, last, opts)) {
        w.items(items);
        st.implicitLast = true;
        return;
      }
      if (kept === null && !isDerivedId(n.id)) writeEntry(doc, n, tree, "text");
      w.items(items);
      const carried = opts.moved?.get(n.id)?.section;
      const own = carried ?? ends;
      if (isDerivedId(n.id)) {
        const fresh = writeFreshPara(doc, w, tree, own, undefined, n.id);
        st.prevId = markOf(fresh)?.end ?? null;
      } else {
        w.mark({ end: n.id, ...(own === undefined ? {} : { section: own }) });
        st.prevId = n.id;
      }
      // The node's own section-end occupies the ¶: the section to end gets a fresh one.
      if (carried !== undefined && ends !== undefined && carried !== ends) writeFreshPara(doc, w, tree, ends);
      return;
    }
    switch (shape) {
      case "atomic":
        if (kept === null) writeEntry(doc, n, tree, "atomic");
        break;
      case "container":
        if (kept === null) fillFlow(doc, writeEntry(doc, n, tree, "container"), n.id, n.children, tree);
        break;
      case "table":
        if (kept === null) writeTable(doc, n, tree);
        break;
      default:
        throw new Error(`flow: a ${shape} ("${n.type}") cannot sit in a flow`);
    }
    w.mark({ end: n.id });
    st.prevId = n.id;
    // Invariant I: a paragraph follows every object (unless the codec's own implicit run does).
    const implicitNext = holder !== null && next !== undefined && next.id === `${n.id}#i`;
    if (ends !== undefined) writeFreshPara(doc, w, tree, ends);
    else if (atEnd || (next !== undefined && !implicitNext && !startsWithText(doc, next))) writeFreshPara(doc, w, tree);
  });
  if (nodes.length === 0 && opts.atFlowEnd === true) writeFreshPara(doc, w, tree, opts.sectionEnd);
}

function freshSection(doc: Y.Doc, n: TreeNode, tree: TreeKind): string {
  const sid = freshId();
  writeEntry(doc, { ...n, id: asBlockId(sid) }, tree, "section");
  return sid;
}

/**
 * True iff `n` is the implicit run its position in a FRESH flow derives (a codec
 * round-trip of a state whose storage broke invariant I): a plain paragraph named
 * `${prev}#i` (`${holder}#i` at the flow start) not followed by a paragraph and not
 * ending a section.
 */
function isImplicitAt(
  doc: Y.Doc,
  n: TreeNode,
  prevId: string | null,
  holder: string,
  next: TreeNode | undefined,
  last: boolean,
  opts: WriteOptions,
): boolean {
  if (Object.keys(n.attrs).length > 0 || n.type !== "paragraph") return false;
  if (n.id !== `${prevId ?? holder}#i`) return false;
  if (last && opts.sectionEnd !== undefined) return false;
  if (last) return opts.atFlowEnd === true;
  return !startsWithText(doc, next);
}

/**
 * Write `children` into the (fresh) flow of `entry` (block `holder`), after leading
 * inline content given on the holder itself (a leaf body from an older document
 * shape — it becomes a paragraph). The flow always ends with a ¶.
 */
function fillFlow(
  doc: Y.Doc,
  entry: Y.Map<unknown>,
  holder: string,
  children: readonly TreeNode[],
  tree: TreeKind,
  leading: ReadonlyArray<InlineItem> = [],
): void {
  const flow = entryFlow(entry);
  if (flow === null) throw new Error("flow: holder without a flow");
  const w = new FlowWriter(doc, { piece: firstPiece(flow), index: 0 });
  if (leading.length > 0) {
    w.items(leading);
    writeFreshPara(doc, w, tree, undefined, undefined, `${holder}#i`);
  }
  writeNodes(doc, w, children, tree, { holder: leading.length > 0 ? null : holder, atFlowEnd: leading.length === 0 || children.length > 0 });
}

/** The document's root id (meta), or null. */
function metaRootId(doc: Y.Doc): string | null {
  const r = doc.getMap("meta").get("rootId");
  return typeof r === "string" ? r : null;
}

/**
 * Write a tree root (document / footnote body / template body) and its children.
 * The DOCUMENT root always gets its final section (`finalSection`): the last section
 * child (its blocks + any after it) or, in a section-less tree, a fresh empty one;
 * every earlier section ends with a section-end ¶. A root is always a holder: inline
 * content given on the root itself becomes the flow's first paragraph.
 */
export function writeRoot(doc: Y.Doc, n: TreeNode, tree: TreeKind): void {
  const e = writeEntry(doc, n, tree, "container", true);
  if (tree !== "block" || n.id !== metaRootId(doc)) {
    fillFlow(doc, e, n.id, n.children, tree, n.inlineContent?.items ?? []);
    return;
  }
  let lastSec = -1;
  n.children.forEach((c, i) => {
    if (shapeOfNode(doc, c) === "section") lastSec = i;
  });
  const fin = n.children[lastSec];
  const finalNode: TreeNode =
    fin === undefined || isDerivedId(fin.id)
      ? { id: asBlockId(freshId()), type: "section", attrs: fin?.attrs ?? {}, inlineContent: null, children: [] }
      : fin;
  writeEntry(doc, finalNode, tree, "section");
  e.set("finalSection", finalNode.id);
  const body = lastSec < 0 ? n.children : [...n.children.slice(0, lastSec), ...(fin?.children ?? []), ...n.children.slice(lastSec + 1)];
  fillFlow(doc, e, n.id, body, tree, n.inlineContent?.items ?? []);
}

/** Column ids of a freshly written table: deterministic from the table id. */
export function columnId(tableId: string, i: number): string {
  return `${tableId}:c${i}`;
}

/**
 * Write a table entry + its rows / cells from an HTML-model subtree (cells with
 * `colSpan` / `rowSpan` attrs, covered slots absent).
 */
function writeTable(doc: Y.Doc, n: TreeNode, tree: TreeKind): void {
  const reg = getRegistry(doc);
  const { columnWidths, ...rest } = n.attrs as Record<string, unknown>;
  const t = writeEntry(doc, { ...n, attrs: rest }, tree, "table");
  // Grid assignment (rowspans occupy slots in later rows).
  const occupied = new Set<string>();
  let width = 0;
  const placed: { row: number; col: number; cs: number; rs: number; cell: TreeNode }[] = [];
  n.children.forEach((row, r) => {
    let c = 0;
    for (const cell of row.children) {
      while (occupied.has(`${r}:${c}`)) c++;
      // The component's span predicate: a malformed (non-integer / < 1) span reads 1.
      const cs = spanValue(cell.attrs.colSpan) ?? 1;
      const rs = spanValue(cell.attrs.rowSpan) ?? 1;
      for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) occupied.add(`${r + dr}:${c + dc}`);
      placed.push({ row: r, col: c, cs, rs, cell });
      c += cs;
      width = Math.max(width, c);
    }
  });
  const rowCount = n.children.length;
  const cols = Array.from({ length: width }, (_, i) => columnId(n.id, i));
  const colArr = entryIdArray(t, "columns");
  colArr?.insert(0, cols);
  const rowArr = entryIdArray(t, "rows");
  rowArr?.insert(0, n.children.map((r) => r.id));
  if (Array.isArray(columnWidths) && columnWidths.length === width && width > 0) {
    const wm = t.get("columnWidths");
    if (wm instanceof Y.Map) columnWidths.forEach((w, i) => wm.set(cols[i] ?? "", w));
  } else if (columnWidths !== undefined) {
    entryAttrsMapOrThrow(t).set("columnWidths", columnWidths);
  }
  for (const row of n.children) {
    const re = buildEntry({ type: row.type, attrs: row.attrs, tree, shape: "row" });
    re.set("table", n.id);
    reg.set(row.id, re);
  }
  for (const p of placed) {
    const rowNode = n.children[p.row];
    if (rowNode === undefined) continue;
    const { colSpan: _cs, rowSpan: _rs, ...cellAttrs } = p.cell.attrs as Record<string, unknown>;
    void _cs;
    void _rs;
    const ce = buildEntry({ type: p.cell.type, attrs: cellAttrs, tree, shape: "cell" });
    ce.set("row", rowNode.id);
    ce.set("col", cols[p.col] ?? "");
    if (p.cs > 1) ce.set("colSpanTo", cols[Math.min(p.col + p.cs - 1, width - 1)] ?? "");
    if (p.rs > 1) {
      const toRow = n.children[Math.min(p.row + p.rs - 1, rowCount - 1)];
      if (toRow !== undefined) ce.set("rowSpanTo", toRow.id);
    }
    reg.set(p.cell.id, ce);
    const ceLive = reg.get(p.cell.id);
    if (ceLive === undefined) continue;
    fillFlow(doc, ceLive, p.cell.id, p.cell.children, tree);
    const rowEntry = reg.get(rowNode.id);
    entryIdArray(rowEntry ?? new Y.Map(), "cells")?.push([p.cell.id]);
  }
  clearDerivedCaches(doc);
}

// ---------------------------------------------------------------------------
// Points
// ---------------------------------------------------------------------------

/** The point at the start of a holder's flow (before everything). */
function pointAtHolderStart(ctx: ReadCtx, holderId: string): FlowPoint {
  const flows = holderFlows(ctx, holderId);
  const f = flows[0];
  if (f === undefined) throw new Error(`flow: "${holderId}" holds no flow`);
  return { piece: firstPiece(f), index: 0 };
}

// ---------------------------------------------------------------------------
// Invariant I — the two primitives
// ---------------------------------------------------------------------------

/** Delete one boundary item (eager index update). Raw: no invariant check (moves, collapse). */
export function deleteMarkItem(doc: Y.Doc, item: Y.Item): void {
  if (item.deleted) return;
  pieceOf(item).delete(pieceIndexOf(item), 1);
  unindexMark(doc, item);
  noteMarkDeleted(doc, item);
}

/** Content units to delete: block offsets `[from, to)` of entity `id`. */
export interface ContentSpan {
  readonly id: string;
  readonly from: number;
  readonly to: number;
  /**
   * The block's live read model from the caller's ONE read (valid for this span's
   * offsets); omitted → read here, once per block.
   */
  readonly items?: readonly InlineItem[];
  /** Content this deletion keeps lies between the previous span and this one, outside both blocks (`DeletedPart.afterGap`). */
  readonly afterGap?: boolean;
}

export interface DeleteRequest {
  /** Content spans, in DOCUMENT order (several may share a block); each is snapped OUT to grapheme boundaries. */
  readonly spans?: readonly ContentSpan[];
  /** ¶ / section-end / object items, in DOCUMENT order. */
  readonly items?: readonly Y.Item[];
  /**
   * The bookmarks the WHOLE deletion removes when `spans` are only part of it (a
   * cross-block delete's crossed blocks); default: computed over `spans`.
   */
  readonly removedBookmarks?: ReadonlySet<string>;
}

/**
 * THE deletion primitive: every op that deletes content, ¶s, section-ends or
 * objects routes through it (a move's source and undo / redo excepted). Phase 1
 * deletes the content spans and object items. Phase 2 deletes the requested ¶s in
 * DOCUMENT order, each deleted iff invariant I still holds without it — skipped when
 * it is its flow's last unit (I2), or when the units it terminates (its remaining
 * content, an object right before its region) would be left with no ¶ before the next
 * object / the flow end (I1). A skipped ¶ stays as the terminator of whatever remains.
 * Returns the ¶ items it deleted. O(changed + #¶ requested).
 */
export function deleteUnits(doc: Y.Doc, req: DeleteRequest): Set<Y.Item> {
  // Bookmarks (Word): a deletion removes a bookmark's markers only when it
  // covers ALL the content between them; any other bookmark marker in a span is KEPT
  // at the span's collapse point.
  // ONE read per block; spans are deleted last-first, so a block's earlier offsets stay valid.
  const reads = new Map<string, { text: BlockText; items: readonly InlineItem[] }>();
  const parts: (DeletedPart & { text: BlockText })[] = [];
  for (const sp of req.spans ?? []) {
    if (sp.to <= sp.from) continue;
    let read = reads.get(sp.id);
    if (read === undefined) {
      const text = blockText(doc, sp.id);
      if (text === null) continue;
      read = { text, items: sp.items ?? inlineItemsFromYText(text) };
      reads.set(sp.id, read);
    }
    const [from, to] = snapRange(read.items, sp.from, sp.to);
    if (to > from) parts.push({ ...read, from, to, id: sp.id, afterGap: sp.afterGap });
  }
  const removed = req.removedBookmarks ?? bookmarksRemovedBy(parts);
  for (const p of [...parts].reverse()) deleteKeepingBookmarks(p.text, p.items, p.from, p.to, removed);
  const paras: Y.Item[] = [];
  for (const it of req.items ?? []) {
    if (it.deleted) continue;
    const m = markOf(it);
    const e = m === null ? undefined : getRegistry(doc).get(m.end);
    if (e !== undefined && entryShape(e) === "text") paras.push(it);
    else deleteMarkItem(doc, it);
  }
  const deleted = new Set<Y.Item>();
  for (const p of paras) {
    if (p.deleted) continue;
    const ctx = readCtx(doc);
    if (!paraDeletable(ctx, p)) continue;
    deleteMarkItem(doc, p);
    deleted.add(p);
  }
  return deleted;
}

/** Invariant I without ¶ item `p`: the derived skip of {@link deleteUnits}, phase 2 (flow-local). */
function paraDeletable(ctx: ReadCtx, p: Y.Item): boolean {
  let afterLive = false;
  let after: Eff | null = null;
  for (let u = nextUnit(p); u !== null; u = nextUnit(u)) {
    after = eff(ctx, u);
    if (after !== null) break;
    if (clen(ctx, u) > 0) afterLive = true;
  }
  // I2: the flow's last unit is never deleted.
  if (after === null && !afterLive) return false;
  let beforeLive = false;
  let before: Eff | null = null;
  for (let u = prevUnit(p); u !== null; u = prevUnit(u)) {
    before = eff(ctx, u);
    if (before !== null) break;
    if (clen(ctx, u) > 0) beforeLive = true;
  }
  // I1: the units ¶P terminates (its content, an object right before it) need the next boundary to be a ¶.
  const needsPara = beforeLive || (before !== null && before.shape !== "text");
  return !needsPara || (after !== null && after.shape === "text");
}

/** Where a set of entities is placed. */
export type Placement =
  | { readonly after: string }
  | { readonly before: string }
  /** As the first children of `start` (a holder or a section). */
  | { readonly start: string };

/**
 * THE placement primitive: the only code placing object / table / container
 * items, placing entities at a boundary, or re-inserting moved entities. Writes
 * `nodes` at `at`, then runs ONE repair on every window it touched (the placed run;
 * with `sourceGaps`, a move's source gaps): (i) a unit whose next boundary is not a ¶
 * gets one FRESH empty ¶ right before that boundary; (ii) a window reaching the flow
 * end whose last unit is not a PLAIN ¶ (content, an object, a section-end) gets a
 * fresh final plain ¶. Placing after the paragraph that ENDS a section keeps the
 * section-end last: that ¶ becomes plain and the placed run ends the section.
 * O(placed + touched windows).
 */
export function insertItemsAt(
  doc: Y.Doc,
  at: Placement,
  nodes: readonly TreeNode[],
  tree: TreeKind,
  move?: {
    readonly moved: ReadonlyMap<string, { readonly section?: string }>;
    /** Deletes the move's sources (raw), after the destination is resolved; returns their last items. */
    readonly removeSources: () => readonly Y.Item[];
  },
): void {
  const ctx = readCtx(doc);
  let transfer: string | undefined;
  let place = placementOf(ctx, at);
  const ent = "after" in at ? resolveEntity(ctx, at.after) : null;
  const last = ent !== null && ent.k === "mark" ? (ent.chain.marks[ent.chain.marks.length - 1] ?? ent.head) : null;
  if (last !== null && last.shape === "text" && last.m.section !== undefined && sectionBoundaryId(ctx, last) !== null) {
    // The section-end stays the section's last ¶: P's ¶ is re-written plain, the placed run ends the section.
    transfer = last.m.section;
    const pt = { piece: pieceOf(last.item), index: pieceIndexOf(last.item) };
    deleteMarkItem(doc, last.item);
    const plain = new FlowWriter(doc, pt).mark({ end: last.m.end, ...(last.m.implicitOf === undefined ? {} : { implicitOf: last.m.implicitOf }) });
    place = { p: { piece: pieceOf(plain), index: pieceIndexOf(plain) + 1 }, from: plain };
  }
  let { p } = place;
  const { from } = place;
  let sourceGaps: readonly Y.Item[] = [];
  if (move !== undefined) {
    // The destination is resolved before the sources go (a moved paragraph may be what
    // names it); a relative position keeps the point through their deletion.
    const rel = Y.createRelativePositionFromTypeIndex(p.piece, p.index, -1);
    sourceGaps = move.removeSources();
    const abs = Y.createAbsolutePositionFromRelativePosition(rel, doc);
    if (abs === null || !(abs.type instanceof Y.Text)) throw new Error("move: destination lost");
    p = { piece: abs.type, index: abs.index };
  }
  const holderFlow = topFlowOfPiece(p.piece);
  const w = new FlowWriter(doc, p);
  writeNodes(doc, w, nodes, tree, { sectionEnd: transfer, moved: move?.moved });
  repairWindow(doc, holderFlow, tree, from, w.lastItem);
  for (const g of sourceGaps) repairWindow(doc, topFlowOfPiece(pieceOf(g)), tree, g, null);
}

/** The point a placement writes at + the boundary item right before it (null = the flow start). */
function placementOf(ctx: ReadCtx, at: Placement): { p: FlowPoint; from: Y.Item | null } {
  const afterItem = (item: Y.Item): { p: FlowPoint; from: Y.Item } => ({ p: { piece: pieceOf(item), index: pieceIndexOf(item) + 1 }, from: item });
  if ("start" in at) {
    const d = deriveBlock(ctx, at.start);
    if (d !== null && d.block.type === "section" && d.block.parentId === ctx.rootId) {
      // A section's children start after the previous section's section-end (or at the root flow's start).
      if (d.block.prevSiblingId !== null) return placementOf(ctx, { after: d.block.prevSiblingId });
      return { p: pointAtHolderStart(ctx, ctx.rootId), from: null };
    }
    return { p: pointAtHolderStart(ctx, at.start), from: null };
  }
  const id = "after" in at ? at.after : at.before;
  const d = deriveBlock(ctx, id);
  if ("after" in at && d !== null && d.block.type === "section" && d.block.lastChildId !== null) return placementOf(ctx, { after: d.block.lastChildId });
  const ent = resolveEntity(ctx, id);
  if (ent === null) throw new Error(`flow: block "${id}" not found`);
  if (ent.k === "mark") {
    if ("after" in at) return afterItem((ent.chain.marks[ent.chain.marks.length - 1] ?? ent.head).item);
    if (ent.head.shape !== "text") return { p: { piece: pieceOf(ent.head.item), index: pieceIndexOf(ent.head.item) }, from: scanBack(ctx, ent.head.item).e?.item ?? null };
  }
  const region = regionOf(ctx, id);
  if (region === null) throw new Error(`flow: no ${"after" in at ? "end" : "start"} point for "${id}"`);
  return { p: pointInRegion(ctx, region, "after" in at ? region.length : 0), from: region.anchorItem };
}

/**
 * The invariant-I repair of one window of `flow`: walk from `from` (exclusive; null =
 * the flow start) at least past `until` (null: up to the first ¶) and on to the next
 * ¶. (i) every object / unterminated run left with no ¶ before the next object gets a
 * fresh ¶ right before it; (ii) reaching the flow end, an unterminated tail or a last
 * unit that is not a plain ¶ gets a fresh final plain ¶. A fresh ¶ terminating a run
 * takes the run's inclusive `markAttrs` (the registry bound to
 * the doc, {@link inclusiveKeysOf} — none bound: no `markAttrs`).
 */
function repairWindow(doc: Y.Doc, flow: Y.Array<Y.Text>, tree: TreeKind, start: Y.Item | null, until: Y.Item | null): void {
  const ctx = readCtx(doc);
  // A start item deleted since (a move's source): the nearest live boundary before it.
  let from = start;
  while (from !== null && eff(ctx, from) === null) from = prevUnit(from);
  const fromEff = from === null ? null : eff(ctx, from);
  let pending = fromEff !== null && fromEff.shape !== "text";
  let lastEff: Eff | null = fromEff;
  let passed = until === null;
  // The last content unit of the pending run (its formatting → the fresh ¶'s markAttrs).
  let runEnd: Y.Item | null = null;
  const isInclusive = inclusiveKeysOf(doc);
  const freshMarkAttrs = (): ReadonlyAttrs | undefined =>
    runEnd === null || isInclusive === undefined ? undefined : markAttrsOfRun(attrsBefore(runEnd), isInclusive);
  for (let u = from === null ? firstUnitOfFlow(flow) : nextUnit(from); u !== null; u = nextUnit(u)) {
    if (u === until) passed = true;
    const e = eff(ctx, u);
    if (e === null) {
      if (clen(ctx, u) > 0) {
        pending = true;
        runEnd = u;
      }
      continue;
    }
    if (e.shape === "text") {
      pending = false;
      runEnd = null;
      lastEff = e;
      // Past the window, a plain ¶ closes it; a section-end may still be the flow's last unit (ii).
      if (passed && e.m.section === undefined) return;
      continue;
    }
    if (pending) writeFreshPara(doc, new FlowWriter(doc, sizedPoint({ piece: pieceOf(u), index: pieceIndexOf(u) }, 3)), tree, undefined, freshMarkAttrs());
    pending = true;
    runEnd = null;
    lastEff = e;
  }
  if (pending || lastEff === null || lastEff.m.section !== undefined) {
    const pieces = topPieces(flow);
    const lastPiece = pieces[pieces.length - 1];
    if (lastPiece === undefined) return;
    writeFreshPara(doc, new FlowWriter(doc, { piece: lastPiece, index: lastPiece.length }), tree, undefined, freshMarkAttrs());
  }
}

// ---------------------------------------------------------------------------
// Structural edits
// ---------------------------------------------------------------------------

/** The chain items of an entity (empty for an implicit run). */
export function chainMarks(ctx: ReadCtx, id: string): readonly Eff[] {
  const ent = resolveEntity(ctx, id);
  if (ent === null || ent.k !== "mark") return [];
  return ent.chain.marks;
}

/**
 * A re-derivable handle on entity `id` for a composed step inside one transaction: the
 * id it reads under AFTER later edits (a duplicate copy `X@c:k` is renamed when a
 * sibling copy goes). A ¶-chain entity is tracked by its head ¶ item; any other
 * entity keeps `id`.
 */
export function entityTracker(doc: Y.Doc, id: string): () => string {
  const ent = resolveEntity(readCtx(doc), id);
  if (ent === null || ent.k !== "mark") return () => id;
  const item = ent.head.item;
  return () => {
    const ctx = readCtx(doc);
    const e = eff(ctx, item);
    return e === null ? id : entityOf(ctx, e);
  };
}

/**
 * MERGE `leftId` with the paragraph after it: delete ¶L — every live ¶ of L's
 * chain — through {@link deleteUnits}; the survivor is R (the paragraph whose ¶ ends
 * the joined content). L's type + attrs + `markAttrs` are written onto R's entry as a
 * key-wise diff (Google Docs / Quill: the first paragraph's formatting wins), except when L is an EMPTY DEFAULT paragraph, which is simply removed.
 * Returns R's id, or null when nothing merged (no paragraph follows, or invariant I
 * keeps ¶L).
 */
export function joinWithNext(doc: Y.Doc, leftId: string): string | null {
  const ctx = readCtx(doc);
  const ent = resolveEntity(ctx, leftId);
  if (ent === null || ent.k !== "mark" || ent.head.shape !== "text") return null;
  const n = ent.chain.next;
  if (n === null || n.shape !== "text") return null;
  const rightId = entityOf(ctx, n);
  const lLen = regionOf(ctx, leftId)?.length ?? 0;
  const lType = ent.head.entry.get("type");
  const lAttrs = attrsRecord(ent.head.entry.get("attrs"));
  const lMark = attrsRecord(ent.head.entry.get("markAttrs"));
  // Google Docs / Quill: the first paragraph's formatting wins,
  // except an EMPTY DEFAULT paragraph (a plain `paragraph` with no block attrs) — it loses.
  const lWins = lLen > 0 || lType !== "paragraph" || Object.keys(lAttrs).length > 0;
  // R's entry is resolved BEFORE ¶L goes: a derived id (a duplicate copy `X@c:k`, an
  // implicit run) names R only in the flow as it stands now.
  const r = lWins ? getRegistry(doc).get(realIdForWrite(doc, rightId)) : undefined;
  const del = deleteUnits(doc, { items: ent.chain.marks.map((m) => m.item) });
  if (del.size !== ent.chain.marks.length) return null;
  if (lWins) {
    if (r !== undefined) {
      if (typeof lType === "string" && r.get("type") !== lType) r.set("type", lType);
      diffWriteAttrs(r, lAttrs, "attrs");
      diffWriteAttrs(r, lMark, "markAttrs");
    }
  }
  return rightId;
}

function attrsRecord(m: unknown): Record<string, unknown> {
  return m instanceof Y.Map ? (m.toJSON() as Record<string, unknown>) : {};
}

/**
 * SPLIT `id` at `offset`: insert a fresh ¶ for `newId` at the cut (Word: the NEW ¶
 * ends the head; the tail keeps ¶B, its id and its entry). With `section`, the new ¶
 * is a section-end (a section break). No text item moves.
 */
export function splitAt(
  doc: Y.Doc,
  id: string,
  offset: number,
  newId: string,
  entry: { readonly type: string; readonly attrs: ReadonlyAttrs; readonly tree: TreeKind; readonly markAttrs?: ReadonlyAttrs },
  opts: { readonly section?: string } = {},
): void {
  const ctx = readCtx(doc);
  const reg = getRegistry(doc);
  reg.set(newId, buildEntry({ type: entry.type, attrs: entry.attrs, tree: entry.tree, shape: "text", markAttrs: entry.markAttrs }));
  noteEntryChanged(doc, newId);
  const region = regionOf(ctx, id);
  if (region === null) throw new Error(`split: block "${id}" has no inline content`);
  const p = pointInRegion(ctx, region, offset);
  new FlowWriter(doc, sizedPoint(p, 3)).mark({ end: newId, ...(opts.section === undefined ? {} : { section: opts.section }) });
}

/**
 * Insert `nodes` as children of `parentId`, right after `prevSiblingId` (null = as
 * the first children).
 */
export function insertChildren(
  doc: Y.Doc,
  parentId: string,
  prevSiblingId: string | null,
  nodes: readonly TreeNode[],
  tree: TreeKind,
): void {
  if (nodes.length === 0) return;
  const parentEntry = getRegistry(doc).get(parentId);
  if (parentEntry !== undefined && (entryShape(parentEntry) === "table" || entryShape(parentEntry) === "row")) {
    insertGridChildren(doc, parentId, entryShape(parentEntry) === "table", prevSiblingId, nodes, tree);
    return;
  }
  insertItemsAt(doc, prevSiblingId === null ? { start: parentId } : { after: prevSiblingId }, nodes, tree);
}

/**
 * Grid children: rows under a table (inserted after `prevSiblingId` in row order,
 * with their cells), or cells under a row (cell k takes the k-th live column; cells
 * after it shift one column right; columns are added at the end when needed).
 */
function insertGridChildren(
  doc: Y.Doc,
  parentId: string,
  isTable: boolean,
  prevSiblingId: string | null,
  nodes: readonly TreeNode[],
  tree: TreeKind,
): void {
  const reg = getRegistry(doc);
  if (isTable) {
    let prev = prevSiblingId;
    for (const row of nodes) {
      insertRowEntry(doc, parentId, row.id, prev, row.attrs);
      insertGridChildren(doc, row.id, false, null, row.children, tree);
      prev = row.id;
    }
    return;
  }
  const rowEntry = reg.get(parentId);
  const tableId = rowEntry === undefined ? undefined : entryString(rowEntry, "table");
  if (rowEntry === undefined || tableId === undefined) throw new Error(`insert: row "${parentId}" not found`);
  const ctx = readCtx(doc);
  const visible = gridOf(ctx, tableId)?.byRow.get(parentId) ?? [];
  const isImplicit = (id: string): boolean => id === `${parentId}|${id.slice(id.lastIndexOf("|") + 1)}` && !reg.has(id);
  let k = prevSiblingId === null ? 0 : visible.findIndex((c) => c.id === prevSiblingId) + 1;
  // Implicit slots right before the insertion point are filled first (a row built
  // cell by cell fills its empty slots instead of growing the grid).
  while (k > 0 && isImplicit(visible[k - 1]?.id ?? "")) k--;
  for (const cell of nodes) {
    let cols = liveColumns(doc, tableId);
    const current = gridOf(readCtx(doc), tableId)?.byRow.get(parentId) ?? [];
    const slot = current.find((c) => c.colIndex === k);
    // Shift the real cells at / after column k one column right (unless slot k is empty).
    const later = slot !== undefined && isImplicit(slot.id) ? [] : current.filter((c) => c.colIndex >= k && !isImplicit(c.id));
    if (later.length > 0 || k >= cols.length) {
      insertColumnEntry(doc, tableId, freshColumnId(), cols[cols.length - 1] ?? null);
      cols = liveColumns(doc, tableId);
    }
    for (const c of [...later].reverse()) {
      const ce = reg.get(c.id);
      const nextCol = cols[c.colIndex + 1];
      if (ce !== undefined && nextCol !== undefined) ce.set("col", nextCol);
    }
    const col = cols[k];
    if (col === undefined) throw new Error("insert: no column for cell");
    const { colSpan: _cs, rowSpan: _rs, ...attrs } = cell.attrs as Record<string, unknown>;
    void _cs;
    void _rs;
    const ce = buildEntry({ type: cell.type, attrs, tree, shape: "cell" });
    ce.set("row", parentId);
    ce.set("col", col);
    reg.set(cell.id, ce);
    const live = reg.get(cell.id);
    if (live !== undefined) fillFlow(doc, live, cell.id, cell.children, tree);
    entryIdArray(rowEntry, "cells")?.push([cell.id]);
    clearDerivedCaches(doc);
    k++;
  }
}

/**
 * Remove an entity through {@link deleteUnits}: its content and its item(s). A
 * paragraph's ¶ goes unless invariant I needs it (the flow's last ¶, the paragraph
 * after an object …): then the paragraph stays, emptied. A leaf's registry entry
 * survives (a concurrent move keeps its type / attrs); a container's entry (and a
 * table's rows / cells) is deleted — delete wins.
 */
export function removeEntity(doc: Y.Doc, id: string, removedBookmarks?: ReadonlySet<string>): void {
  const ctx = readCtx(doc);
  const ent = resolveEntity(ctx, id);
  if (ent === null) return;
  const len = regionOf(ctx, id)?.length ?? 0;
  const spans = len > 0 ? [{ id, from: 0, to: len }] : [];
  if (ent.k === "mark") {
    deleteUnits(doc, { spans, items: ent.chain.marks.map((m) => m.item), removedBookmarks });
    if (ent.head.shape === "container" || ent.head.shape === "table") deleteContainerEntry(doc, ent.head.m.end);
    return;
  }
  if (ent.k === "implicit") deleteUnits(doc, { spans, removedBookmarks });
}

/**
 * Remove any block from the read model: a flow-resident block via
 * {@link removeEntity}; a section by removing every block in it (the final section's
 * last ¶ stays — it always exists); a table row / cell from its grid (entry deleted —
 * delete wins); a tree root (footnote / template body) by deleting its entry.
 */
export function removeBlockStorage(doc: Y.Doc, id: string, removedBookmarks?: ReadonlySet<string>): void {
  const ctx = readCtx(doc);
  const ent = resolveEntity(ctx, id);
  if (ent === null) return;
  if (ent.k === "section" || ent.k === "final") {
    const children: string[] = [];
    for (let c = deriveBlock(ctx, id)?.block.firstChildId ?? null; c !== null; ) {
      children.push(c);
      c = deriveBlock(ctx, c)?.block.nextSiblingId ?? null;
    }
    for (const c of children.reverse()) removeEntity(doc, c);
    return;
  }
  if (ent.k === "struct") {
    const reg = getRegistry(doc);
    if (ent.shape === "row") {
      deleteRowEntry(doc, entryString(ent.entry, "table") ?? "", id);
    } else if (ent.shape === "cell") {
      const r = reg.get(entryString(ent.entry, "row") ?? "");
      const cells = r === undefined ? null : entryIdArray(r, "cells");
      if (cells !== null) removeFromIdArray(cells, id);
      deleteContainerEntry(doc, id);
    } else {
      deleteContainerEntry(doc, id);
    }
    clearDerivedCaches(doc);
    return;
  }
  removeEntity(doc, id, removedBookmarks);
}

/** Delete every occurrence of `id` from a grid id array (table arrays are not flows). */
export function removeFromIdArray(arr: Y.Array<string>, id: string): void {
  const items = arr.toArray();
  for (let i = items.length - 1; i >= 0; i--) if (items[i] === id) arr.delete(i, 1);
}

/** Delete a container's registry entry (and a table's rows / cells). */
export function deleteContainerEntry(doc: Y.Doc, id: string): void {
  const reg = getRegistry(doc);
  const e = reg.get(id);
  if (e === undefined) return;
  if (entryShape(e) === "table") {
    for (const r of entryIdArray(e, "rows")?.toArray() ?? []) {
      const re = reg.get(r);
      for (const c of re === undefined ? [] : (entryIdArray(re, "cells")?.toArray() ?? [])) {
        const cf = reg.get(c);
        const flow = cf === undefined ? null : entryFlow(cf);
        if (flow !== null) unindexFlow(doc, flow);
        reg.delete(c);
      }
      reg.delete(r);
    }
  }
  // Items inside the container's flow die with it; un-index them.
  const flow = entryFlow(e);
  if (flow !== null) unindexFlow(doc, flow);
  reg.delete(id);
  clearDerivedCaches(doc);
}

function unindexFlow(doc: Y.Doc, flow: Y.Array<Y.Text>): void {
  const reg = getRegistry(doc);
  for (let u = firstUnitOfFlow(flow); u !== null; u = nextUnit(u)) {
    if (!u.deleted && markOf(u) !== null) {
      unindexMark(doc, u);
      const m = markOf(u);
      const child = m === null ? undefined : reg.get(m.end);
      if (child !== undefined) {
        const f = entryFlow(child);
        if (f !== null) unindexFlow(doc, f);
      }
    }
  }
}

/**
 * MOVE: delete the source entities RAW (content + items — not a {@link deleteUnits}
 * path: a moved ¶ is re-inserted with the same id) and re-insert them after `afterId`
 * (or at the start of `holderId`) with the SAME ids + re-minted content, through
 * {@link insertItemsAt}, whose repair covers the source gaps and the destination. A
 * moved paragraph carries its section-end (Word: the sectPr lives in that ¶). Registry
 * entries are kept, except that every moved paragraph's break keys are deleted.
 */
export function moveEntities(
  doc: Y.Doc,
  nodes: readonly TreeNode[],
  afterId: string | null,
  holderId: string,
  tree: TreeKind,
): void {
  // A derived entity (implicit `#i`, a duplicate copy `X@c:k`, a joined chain) is made
  // real first: the move writes items under real ids, never a derived id as a key.
  const real = nodes.map((n) => realNode(doc, n));
  const moved = new Map<string, { section?: string }>();
  const sourceGaps: Y.Item[] = [];
  const removeSource = (n: TreeNode): void => {
    const ctx = readCtx(doc);
    const ent = resolveEntity(ctx, n.id);
    if (ent === null) return;
    if (ent.k === "section" || ent.k === "final") {
      moved.set(n.id, {});
      for (const c of n.children) removeSource(c);
      return;
    }
    if (ent.k !== "mark") return;
    const last = ent.chain.marks[ent.chain.marks.length - 1] ?? ent.head;
    moved.set(n.id, last.m.section === undefined ? {} : { section: last.m.section });
    const len = regionOf(ctx, n.id)?.length ?? 0;
    if (len > 0) new BlockText(ctx, n.id).delete(0, len);
    for (const e of [...ent.chain.marks].reverse()) deleteMarkItem(doc, e.item);
    sourceGaps.push(last.item);
  };
  const removeSources = (): readonly Y.Item[] => {
    for (const n of real) removeSource(n);
    return sourceGaps;
  };
  // `moved` is filled by the source walk; the writer reads it only after.
  for (const n of real) markMoved(doc, n, moved);
  insertItemsAt(doc, afterId === null ? { start: holderId } : { after: afterId }, real, tree, { moved, removeSources });
  clearMovedKeys(doc, real);
}

/** Record every moved node (its entry is kept on re-insertion), before the sources go. */
function markMoved(doc: Y.Doc, n: TreeNode, moved: Map<string, { section?: string }>): void {
  if (getRegistry(doc).get(n.id) === undefined) return;
  if (!moved.has(n.id)) moved.set(n.id, {});
  for (const c of n.children) markMoved(doc, c, moved);
}

/** Delete the break keys of every moved paragraph entry (recursing into sections). */
function clearMovedKeys(doc: Y.Doc, nodes: readonly TreeNode[]): void {
  const reg = getRegistry(doc);
  for (const n of nodes) {
    const e = reg.get(n.id);
    if (e === undefined) continue;
    const shape = entryShape(e);
    if (shape === "text") for (const k of BREAK_TAG_KEYS) if (e.has(k)) e.delete(k);
    if (shape === "section") clearMovedKeys(doc, n.children);
  }
}

function realNode(doc: Y.Doc, n: TreeNode): TreeNode {
  return { ...n, id: asBlockId(realIdForWrite(doc, n.id)), children: n.children.map((c) => realNode(doc, c)) };
}

// ---------------------------------------------------------------------------
// Attr writes
// ---------------------------------------------------------------------------

/**
 * Replace block `id`'s attrs with `attrs`, KEY-WISE (only changed keys are set,
 * removed keys deleted), so concurrent writes of different keys merge. A derived
 * entity is made real first; a joined cell writes every candidate entry (a clear
 * really takes effect); a table's `columnWidths` array is stored per column id; a
 * cell's derived `colSpan` / `rowSpan` are not attrs (spans are grid keys).
 */
export function writeBlockAttrs(doc: Y.Doc, id: string, attrs: ReadonlyAttrs): void {
  const reg = getRegistry(doc);
  const real = realIdForWrite(doc, id);
  const entry = reg.get(real);
  if (entry === undefined) throw new Error(`attrs: block "${id}" not found`);
  const shape = entryShape(entry);
  let next: Record<string, unknown> = { ...attrs };
  if (shape === "table") {
    const { columnWidths, ...rest } = next;
    next = rest;
    const wm = entry.get("columnWidths");
    if (wm instanceof Y.Map) {
      const cols = entryIdArray(entry, "columns")?.toArray() ?? [];
      const ctx = readCtx(doc);
      const live = gridOf(ctx, real)?.cols ?? cols;
      if (Array.isArray(columnWidths) && columnWidths.length === live.length && live.length > 0) {
        live.forEach((c, i) => {
          const w: unknown = columnWidths[i];
          if (wm.get(c) !== w) wm.set(c, w);
        });
      } else if (columnWidths === undefined) {
        for (const k of [...wm.keys()]) wm.delete(k);
      } else {
        // The grid's columns are not established yet (a table built cell by cell):
        // keep the positional array until a column op re-keys it.
        next = { ...next, columnWidths };
      }
    }
  }
  const targets: Y.Map<unknown>[] = [entry];
  if (shape === "cell") {
    delete next.colSpan;
    delete next.rowSpan;
    const ctx = readCtx(doc);
    const row = entryString(entry, "row");
    const t = row === undefined ? undefined : entryString(reg.get(row) ?? new Y.Map(), "table");
    const gc = t === undefined ? undefined : gridOf(ctx, t)?.cellToVisible.get(real);
    if (gc !== undefined) {
      for (const c of gc.cells) {
        const ce = reg.get(c);
        if (ce !== undefined && ce !== entry && entryString(ce, "row") === gc.row && entryString(ce, "col") === gc.col) targets.push(ce);
      }
    }
  }
  for (const e of targets) diffWriteAttrs(e, next, "attrs");
}

/** Key-wise write of `attrs` into entry map `key` (`attrs` / `markAttrs`): keys absent from `attrs` are deleted. */
function diffWriteAttrs(entry: Y.Map<unknown>, attrs: Readonly<Record<string, unknown>>, key: "attrs" | "markAttrs"): void {
  let m = key === "attrs" ? entry.get("attrs") : entryMarkAttrsMap(entry);
  if (!(m instanceof Y.Map)) {
    entry.set(key, new Y.Map<unknown>());
    m = entry.get(key);
  }
  if (!(m instanceof Y.Map)) return;
  const map = m as Y.Map<unknown>;
  for (const k of [...map.keys()]) if (!(k in attrs) || attrs[k] === undefined || attrs[k] === null) map.delete(k);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    assertNoNestedYTypes(v, k);
    if (!deepValueEqual(map.get(k), v)) map.set(k, v);
  }
}

/**
 * The ¶ character props after typing `runAttrs` at the END of paragraph `id`:
 * the run's inclusive subset REPLACES `markAttrs`, written key-wise only where it
 * differs — a keystroke with unchanged formatting writes nothing. No registry bound to
 * the doc ({@link inclusiveKeysOf}): nothing is written.
 */
export function writeTypedMarkAttrs(doc: Y.Doc, id: string, runAttrs: ReadonlyAttrs): void {
  const isInclusive = inclusiveKeysOf(doc);
  if (isInclusive === undefined) return;
  const entry = getRegistry(doc).get(realIdForWrite(doc, id));
  if (entry !== undefined && entryShape(entry) === "text") diffWriteAttrs(entry, markAttrsOfRun(runAttrs, isInclusive), "markAttrs");
}

/**
 * Formatting `delta` applied over paragraph `id`'s ¶ (a span covering it or ending at
 * its end): its inclusive keys are merged into `markAttrs` (an
 * `undefined` / `null` value removes the key). Other keys are never written; nothing
 * is without a registry bound to the doc.
 */
export function mergeMarkAttrs(doc: Y.Doc, id: string, delta: ReadonlyAttrs): void {
  const isInclusive = inclusiveKeysOf(doc);
  if (isInclusive === undefined) return;
  const entry = getRegistry(doc).get(realIdForWrite(doc, id));
  const m = entry === undefined || entryShape(entry) !== "text" ? null : entryMarkAttrsMap(entry);
  if (m === null) return;
  const kept = markAttrsOfRun(Object.fromEntries(Object.keys(delta).map((k) => [k, true])), isInclusive);
  for (const k of Object.keys(kept)) {
    const v = delta[k];
    if (v === undefined || v === null) {
      if (m.has(k)) m.delete(k);
    } else if (!deepValueEqual(m.get(k), v)) {
      assertNoNestedYTypes(v, k);
      m.set(k, v);
    }
  }
}

/** Set a block's `type` (a derived entity is made real first). */
export function writeBlockType(doc: Y.Doc, id: string, type: string): void {
  const entry = getRegistry(doc).get(realIdForWrite(doc, id));
  if (entry === undefined) throw new Error(`type: block "${id}" not found`);
  if (entry.get("type") !== type) entry.set("type", type);
}

// ---------------------------------------------------------------------------
// Materialization + collapse
// ---------------------------------------------------------------------------

/**
 * The real registry id to write for entity `id`: an implicit run is materialized (a
 * fresh ¶ with `implicitOf` written at the END of the run — two peers materializing
 * at once leave consecutive ¶s that join); an implicit cell gets its cell + ¶; a
 * joined chain is collapsed (one ¶ left; only attrs the survivor lacks are copied —
 * break keys are never transferred); a duplicate section copy writes its section.
 */
export function realIdForWrite(doc: Y.Doc, id: string): string {
  const ctx = readCtx(doc);
  const ent = resolveEntity(ctx, id);
  if (ent === null) throw new Error(`write: block "${id}" not found`);
  switch (ent.k) {
    case "struct":
    case "final":
      return id;
    case "section":
      return ent.end.m.section ?? id;
    case "mark":
      collapseChain(doc, ent.head, ent.chain.marks);
      return ent.head.m.end;
    case "icell":
      return materializeCell(doc, ent.row, ent.col, id);
    case "implicit":
      break;
  }
  const holder = ent.holder;
  const bar = holder.lastIndexOf("|");
  if (bar > 0 && getRegistry(doc).get(holder) === undefined) {
    // The implicit cell's own paragraph: materializing the cell writes it.
    const cell = materializeCell(doc, holder.slice(0, bar), holder.slice(bar + 1), holder);
    const first = deriveBlock(readCtx(doc), cell)?.block.firstChildId;
    if (first === undefined || first === null) throw new Error(`table: cell "${cell}" holds no paragraph`);
    return first;
  }
  const region = regionOf(ctx, id);
  const p = region === null ? pointAtHolderStart(ctx, holder) : pointInRegion(ctx, region, region.length);
  const tree = getRegistry(doc).get(holder)?.get("tree");
  const nid = freshId();
  writeEntry(
    doc,
    { id: asBlockId(nid), type: "paragraph", attrs: {}, inlineContent: { items: [] }, children: [] },
    tree === "embedContent" || tree === "templateContent" ? tree : "block",
    "text",
  );
  new FlowWriter(doc, sizedPoint(p, 3)).mark({ end: nid, implicitOf: id });
  return nid;
}

/**
 * Collapse a joined chain to ONE ¶ with the head's id (it stays last, so the joined
 * content keeps its terminator): later items are deleted when no content lies between
 * them; otherwise the earlier ones go (same-id chain) or the head's ¶ is re-written at
 * the end. Attrs the survivor lacks are copied from the other ids' entries.
 */
function collapseChain(doc: Y.Doc, head: Eff, marks: readonly Eff[]): void {
  if (marks.length <= 1) return;
  const reg = getRegistry(doc);
  const survivor = reg.get(head.m.end);
  const sAttrs = survivor?.get("attrs");
  for (const e of marks.slice(1)) {
    if (e.m.end === head.m.end) continue;
    const a = e.entry.get("attrs");
    if (sAttrs instanceof Y.Map && a instanceof Y.Map) {
      for (const [k, v] of a.entries()) if (!sAttrs.has(k)) sAttrs.set(k, v);
    }
  }
  const ctx = readCtx(doc);
  const last = marks[marks.length - 1] ?? head;
  let contentBetween = false;
  for (let u = nextUnit(head.item); u !== null && u !== last.item; u = nextUnit(u)) if (clen(ctx, u) > 0) contentBetween = true;
  if (!contentBetween) {
    for (const e of [...marks.slice(1)].reverse()) deleteMarkItem(doc, e.item);
  } else if (last.m.end === head.m.end) {
    for (const e of [...marks.slice(0, -1)].reverse()) deleteMarkItem(doc, e.item);
  } else {
    const pt = { piece: pieceOf(last.item), index: pieceIndexOf(last.item) };
    new FlowWriter(doc, pt).mark({ end: head.m.end, ...(last.m.section === undefined ? {} : { section: last.m.section }) });
    for (const e of [...marks].reverse()) deleteMarkItem(doc, e.item);
  }
  for (const e of marks) {
    if (e.m.end !== head.m.end && canonicalMark(doc, e.m.end) === null) {
      reg.delete(e.m.end);
      noteEntryChanged(doc, e.m.end);
    }
  }
}

/** Materialize implicit cell `${row}|${col}`: a cell entry whose flow holds one ¶ (`implicitOf` its implicit paragraph). */
function materializeCell(doc: Y.Doc, row: string, col: string, derived: string): string {
  const reg = getRegistry(doc);
  const re = reg.get(row);
  if (re === undefined) throw new Error(`table: row "${row}" not found`);
  const cid = freshId();
  const tree = re.get("tree");
  const kind: TreeKind = tree === "embedContent" || tree === "templateContent" ? tree : "block";
  const ce = buildEntry({ type: "table-cell", attrs: {}, tree: kind, shape: "cell", implicitOf: derived });
  ce.set("row", row);
  ce.set("col", col);
  reg.set(cid, ce);
  const live = reg.get(cid);
  const flow = live === undefined ? null : entryFlow(live);
  if (flow !== null) writeFreshPara(doc, new FlowWriter(doc, { piece: firstPiece(flow), index: 0 }), kind, undefined, undefined, `${derived}#i`);
  entryIdArray(re, "cells")?.push([cid]);
  clearDerivedCaches(doc);
  return cid;
}

export { chainForward };
