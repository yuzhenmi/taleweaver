/**
 * Flows: the storage of block content (schema 3).
 *
 * A FLOW is a `Y.Array<Y.Text>` of PIECES held by a container's registry entry
 * (`flow` key). Block boundaries are END MARK items — `insertEmbed({ end, section?,
 * implicitOf? })` — inside the pieces' character sequence (Word's ¶ / Google Docs'
 * `\n`): a paragraph is everything after the previous boundary up to and including
 * its own ¶, possibly spanning pieces; an object (image, table, host container, …)
 * is one self-delimiting `{ end }` item. A ¶ carrying `section: S` is a SECTION-END:
 * it ends paragraph `end` and section `S` (Word's sectPr in the last ¶). A
 * SUB-FLOW is a `Y.Map{ pieces: Y.Array<Y.Text> }` embedded inside a piece and read
 * in place (it bounds a piece's size without moving content).
 *
 * This module owns the flow arrays: they are touched ONLY through the functions
 * here (pointer walks + `insertPieceAfter` / `insertPieceBefore`), never through the
 * `Y.Array` index API (an encapsulation test enforces it). Piece `Y.Text`s use the
 * public index API with an index from a bounded walk ({@link pieceIndexOf}).
 *
 * Yjs internals used (pinned exactly, see `yjs-internals.contract.test.ts`):
 * `Item.left/right/deleted/countable/length/content/parent/parentSub/id`,
 * `AbstractType._item/_start`, the `Content*` classes, and the `Item` constructor +
 * `integrate` for piece insertion.
 */
import * as Y from "yjs";

/** No write inserts into a piece holding this many structs (incl. tombstones/formats). */
export const PIECE_SOFT_MAX = 1024;
/** Sub-flow nesting cap: past it, writes enter the full piece (documented residue). */
export const SUBFLOW_DEPTH_CAP = 4;

/** A mark's immutable JSON content: the entity it ends, the section it ends, the implicit id it materialized. */
export interface MarkContent {
  readonly end: string;
  readonly section?: string;
  readonly implicitOf?: string;
}

/** Opaque handle to a flow array (never exposes the `Y.Array` index API). */
export type FlowArray = Y.Array<Y.Text> & { readonly __flow: unique symbol };

/** Wrap a `Y.Array` known to be a flow. */
export function asFlow(arr: Y.Array<Y.Text>): FlowArray {
  return arr as FlowArray;
}

/** A detached, empty flow with one empty piece (integrate it by setting it on an entry). */
export function newFlow(): Y.Array<Y.Text> {
  const arr = new Y.Array<Y.Text>();
  arr.insert(0, [new Y.Text()]);
  return arr;
}

/** A detached sub-flow map holding one fresh piece. */
export function newSubflow(piece: Y.Text): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  const arr = new Y.Array<Y.Text>();
  arr.insert(0, [piece]);
  m.set("pieces", arr);
  return m;
}

// ---------------------------------------------------------------------------
// Item classification
// ---------------------------------------------------------------------------

/** The mark content of `item`, or null when it is not a mark (deleted marks still read). */
export function markOf(item: Y.Item): MarkContent | null {
  const c = item.content;
  if (!(c instanceof Y.ContentEmbed)) return null;
  const e: unknown = c.embed;
  if (typeof e !== "object" || e === null) return null;
  const end = (e as { end?: unknown }).end;
  if (typeof end !== "string") return null;
  const section = (e as { section?: unknown }).section;
  const implicitOf = (e as { implicitOf?: unknown }).implicitOf;
  return {
    end,
    ...(typeof section === "string" ? { section } : {}),
    ...(typeof implicitOf === "string" ? { implicitOf } : {}),
  };
}

/** True iff `item` embeds a sub-flow (a `Y.Map` embedded inside a piece). */
export function isSubflowItem(item: Y.Item): boolean {
  return item.parent instanceof Y.Text && item.content instanceof Y.ContentType && item.content.type instanceof Y.Map;
}

/** The pieces array of a sub-flow item. */
export function subflowPieces(item: Y.Item): Y.Array<Y.Text> | null {
  if (!(item.content instanceof Y.ContentType)) return null;
  const t = item.content.type;
  if (!(t instanceof Y.Map)) return null;
  const arr: unknown = t.get("pieces");
  return arr instanceof Y.Array ? (arr as Y.Array<Y.Text>) : null;
}

