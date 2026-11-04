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
 *   - anything under `listDefs`: list definitions; under `comments` / `suggestions`:
 *     not read in M1 (P4 / P10).
 *
 * A table is marks in its flow, so its edits are piece / item-map changes; a region
 * touching a mark goes through the structural splice (`update-flow.ts`), and a `cols`
 * edit re-reads its table's widths only (`update/table-widths.ts`).
 */
import * as Y from "yjs";
import type { BlockId } from "./block";
import { deriveAll, deriveDocument } from "./derive/derive-document";
import { deriveFlow, deriveFootnote, removeFlow } from "./derive/derive-flow";
import { readListDefs } from "./derive/list-defs";
import { writeSections } from "./derive/sections";
import { Working } from "./derive/working";
import type { Document } from "./document/types";
import type { DeltaOp, FlowChange, PieceChange } from "./update/flow-change";
import { updateFlow } from "./update/update-flow";
import { colsOwner, refreshWidths } from "./update/table-widths";
import { recordStep } from "./mapping/map-position";
import { footnoteBodyId, templateBodyId } from "./ids";
import type { FootnoteRef } from "./scan/tokens";
import { getDocMap } from "./storage/doc-map";
import { type HasItem, itemId, typeId } from "./storage/item-id";
import { BODIES_KEY, BODY_KEY, COMMENTS_KEY, FLOW_KEY, ITEM_KINDS, LIST_DEFS_KEY, ROOT_MAP, SUGGESTIONS_KEY } from "./storage/keys";
import { childMap, flowOf, kindOf } from "./storage/map-reads";
import { pieceHoldingSubflow } from "./storage/pieces";
import { BUILTIN_OBJECT_KINDS, type ObjectKindRegistry } from "./object-kinds";
import { isSectionBreak, kindOfStored } from "./scan/kinds";

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
}

const isEmpty = (c: Classified): boolean =>
  !c.full && !c.sections && !c.listDefs && c.bodies.size === 0 && c.flows.size === 0 && c.footnoteBodies.size === 0;

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
    const bodies = childMap(docMap, BODIES_KEY);
    for (const bodyId of c.bodies) {
      const holderId = templateBodyId(bodyId);
      removeFlow(w, holderId);
      const body = bodies === null ? null : childMap(bodies, bodyId);
      if (body !== null) deriveFlow(w, holderId, "templateContent", flowOf(body), false);
    }
    // Holder flows first: their anchor changes add / remove footnote flows.
    const order = [...c.flows].sort(([a], [b]) => rank(w, a) - rank(w, b));
    for (const [holderId, ch] of order) updateFlow(w, holderId, ch);
    for (const [holderId, ch] of order) if (ch.tableCols.size > 0 && !w.fresh.has(holderId)) refreshWidths(w, holderId, ch.tableCols);
    for (const [anchorId, ref] of c.footnoteBodies) {
      const holderId = footnoteBodyId(anchorId);
      if (!w.flows.has(holderId) || w.fresh.has(holderId)) continue;
      removeFlow(w, holderId);
      deriveFootnote(w, ref);
    }
    if (c.listDefs) w.listDefs = readListDefs(docMap);
    if (c.sections || c.bodies.size > 0) writeSections(w);
  }

  private classify(events: Y.YEvent<Y.AbstractType<unknown>>[], v: Document): Classified {
    const c: Classified = { full: false, sections: false, listDefs: false, bodies: new Set(), flows: new Map(), footnoteBodies: new Map() };
    const docMap = v.docMap;
    const bodies = childMap(docMap, BODIES_KEY);
    const flowChange = (holderId: BlockId): FlowChange => {
      let f = c.flows.get(holderId);
      if (f === undefined) {
        f = { arrayChanged: false, subArrays: new Set(), pieces: new Map(), tableCols: new Set() };
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
    /** The holder id of a flow array, or null when `arr` is not a holder's flow. */
    const holderOfFlow = (arr: HasItem): BlockId | null => {
      const owner = arr._item;
      if (owner === null || owner.parentSub !== FLOW_KEY || !(owner.parent instanceof Y.Map)) return null;
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
    const holderOfPiece = (piece: Y.Text): BlockId | null => {
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
      pieceChange(holderId, piece).full = true;
      return true;
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
      // A table's `cols` (the array, or one entry's keys): its widths only.
      const open = colsOwner(t);
      if (open !== null) {
        const piece = open._item?.parent;
        const holderId = piece instanceof Y.Text ? holderOfPiece(piece) : null;
        if (holderId === null) c.full = true;
        else flowChange(holderId).tableCols.add(open);
        continue;
      }
      if (t instanceof Y.Text) {
        const holderId = holderOfPiece(t);
        if (holderId === null) c.full = true;
        else pieceChange(holderId, t).delta = e.delta;
        continue;
      }
      if (t instanceof Y.Array) {
        const holderId = holderOfFlow(t);
        if (holderId !== null) flowChange(holderId).arrayChanged = true;
        else {
          const outer = pieceHoldingSubflow(t);
          const outerHolder = outer === null ? null : holderOfPiece(outer);
          if (outerHolder === null) c.full = true;
          else flowChange(outerHolder).subArrays.add(t);
        }
        continue;
      }
      if (t instanceof Y.Map) {
        const it = t._item;
        const k = kindOf(t);
        if (it !== null && it.parent instanceof Y.Text && k !== ITEM_KINDS.sub) {
          const holderId = holderOfPiece(it.parent);
          if (holderId === null) c.full = true;
          else pieceChange(holderId, it.parent).mapItems.push(it);
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
      }
      c.full = true;
    }
    return c;
  }
}

/** Process order: body flow, header / footer bodies, then footnote bodies. */
function rank(w: Working, holderId: BlockId): number {
  const fs = w.flows.get(holderId);
  if (fs === undefined) return 3;
  return fs.isRoot ? 0 : fs.tree === "templateContent" ? 1 : 2;
}
