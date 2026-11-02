/**
 * The live model: one immutable {@link Document} version per Yjs transaction,
 * derived incrementally from `observeDeep` change reports (D4 / D5 amendment).
 *
 * Event classification (anything not listed → full re-derive):
 *   - a top-level piece `Y.Text`: its delta → that flow's piece change;
 *   - a piece inside a sub-flow, or a sub-flow array / map: the enclosing top-level
 *     piece is rescanned whole;
 *   - a flow array (pieces inserted / removed): the flow's piece list;
 *   - an embedded item map (¶, object, marker, …): its position joins the piece's
 *     hull; an `[S]` map's keys also re-derive the sections (R4 / R5);
 *   - DocMap `s:*` / `h:*` keys: sections; `bodies` keys: header / footer bodies
 *     added / removed / replaced (+ sections, for R5);
 *   - a cell flow (`c:<col>:flow` of a rendered cell, R8) is a holder's flow like any other;
 *   - a table's `rows` / `cols`, a ColMap, a RowMap's grid keys, a table map's keys but
 *     `k`: that table is regridded; a RowMap's `c:<col>:flow` / `c:<col>:a:*`: that cell;
 *   - anything under `listDefs`: list definitions; under `comments` / `suggestions`:
 *     not read in M1 (P4 / P10).
 * Storage that is not read (a covered slot, a duplicate row, an orphan column, a table
 * nowhere rendered) is skipped.
 */
import * as Y from "yjs";
import type { BlockId } from "./block";
import { deriveAll, deriveDocument } from "./derive/derive-document";
import { deriveFlow, deriveFootnote, regridTable, removeFlow, updateCell } from "./derive/derive-flow";
import { readListDefs } from "./derive/list-defs";
import { writeSections } from "./derive/sections";
import { Working } from "./derive/working";
import type { Document } from "./document/types";
import type { DeltaOp, FlowChange, PieceChange } from "./update/flow-change";
import { updateFlow } from "./update/update-flow";
import { recordStep } from "./mapping/map-position";
import { cellId, footnoteBodyId, templateBodyId } from "./ids";
import type { FootnoteRef } from "./scan/tokens";
import { getDocMap } from "./storage/doc-map";
import { type HasItem, itemId, typeId } from "./storage/item-id";
import { BODIES_KEY, BODY_KEY, COLS_KEY, COMMENTS_KEY, FLOW_KEY, ITEM_KINDS, KIND_KEY, LIST_DEFS_KEY, ROOT_MAP, ROWS_KEY, SUGGESTIONS_KEY, TRACK_KEY } from "./storage/keys";
import { childMap, flowOf, kindOf } from "./storage/map-reads";
import { pieceHoldingSubflow } from "./storage/pieces";
import { BUILTIN_OBJECT_KINDS, type ObjectKindRegistry } from "./object-kinds";
import { holdsFlows, isSectionBreak, kindOfStored } from "./scan/kinds";
import { cellFlowCol, cellKeyCols, isCellFlowKey, spanKeyCol } from "./storage/table-keys";

export interface ModelChange {
  readonly before: Document;
  readonly after: Document;
  /**
   * Every block id whose record was written or removed (all trees). Exact when
   * `full` is false; when `full` is true it lists only the records written, so a
   * consumer must treat EVERYTHING as dirty.
   */
  readonly dirtyIds: ReadonlySet<BlockId>;
  /** The whole document was re-derived (an unrecognised change, or a recovered derivation error): everything is dirty. */
  readonly full: boolean;
}

interface Classified {
  full: boolean;
  sections: boolean;
  listDefs: boolean;
  readonly bodies: Set<string>;
  readonly flows: Map<BlockId, FlowChange>;
  /** Footnote anchors whose `body` was replaced. */
  readonly footnoteBodies: Map<string, FootnoteRef>;
  /** Rendered tables whose grid may have changed → the RowMaps whose grid keys changed: regridded. */
  readonly tables: Map<BlockId, Set<Y.Map<unknown>>>;
  /** RowMaps of rendered tables → the columns whose cell flow / attrs may have changed. */
  readonly cells: Map<Y.Map<unknown>, { readonly table: BlockId; readonly cols: Set<string> }>;
}