/** Block-offset length of `item`: text length, 1 per inline embed, 0 for marks / sub-flows / formats / tombstones. */
export function contentLength(item: Y.Item): number {
  if (item.deleted || !item.countable) return 0;
  const c = item.content;
  if (c instanceof Y.ContentString) return item.length;
  if (c instanceof Y.ContentEmbed) return markOf(item) === null ? 1 : 0;
  return 0;
}

/** True iff `t` is a piece (a `Y.Text` inside a flow or sub-flow array). */
export function isPiece(t: unknown): t is Y.Text {
  if (!(t instanceof Y.Text)) return false;
  const it = t._item;
  if (it === null) return false;
  const arr = it.parent;
  if (!(arr instanceof Y.Array)) return false;
  const owner = arr._item;
  return owner !== null && (owner.parentSub === "flow" || owner.parentSub === "pieces");
}

/** The piece `Y.Text` holding `item`. */
export function pieceOf(item: Y.Item): Y.Text {
  const p = item.parent;
  if (!(p instanceof Y.Text)) throw new Error("flow: item is not inside a piece");
  return p;
}

/** The flow array holding `piece`. */
function arrayOfPiece(piece: Y.Text): Y.Array<Y.Text> {
  const it = piece._item;
  if (it === null || !(it.parent instanceof Y.Array)) throw new Error("flow: detached piece");
  return it.parent as Y.Array<Y.Text>;
}

/** The sub-flow item enclosing `arr`, or null when `arr` is a top-level flow. */
function enclosingSubflowItem(arr: Y.Array<Y.Text>): Y.Item | null {
  const owner = arr._item;
  if (owner === null || owner.parentSub !== "pieces") return null;
  const map = owner.parent;
  if (!(map instanceof Y.Map)) return null;
  return map._item;
}

/** The top-level flow array (registry `flow`) that `piece` lives in, climbing sub-flows. */
export function topFlowOfPiece(piece: Y.Text): Y.Array<Y.Text> {
  let arr = arrayOfPiece(piece);
  for (;;) {
    const sub = enclosingSubflowItem(arr);
    if (sub === null) return arr;
    arr = arrayOfPiece(pieceOf(sub));
  }
}

/** Sub-flow nesting depth of `piece` (0 = a top-level piece). */
export function pieceDepth(piece: Y.Text): number {
  let d = 0;
  let arr = arrayOfPiece(piece);
  for (;;) {
    const sub = enclosingSubflowItem(arr);
    if (sub === null) return d;
    d++;
    arr = arrayOfPiece(pieceOf(sub));
  }
}

/** The registry entry map owning a top-level flow array. */
export function entryOfFlow(arr: Y.Array<Y.Text>): Y.Map<unknown> | null {
  const owner = arr._item;
  if (owner === null || owner.parentSub !== "flow") return null;
  return owner.parent instanceof Y.Map ? (owner.parent as Y.Map<unknown>) : null;
}