/** An event in storage that is not read (a cell that is not rendered, a table nowhere rendered). */
const HIDDEN: unique symbol = Symbol("hidden");

const isEmpty = (c: Classified): boolean =>
  !c.full && !c.sections && !c.listDefs && c.bodies.size === 0 && c.flows.size === 0 && c.footnoteBodies.size === 0 && c.tables.size === 0 && c.cells.size === 0;

declare function queueMicrotask(cb: () => void): void;

/** Report an error without unwinding the caller (DOM-style: rethrown on a microtask). */
function reportAsync(e: unknown): void {
  queueMicrotask(() => {
    throw e;
  });
}

export class Model {
  private current: Document;
  private readonly root: Y.Map<unknown>;
  private readonly listeners = new Set<(c: ModelChange) => void>();
  private readonly onDeep = (events: Y.YEvent<Y.AbstractType<unknown>>[]): void => this.apply(events);
  private inTransactions = false;
  private readonly onBefore = (): void => {
    this.inTransactions = true;
  };
  private readonly onAfter = (): void => {
    this.inTransactions = false;
  };

  /**
   * Precondition: construct outside any Yjs transaction (and outside the observers of
   * one). Yjs exposes no public "in a transaction" flag to check it: constructed
   * inside one, the model missed its `beforeAllTransactions`, so {@link busy} reads
   * false until that transaction's observers have run; it is correct from the next
   * transaction on.
   */
  constructor(
    readonly doc: Y.Doc,
    readonly registry: ObjectKindRegistry = BUILTIN_OBJECT_KINDS,
    /** Where derivation / listener errors go (default: rethrown on a microtask). */
    private readonly onError: (e: unknown) => void = reportAsync,
  ) {
    this.current = deriveDocument(doc, registry);
    this.root = doc.getMap(ROOT_MAP);
    this.root.observeDeep(this.onDeep);
    doc.on("beforeAllTransactions", this.onBefore);
    doc.on("afterAllTransactions", this.onAfter);
  }

  /**
   * True from the start of a (possibly nested) Yjs transaction until every observer —
   * this model's derivation and its listeners included — has run. While busy, the
   * current version may not describe storage yet (Yjs clears `doc._transaction`
   * before observers run), so plans must not be applied.
   */
  get busy(): boolean {
    return this.inTransactions;
  }

  /** The current version. */
  get version(): Document {
    return this.current;
  }