/** True iff `item` is inside a deleted container (its piece / flow / entry is gone). */
export function inDeletedFlow(item: Y.Item): boolean {
  let t: Y.AbstractType<unknown> | null = item.parent instanceof Y.AbstractType ? item.parent : null;
  while (t !== null) {
    const it = t._item;
    if (it === null) return false;
    if (it.deleted) return true;
    t = it.parent instanceof Y.AbstractType ? it.parent : null;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Flow-order traversal (descends into sub-flows in place; includes tombstones)
// ---------------------------------------------------------------------------

function pieceTextOf(pieceItem: Y.Item, keep?: KeepPiece): Y.Text | null {
  const c = pieceItem.content;
  const t = c instanceof Y.ContentType && c.type instanceof Y.Text ? c.type : null;
  // A deleted piece (its container was deleted) is still read by a past-version walk that keeps it.
  if (pieceItem.deleted && (t === null || keep === undefined || !keep(t))) return null;
  return t;
}

/** Pieces a past-version walk must not skip as dead (see `flow-read.ts` `View.keep`). */
export type KeepPiece = (piece: Y.Text) => boolean;

const skippable = (t: Y.Text, keep: KeepPiece | undefined): boolean => pieceIsDead(t) && (keep === undefined || !keep(t));

/** The first unit of the first non-empty piece at or after `from` in a flow array. */
function firstUnitFrom(from: Y.Item | null, keep?: KeepPiece): Y.Item | null {
  for (let p = from; p !== null; p = p.right) {
    const t = pieceTextOf(p, keep);
    if (t !== null && t._start !== null && !skippable(t, keep)) return t._start;
  }
  return null;
}

/**
 * Dead pieces (every item deleted) are skipped by the flow-order walks in O(1) once
 * known: a block whose region crosses a large deleted stretch (e.g. 1e4 paragraphs
 * deleted between two blocks) pays the scan of those pieces ONCE, later walks hop over
 * them. Deleted items never revive (undo creates new items), so only an insert into a
 * piece invalidates its entry ({@link invalidatePiece}: eagerly by the writers, and by
 * the MarkIndex reconcile for remote / undo transactions). The walk inside a live piece
 * is bounded by `PIECE_SOFT_MAX`.
 */
const deadPieces = new WeakMap<Y.Text, boolean>();

export function pieceIsDead(t: Y.Text): boolean {
  const cached = deadPieces.get(t);
  if (cached !== undefined) return cached;
  let dead = true;
  for (let it = t._start; it !== null; it = it.right) {
    if (!it.deleted) {
      dead = false;
      break;
    }
  }
  deadPieces.set(t, dead);
  return dead;
}

/** Forget a piece's liveness (an item was inserted into / deleted from it). */
export function invalidatePiece(t: Y.Text): void {
  deadPieces.delete(t);
}

/** The first unit of a flow array (null when every piece is empty). */
export function firstUnitOfFlow(arr: Y.Array<Y.Text>, keep?: KeepPiece): Y.Item | null {
  return firstUnitFrom(arr._start, keep);
}

/** The unit after `item`, not descending into `item` itself. */
function unitAfter(item: Y.Item, keep?: KeepPiece): Y.Item | null {
  if (item.right !== null) return item.right;
  const piece = pieceOf(item);
  const pItem = piece._item;
  if (pItem === null) return null;
  const f = firstUnitFrom(pItem.right, keep);
  if (f !== null) return f;
  const sub = enclosingSubflowItem(arrayOfPiece(piece));
  return sub === null ? null : unitAfter(sub, keep);
}

/** The next unit in flow order (descending into a live sub-flow). */
export function nextUnit(item: Y.Item, keep?: KeepPiece): Y.Item | null {
  if (!item.deleted && isSubflowItem(item)) {
    const arr = subflowPieces(item);
    const f = arr === null ? null : firstUnitOfFlow(arr, keep);
    if (f !== null) return f;
  }
  return unitAfter(item, keep);
}

/** The first unit at or after the start of `piece` (crossing into following pieces / out of sub-flows). */
export function firstUnitAtPieceStart(piece: Y.Text): Y.Item | null {
  if (piece._start !== null) return piece._start;
  const pItem = piece._item;
  if (pItem === null) return null;
  const f = firstUnitFrom(pItem.right);
  if (f !== null) return f;
  const sub = enclosingSubflowItem(arrayOfPiece(piece));
  return sub === null ? null : unitAfter(sub);
}

function lastItemOfText(t: Y.Text): Y.Item | null {
  let last: Y.Item | null = null;
  for (let it = t._start; it !== null; it = it.right) last = it;
  return last;
}

/** `u`, or — when `u` is a live sub-flow — the deepest last unit inside it. */
function deepLast(u: Y.Item, keep?: KeepPiece): Y.Item {
  let cur = u;
  while (!cur.deleted && isSubflowItem(cur)) {
    const arr = subflowPieces(cur);
    const last = arr === null ? null : lastUnitOfFlowRaw(arr, keep);
    if (last === null) return cur;
    cur = last;
  }
  return cur;
}

function lastUnitOfFlowRaw(arr: Y.Array<Y.Text>, keep?: KeepPiece): Y.Item | null {
  let lastPiece: Y.Item | null = null;
  for (let p = arr._start; p !== null; p = p.right) lastPiece = p;
  for (let p = lastPiece; p !== null; p = p.left) {
    const t = pieceTextOf(p, keep);
    if (t === null || skippable(t, keep)) continue;
    const l = lastItemOfText(t);
    if (l !== null) return l;
  }
  return null;
}

/** The last unit of a flow array in flow order (deep), or null when empty. */
export function lastUnitOfFlow(arr: Y.Array<Y.Text>, keep?: KeepPiece): Y.Item | null {
  const l = lastUnitOfFlowRaw(arr, keep);
  return l === null ? null : deepLast(l, keep);
}

/** The previous unit in flow order. */
export function prevUnit(item: Y.Item, keep?: KeepPiece): Y.Item | null {
  if (item.left !== null) return deepLast(item.left, keep);
  const piece = pieceOf(item);
  const pItem = piece._item;
  if (pItem === null) return null;
  for (let p = pItem.left; p !== null; p = p.left) {
    const t = pieceTextOf(p, keep);
    if (t === null || skippable(t, keep)) continue;
    const l = lastItemOfText(t);
    if (l !== null) return deepLast(l, keep);
  }
  return enclosingSubflowItem(arrayOfPiece(piece));
}

// ---------------------------------------------------------------------------
// Piece indexing + insertion
// ---------------------------------------------------------------------------

/** The `Y.Text` index of `item` in its piece (counted units before it). O(piece). */
export function pieceIndexOf(item: Y.Item): number {
  let n = 0;
  for (let it = pieceOf(item)._start; it !== null && it !== item; it = it.right) {
    if (it.countable && !it.deleted) n += it.length;
  }
  return n;
}

/** The piece's struct count (incl. tombstones and formats) — the size metric. O(piece). */
export function pieceStructCount(piece: Y.Text): number {
  let n = 0;
  for (let it = piece._start; it !== null; it = it.right) n++;
  return n;
}

/** The piece's countable `Y.Text` length. */
export function pieceLength(piece: Y.Text): number {
  return piece.length;
}

function insertPieceItem(
  arr: Y.Array<Y.Text>,
  left: Y.Item | null,
  right: Y.Item | null,
  piece: Y.Text,
): void {
  const doc = arr.doc;
  if (doc === null) throw new Error("flow: detached flow");
  const tx = (doc as unknown as { _transaction: Y.Transaction | null })._transaction;
  if (tx === null) throw new Error("flow: piece insertion outside a transaction");
  const item = new Y.Item(
    Y.createID(doc.clientID, Y.getState(doc.store, doc.clientID)),
    left,
    left === null ? null : left.lastId,
    right,
    right === null ? null : right.id,
    arr,
    null,
    new Y.ContentType(piece),
  );
  item.integrate(tx, 0);
}

/** Insert a fresh piece right after `piece` in its flow array (O(1)). */
export function insertPieceAfter(piece: Y.Text, fresh: Y.Text): void {
  const pItem = piece._item;
  if (pItem === null) throw new Error("flow: detached piece");
  insertPieceItem(arrayOfPiece(piece), pItem, pItem.right, fresh);
}

/** Insert a fresh piece right before `piece` in its flow array (O(1)). */
export function insertPieceBefore(piece: Y.Text, fresh: Y.Text): void {
  const pItem = piece._item;
  if (pItem === null) throw new Error("flow: detached piece");
  insertPieceItem(arrayOfPiece(piece), pItem.left, pItem, fresh);
}

/** Append a fresh piece at the end of a flow array. */
export function appendPiece(arr: Y.Array<Y.Text>, fresh: Y.Text): void {
  let last: Y.Item | null = null;
  for (let p = arr._start; p !== null; p = p.right) last = p;
  insertPieceItem(arr, last, null, fresh);
}

/** Every piece of a flow array in order, deep (sub-flow pieces included). Used by full scans. */
export function* allPiecesDeep(arr: Y.Array<Y.Text>): Generator<Y.Text> {
  for (let p = arr._start; p !== null; p = p.right) {
    const t = pieceTextOf(p);
    if (t === null) continue;
    yield t;
    for (let it = t._start; it !== null; it = it.right) {
      if (!it.deleted && isSubflowItem(it)) {
        const sub = subflowPieces(it);
        if (sub !== null) yield* allPiecesDeep(sub);
      }
    }
  }
}

/** The pieces of a flow array (top level), in order — for builders/upgrade only. */
export function topPieces(arr: Y.Array<Y.Text>): Y.Text[] {
  const out: Y.Text[] = [];
  for (let p = arr._start; p !== null; p = p.right) {
    const t = pieceTextOf(p);
    if (t !== null) out.push(t);
  }
  return out;
}