  subscribe(fn: (c: ModelChange) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  destroy(): void {
    this.root.unobserveDeep(this.onDeep);
    this.doc.off("beforeAllTransactions", this.onBefore);
    this.doc.off("afterAllTransactions", this.onAfter);
    this.listeners.clear();
  }

  private apply(events: Y.YEvent<Y.AbstractType<unknown>>[]): void {
    const before = this.current;
    const docMap = getDocMap(this.doc);
    const rootId = docMap === null ? null : typeId(docMap);
    // No command removes the root; a peer that does is the schema gate's concern (X25(b)).
    // ponytail: the model keeps its last version rather than throwing inside a Yjs observer.
    if (docMap === null || rootId === null) return;
    let w: Working;
    let full: boolean;
    // The exact mapping (D8): every piece's delta, read inside the observer as Yjs requires.
    const deltas = new Map<Y.Text, readonly DeltaOp[]>();
    for (const e of events) if (e.target instanceof Y.Text) deltas.set(e.target, e.delta);
    try {
      const c = this.classify(events, before);
      if (isEmpty(c) && docMap === before.docMap) return;
      full = c.full || docMap !== before.docMap;
      w = new Working(rootId, docMap, this.registry, full ? null : before);
      if (full) deriveAll(w);
      else this.applyIncremental(w, c, docMap);
    } catch (e) {
      // A derivation bug must neither leave a stale version nor escape into Yjs:
      // recover with a from-scratch derivation and report the error.
      this.report(e);
      full = true;
      w = new Working(rootId, docMap, this.registry, null);
      try {
        deriveAll(w);
      } catch (e2) {
        this.report(e2);
        return;
      }
    }
    this.current = w.finish();
    recordStep(before, this.current, docMap === before.docMap ? deltas : null);
    const change: ModelChange = { before, after: this.current, dirtyIds: w.dirty, full };
    for (const fn of [...this.listeners]) {
      try {
        fn(change);
      } catch (e) {
        this.report(e);
      }
    }
  }

  /** `onError`, guarded: a throwing handler never escapes into the Yjs observer. */
  private report(e: unknown): void {
    try {
      this.onError(e);
    } catch (e2) {
      reportAsync(e2);
    }
  }

  private applyIncremental(w: Working, c: Classified, docMap: Y.Map<unknown>): void {
    const v = this.current;
    // One worklist, ancestors first (storage depth): an entry whose flow / table an earlier
    // one removed or derived from scratch skips itself.
    const work: { depth: number; run: () => void }[] = [];
    const add = (t: HasItem | null | undefined, run: () => void): void => {
      work.push({ depth: t === null || t === undefined ? Infinity : storageDepth(t), run });
    };
    const bodies = childMap(docMap, BODIES_KEY);
    for (const bodyId of c.bodies) {
      add(bodies, () => {
        const holderId = templateBodyId(bodyId);
        removeFlow(w, holderId);
        const body = bodies === null ? null : childMap(bodies, bodyId);
        if (body !== null) deriveFlow(w, holderId, "templateContent", flowOf(body), false);
      });
    }
    for (const [holderId, ch] of c.flows) add(v.flows.get(holderId)?.array, () => updateFlow(w, holderId, ch));
    for (const [anchorId, ref] of c.footnoteBodies) {
      const holderId = footnoteBodyId(anchorId);
      add(v.flows.get(holderId)?.array, () => {
        if (!w.flows.has(holderId) || w.fresh.has(holderId)) return;
        removeFlow(w, holderId);
        deriveFootnote(w, ref);
      });
    }
    for (const [id, rows] of c.tables) {
      add(v.tables.get(id)?.map, () => {
        const ts = w.tables.get(id);
        if (ts !== undefined && !w.fresh.has(id)) regridTable(w, id, ts.map, ts.tree, rows);
      });
    }
    for (const [row, { table, cols }] of c.cells) add(row, () => cols.forEach((col) => updateCell(w, table, row, col)));
    work.sort((a, b) => a.depth - b.depth);
    for (const x of work) x.run();
    if (c.listDefs) w.listDefs = readListDefs(docMap);
    if (c.sections || c.bodies.size > 0) writeSections(w);
  }

  private classify(events: Y.YEvent<Y.AbstractType<unknown>>[], v: Document): Classified {
    const c: Classified = {
      full: false,
      sections: false,
      listDefs: false,
      bodies: new Set(),
      flows: new Map(),
      footnoteBodies: new Map(),
      tables: new Map(),
      cells: new Map(),
    };
    const docMap = v.docMap;
    const bodies = childMap(docMap, BODIES_KEY);
    const flowChange = (holderId: BlockId): FlowChange => {
      let f = c.flows.get(holderId);
      if (f === undefined) {
        f = { arrayChanged: false, subArrays: new Set(), pieces: new Map() };
        c.flows.set(holderId, f);
      }
      return f;
    };
    const pieceChange = (holderId: BlockId, piece: Y.Text): PieceChange => {
      const f = flowChange(holderId);
      let p = f.pieces.get(piece);
      if (p === undefined) {
        p = { full: false, delta: null, mapItems: [] };
        f.pieces.set(piece, p);
      }
      return p;
    };
    /**
     * The rendered table `t` is (its id; by identity, so a table re-kinded in this transaction
     * still is), HIDDEN when it is a table map not rendered, null when `t` is no table map.
     */
    const tableIdOf = (t: unknown): BlockId | typeof HIDDEN | null => {
      if (!(t instanceof Y.Map)) return null;
      const id = typeId(t);
      if (id !== null && v.tables.get(id)?.map === t) return id;
      return holdsFlows(kindOfStored(kindOf(t))) ? HIDDEN : null;
    };
    /** The table whose `key` (`rows` / `cols`) track array `arr` is (see {@link tableIdOf}). */
    const tableOfTracks = (arr: unknown, key: string): BlockId | typeof HIDDEN | null => {
      const it = arr instanceof Y.Array ? arr._item : null;
      return it === null || it.parentSub !== key ? null : tableIdOf(it.parent);
    };
    /** The rendered cell whose flow `arr` (a RowMap's `flowKey`) is, else HIDDEN (covered, a duplicate row, an orphan column, replaced). */
    const cellOfFlow = (arr: HasItem, rowMap: Y.Map<unknown>, flowKey: string): BlockId | typeof HIDDEN => {
      const table = tableOfTracks(rowMap._item?.parent, ROWS_KEY);
      const rowKey: unknown = rowMap.get(TRACK_KEY);
      if (table === null || table === HIDDEN || typeof rowKey !== "string") return HIDDEN;
      const id = cellId(table, rowKey, cellFlowCol(flowKey));
      return v.flows.get(id)?.array === arr ? id : HIDDEN;
    };
    /** The holder id of a flow array, HIDDEN when it is a flow that is not read, or null when `arr` is not a holder's flow. */
    const holderOfFlow = (arr: HasItem): BlockId | typeof HIDDEN | null => {
      const owner = arr._item;
      if (owner === null || !(owner.parent instanceof Y.Map)) return null;
      if (isCellFlowKey(owner.parentSub)) return cellOfFlow(arr, owner.parent, owner.parentSub);
      if (owner.parentSub !== FLOW_KEY) return null;
      const holder = owner.parent;
      if (holder === docMap) return v.rootId;
      const hi = holder._item;
      if (hi === null) return null;
      if (hi.parent === bodies && hi.parentSub !== null) return templateBodyId(hi.parentSub);
      if (hi.parentSub === BODY_KEY && hi.parent instanceof Y.Map && kindOf(hi.parent) === ITEM_KINDS.footnote && hi.parent._item !== null) {
        return footnoteBodyId(itemId(hi.parent._item));
      }
      return null;
    };
    /** The holder of the flow a piece (top-level or nested) belongs to, climbing sub-flows. */
    const holderOfPiece = (piece: Y.Text): BlockId | typeof HIDDEN | null => {
      for (let p = piece; ; ) {
        const it = p._item;
        if (it === null || !(it.parent instanceof Y.Array)) return null;
        const outer = pieceHoldingSubflow(it.parent);
        if (outer === null) return holderOfFlow(it.parent);
        p = outer;
      }
    };
    /** The DocMap key whose subtree holds `t`, or null when `t` is not under DocMap. */
    const sideKey = (t: HasItem): string | null => {
      for (let cur: HasItem = t; ; ) {
        const it = cur._item;
        if (it === null || !(it.parent instanceof Y.AbstractType)) return null;
        if (it.parent === docMap) return it.parentSub;
        cur = it.parent;
      }
    };
    const fullPieceOf = (piece: Y.Text): boolean => {
      const holderId = holderOfPiece(piece);
      if (holderId === null) return false;
      if (holderId !== HIDDEN) pieceChange(holderId, piece).full = true;
      return true;
    };
    const addTable = (id: BlockId | typeof HIDDEN, row?: Y.Map<unknown>): void => {
      if (id === HIDDEN) return;
      let rows = c.tables.get(id);
      if (rows === undefined) {
        rows = new Set();
        c.tables.set(id, rows);
      }
      if (row !== undefined) rows.add(row);
    };
    /**
     * A RowMap's keys: cell keys go to that cell when it is a rendered cell of `row`; grid keys
     * to the table when they are read (a rendered row, a column that exists) or are `key` (which
     * can reveal / hide the row).
     */
    const rowKeys = (table: BlockId, row: Y.Map<unknown>, keys: Iterable<string>): void => {
      const rowKey: unknown = row.get(TRACK_KEY);
      const ts = v.tables.get(table);
      if (ts === undefined) return;
      const rendered = typeof rowKey === "string" && ts.rows[ts.rowIndex.get(rowKey) ?? -1]?.map === row;
      for (const k of keys) {
        const cols = cellKeyCols(k);
        const spanCol = spanKeyCol(k);
        // A grid key: not a cell key, or a span key (both, for keys parsing both ways).
        if ((cols.length === 0 || spanCol !== null) && (k === TRACK_KEY || (rendered && (spanCol === null || ts.colIndex.has(spanCol))))) addTable(table, row);
        for (const col of cols) {
          if (typeof rowKey !== "string" || v.trees[ts.tree].get(cellId(table, rowKey, col))?.parentId !== typeId(row)) continue;
          let e = c.cells.get(row);
          if (e === undefined) {
            e = { table, cols: new Set() };
            c.cells.set(row, e);
          }
          e.cols.add(col);
        }
      }
    };

    for (const e of events) {
      const t = e.target;
      if (t === docMap) {
        for (const k of e.changes.keys.keys()) {
          if (k.startsWith("s:") || k.startsWith("h:")) c.sections = true;
          else if (k !== COMMENTS_KEY && k !== SUGGESTIONS_KEY) c.full = true;
        }
        continue;
      }
      if (t === bodies) {
        for (const k of e.changes.keys.keys()) c.bodies.add(k);
        continue;
      }
      const side = sideKey(t);
      if (side === LIST_DEFS_KEY) {
        c.listDefs = true;
        continue;
      }
      if (side === COMMENTS_KEY || side === SUGGESTIONS_KEY) continue;
      if (t instanceof Y.Text) {
        const holderId = holderOfPiece(t);
        if (holderId === null) c.full = true;
        else if (holderId !== HIDDEN) pieceChange(holderId, t).delta = e.delta;
        continue;
      }
      if (t instanceof Y.Array) {
        const tracksOf = tableOfTracks(t, ROWS_KEY) ?? tableOfTracks(t, COLS_KEY);
        if (tracksOf !== null) {
          addTable(tracksOf);
          continue;
        }
        const holderId = holderOfFlow(t);
        if (holderId === HIDDEN) continue;
        if (holderId !== null) flowChange(holderId).arrayChanged = true;
        else {
          const outer = pieceHoldingSubflow(t);
          const outerHolder = outer === null ? null : holderOfPiece(outer);
          if (outerHolder === null) c.full = true;
          else if (outerHolder !== HIDDEN) flowChange(outerHolder).subArrays.add(t);
        }
        continue;
      }
      if (t instanceof Y.Map) {
        const it = t._item;
        const k = kindOf(t);
        if (it !== null && it.parent instanceof Y.Text && k !== ITEM_KINDS.sub) {
          // A table map's keys but `k` are its grid / attrs (regrid); `k` re-kinds the item (its flow).
          const table = tableIdOf(t);
          if (table !== null) addTable(table);
          if (table !== null && !e.changes.keys.has(KIND_KEY)) continue;
          const holderId = holderOfPiece(it.parent);
          if (holderId === null) c.full = true;
          else if (holderId !== HIDDEN) pieceChange(holderId, it.parent).mapItems.push(it);
          if (isSectionBreak(kindOfStored(k))) c.sections = true;
          if (k === ITEM_KINDS.footnote && e.changes.keys.has(BODY_KEY)) c.footnoteBodies.set(itemId(it), { id: itemId(it), body: childMap(t, BODY_KEY) });
          continue;
        }
        // A header / footer body map's keys (its `flow` replaced): re-derive that body.
        if (it !== null && it.parent === bodies && it.parentSub !== null) {
          c.bodies.add(it.parentSub);
          continue;
        }
        // A footnote body map whose `flow` was replaced.
        const owner = it?.parent;
        if (it !== null && it.parentSub === BODY_KEY && owner instanceof Y.Map && kindOf(owner) === ITEM_KINDS.footnote && owner._item !== null) {
          const anchorId = itemId(owner._item);
          c.footnoteBodies.set(anchorId, { id: anchorId, body: t });
          continue;
        }
        if (k === ITEM_KINDS.sub && it !== null && it.parent instanceof Y.Text) {
          if (!fullPieceOf(it.parent)) c.full = true;
          continue;
        }
        // A RowMap / ColMap.
        const rows = tableOfTracks(it?.parent, ROWS_KEY);
        if (rows !== null) {
          if (rows !== HIDDEN) rowKeys(rows, t, e.changes.keys.keys());
          continue;
        }
        const cols = tableOfTracks(it?.parent, COLS_KEY);
        if (cols !== null) {
          addTable(cols);
          continue;
        }
      }
      c.full = true;
    }
    return c;
  }
}

/** The number of shared types above `t` (an ancestor is shallower than its descendants). */
function storageDepth(t: HasItem): number {
  let d = 0;
  for (let p = t._item?.parent; p instanceof Y.AbstractType; p = p._item?.parent) d++;
  return d;
}
