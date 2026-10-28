/**
 * Per-block LOCATOR cache (schema 3) — local, derived, never synced.
 *
 * A text-bearing entity's content is a sequence of RUNS in the flow. A run is the
 * content between a boundary item — a live mark or sub-flow item, or the piece
 * start — and the next boundary in the same piece. A run is keyed by `(piece,
 * after)` (`after` = the boundary item, null at the piece start): marks and
 * sub-flow items are length-1 embeds Yjs never splits or merges, so the key is
 * stable under every edit inside the run. A locator holds the entity's resolved
 * region (its ¶ chain, the boundary item it starts after, the item it stops at), its
 * non-empty runs as EXTENTS `(piece, after, len)`, its length and its derived links.
 *
 * Costs:
 *   - built on a miss by one walk of the region: O(paragraph + E), E = the empty /
 *     tombstone-only pieces it crosses;
 *   - offset → (piece, index): a scan of the extents + one in-piece walk to the run's
 *     boundary: O(extents + piece) — no walk over crossed pieces;
 *   - a local content write updates its extent's length in place (O(extents));
 *   - each transaction reconciles from its changed structs (O(changed × piece)):
 *     a content change recomputes the length of its run; a structural change (mark /
 *     sub-flow / piece inserted or deleted, a registry entry appearing or vanishing)
 *     invalidates exactly the locators whose region or links it touches (the run's
 *     owner, the locators holding the item as a chain ¶ / start boundary / stop item,
 *     the item id's family). Grid / container changes clear all.
 *   - Ops apply the same rules EAGERLY inside their transaction (`noteMarkInserted`,
 *     `noteMarkDeleted`, `notePieceWrite`, `noteEntryChanged`, `clearLocators`), so
 *     composed in-transaction steps see their own writes.
 *
 * A hit is also validated: every role item must still be a live effective mark.
 */
import * as Y from "yjs";
import { addReconcileHook, addClearHook, transactionStructs, liveMarks } from "./mark-index";
import { getRegistry, entryShape } from "./registry";
import { markOf, isSubflowItem, isPiece, contentLength, pieceIndexOf, inDeletedFlow } from "./y-flow";
import {
  eff,
  nextU,
  prevU,
  firstUnitOfHolder,
  holderFlows,
  holderOfItem,
  visibleHolder,
  readCtx,
  buildTextLocator,
  type Eff,
  type ReadCtx,
} from "./flow-read";

/** One run of an entity's content: `len` content units after `after` in `piece`. */
export interface Extent {
  readonly piece: Y.Text;
  readonly after: Y.Item | null;
  len: number;
}

export interface LocatorInit {
  readonly id: string;
  readonly implicit: boolean;
  /** The entity's ¶ chain (empty for an implicit run). */
  readonly marks: readonly Eff[];
  readonly holder: string;
  /** The item the region stops at (exclusive): the chain's last ¶, or (implicit) the next object / null. */
  readonly boundary: Eff | null;
  /** The boundary item the region starts after (null = the holder start). */
  readonly anchorItem: Y.Item | null;
  readonly holderFlow: Y.Array<Y.Text> | null;
  /** The effective item after the region's stop item (it decides `nextId`), or null. */
  readonly nextItem: Y.Item | null;
  readonly prevId: string | null;
  readonly nextId: string | null;
}

/** A cached entity region (satisfies flow-read's `Region`). */
export class Locator {
  readonly extents: Extent[] = [];
  length = 0;
  valid = true;
  readonly roles: readonly Y.Item[];

  constructor(
    readonly ctx: ReadCtx,
    readonly init: LocatorInit,
  ) {
    const roles: Y.Item[] = init.marks.map((m) => m.item);
    if (init.anchorItem !== null) roles.push(init.anchorItem);
    if (init.boundary !== null && !roles.includes(init.boundary.item)) roles.push(init.boundary.item);
    if (init.nextItem !== null && !roles.includes(init.nextItem)) roles.push(init.nextItem);
    this.roles = roles;
  }

  get id(): string {
    return this.init.id;
  }
  get boundary(): Eff | null {
    return this.init.boundary;
  }
  get anchorItem(): Y.Item | null {
    return this.init.anchorItem;
  }
  /** First unit of the region (live: content may have been inserted since the build). */
  get start(): Y.Item | null {
    if (this.init.anchorItem !== null) return nextU(this.ctx, this.init.anchorItem);
    return firstUnitOfHolder(this.ctx, holderFlows(this.ctx, this.init.holder));
  }
  /** Where an offset-0 write of an anchor-less (holder-start) region goes. */
  get startPiece(): Y.Text | null {
    const f = this.init.holderFlow;
    const c = f?._start?.content;
    return c instanceof Y.ContentType && c.type instanceof Y.Text ? c.type : null;
  }
}

interface Store {
  readonly byId: Map<string, Locator>;
  readonly byRole: Map<Y.Item, Set<Locator>>;
  readonly byHolder: Map<Y.Array<Y.Text>, Set<Locator>>;
  readonly byRun: Map<Y.Text, Map<Y.Item | null, Locator>>;
  readonly byPiece: Map<Y.Text, Set<Locator>>;
  readonly byBase: Map<string, Set<Locator>>;
}

const stores = new WeakMap<Y.Doc, Store>();

function storeOf(doc: Y.Doc): Store {
  let s = stores.get(doc);
  if (s === undefined) {
    s = { byId: new Map(), byRole: new Map(), byHolder: new Map(), byRun: new Map(), byPiece: new Map(), byBase: new Map() };
    stores.set(doc, s);
  }
  return s;
}

const DUP_SUFFIX = /@\d+:\d+$/;

/** The mark id an entity id derives from (`X`, `X#i`, `X@c:k` → `X`). */
function baseOf(id: string): string {
  const s = id.endsWith("#i") ? id.slice(0, -2) : id;
  return s.replace(DUP_SUFFIX, "");
}

function addTo<K, V>(m: Map<K, Set<V>>, k: K, v: V): void {
  let set = m.get(k);
  if (set === undefined) {
    set = new Set();
    m.set(k, set);
  }
  set.add(v);
}

function removeFrom<K, V>(m: Map<K, Set<V>>, k: K, v: V): void {
  const set = m.get(k);
  if (set === undefined) return;
  set.delete(v);
  if (set.size === 0) m.delete(k);
}

function registerExtent(s: Store, loc: Locator, e: Extent): void {
  let runs = s.byRun.get(e.piece);
  if (runs === undefined) {
    runs = new Map();
    s.byRun.set(e.piece, runs);
  }
  runs.set(e.after, loc);
  addTo(s.byPiece, e.piece, loc);
}

function unregisterExtent(s: Store, loc: Locator, e: Extent): void {
  const runs = s.byRun.get(e.piece);
  if (runs !== undefined && runs.get(e.after) === loc) {
    runs.delete(e.after);
    if (runs.size === 0) s.byRun.delete(e.piece);
  }
}

function register(s: Store, loc: Locator): void {
  s.byId.set(loc.id, loc);
  addTo(s.byBase, baseOf(loc.id), loc);
  for (const r of loc.roles) {
    addTo(s.byRole, r, loc);
    if (isPiece(r.parent)) addTo(s.byPiece, r.parent, loc);
  }
  if (loc.init.holderFlow !== null) addTo(s.byHolder, loc.init.holderFlow, loc);
  for (const e of loc.extents) registerExtent(s, loc, e);
}

function invalidate(s: Store, loc: Locator): void {
  if (!loc.valid) return;
  loc.valid = false;
  if (s.byId.get(loc.id) === loc) s.byId.delete(loc.id);
  removeFrom(s.byBase, baseOf(loc.id), loc);
  for (const r of loc.roles) {
    removeFrom(s.byRole, r, loc);
    if (isPiece(r.parent)) removeFrom(s.byPiece, r.parent, loc);
  }
  if (loc.init.holderFlow !== null) removeFrom(s.byHolder, loc.init.holderFlow, loc);
  for (const e of loc.extents) {
    unregisterExtent(s, loc, e);
    removeFrom(s.byPiece, e.piece, loc);
  }
}

function invalidateAll(s: Store, set: ReadonlySet<Locator> | undefined): void {
  if (set === undefined) return;
  for (const loc of [...set]) invalidate(s, loc);
}

/**
 * {@link invalidateAll} + each one's linked locators: a structural change can rename
 * the entity on either side of it (a chain joins / splits, a duplicate becomes
 * consecutive), so the neighbours caching its id as a sibling link go too.
 */
function invalidateAllLinked(s: Store, set: ReadonlySet<Locator> | undefined): void {
  if (set === undefined) return;
  for (const loc of [...set]) invalidateLinked(s, loc);
}

/** True while every role item is still a live effective mark. */
function rolesValid(ctx: ReadCtx, loc: Locator): boolean {
  for (const r of loc.roles) if (r.deleted || eff(ctx, r) === null) return false;
  return true;
}

/** The cached, still-valid locator of `id`, or null (never builds). */
export function cachedLocator(ctx: ReadCtx, id: string): Locator | null {
  if (ctx.view !== undefined) return null; // a past version is never cached
  const s = stores.get(ctx.doc);
  const hit = s?.byId.get(id);
  if (s === undefined || hit === undefined) return null;
  if (hit.valid && rolesValid(ctx, hit)) return hit;
  invalidate(s, hit);
  return null;
}

/** Region walks paid by locator builds (a cost probe for tests and benches). */
export const locatorStats = { builds: 0 };

/** Fill a freshly built locator's extents (one region walk) and cache it. */
export function adoptLocator(loc: Locator): Locator {
  locatorStats.builds++;
  fillExtents(loc);
  if (loc.ctx.view === undefined) register(storeOf(loc.ctx.doc), loc);
  return loc;
}

/** The locator of text entity `id` (cached, or built by one region walk), or null. */
export function getLocator(ctx: ReadCtx, id: string): Locator | null {
  const hit = cachedLocator(ctx, id);
  if (hit !== null) return hit;
  const loc = buildTextLocator(ctx, id);
  return loc === null ? null : adoptLocator(loc);
}

/** The boundary item (live mark / sub-flow item) a run containing `item` starts after, or null at the piece start. */
export function runKeyLeft(item: Y.Item): Y.Item | null {
  for (let it = item.left; it !== null; it = it.left) {
    if (!it.deleted && (markOf(it) !== null || isSubflowItem(it))) return it;
  }
  return null;
}

function isBoundary(it: Y.Item): boolean {
  return !it.deleted && (markOf(it) !== null || isSubflowItem(it));
}

/** Content length of run `(piece, after)` now. O(run). */
function runLength(piece: Y.Text, after: Y.Item | null): number {
  let n = 0;
  for (let it = after === null ? piece._start : after.right; it !== null; it = it.right) {
    if (isBoundary(it)) break;
    n += contentLength(it);
  }
  return n;
}

/** Build the extents by one walk of the region (O(paragraph + E)). */
function fillExtents(loc: Locator): void {
  const ctx = loc.ctx;
  const stop = loc.init.boundary?.item ?? null;
  let piece: Y.Text | null = null;
  let after: Y.Item | null = null;
  let cur: Extent | null = null;
  for (let u = loc.start; u !== null && u !== stop; u = nextU(ctx, u)) {
    const p = u.parent;
    if (!(p instanceof Y.Text)) break;
    if (p !== piece) {
      piece = p;
      after = runKeyLeft(u);
      cur = null;
    }
    if (isBoundary(u)) {
      after = u;
      cur = null;
      continue;
    }
    const n = contentLength(u);
    if (n === 0) continue;
    if (cur === null) {
      cur = { piece: p, after, len: 0 };
      loc.extents.push(cur);
    }
    cur.len += n;
    loc.length += n;
  }
}

/** Index in `e.piece` of the run's first unit. O(piece). */
export function runStart(e: Extent): number {
  return e.after === null ? 0 : pieceIndexOf(e.after) + 1;
}

/** The extent holding block offset `offset` (> 0; a seam attaches to the earlier run) + the in-run offset. */
export function extentAt(loc: Locator, offset: number): { ext: Extent; inner: number; i: number } | null {
  // ponytail: linear scan over the extents (one per piece the paragraph spans);
  // a prefix-sum tree would make it O(log extents) if paragraphs span many pieces.
  let pos = 0;
  for (let i = 0; i < loc.extents.length; i++) {
    const ext = loc.extents[i];
    if (ext === undefined) continue;
    if (offset <= pos + ext.len) return { ext, inner: offset - pos, i };
    pos += ext.len;
  }
  return null;
}

/** Visit the entity's content units in order with their formatting; `visit` returning false stops. */
export function forEachUnit(loc: Locator, visit: (item: Y.Item, attrs: ReadonlyMap<string, unknown>) => boolean | void): void {
  for (const ext of loc.extents) {
    const first = ext.after === null ? ext.piece._start : ext.after.right;
    const cur = new Map<string, unknown>();
    for (let it = ext.piece._start; it !== null && it !== first; it = it.right) foldFormat(cur, it);
    let left = ext.len;
    for (let it = first; it !== null && left > 0; it = it.right) {
      if (it.deleted) continue;
      if (it.content instanceof Y.ContentFormat) {
        foldFormat(cur, it);
        continue;
      }
      const n = contentLength(it);
      if (n === 0) break;
      if (visit(it, cur) === false) return;
      left -= n;
    }
  }
}

function foldFormat(cur: Map<string, unknown>, it: Y.Item): void {
  if (it.deleted) return;
  const c = it.content;
  if (!(c instanceof Y.ContentFormat)) return;
  if (c.value === null) cur.delete(c.key);
  else cur.set(c.key, c.value);
}

// ---------------------------------------------------------------------------
// Local (in-transaction) maintenance
// ---------------------------------------------------------------------------

/**
 * A local write inserted `n` content units at block offset `offset` of `loc`, at
 * the undiverted point the locator resolved (`piece`, after the run boundary
 * `after` for an offset-0 write).
 */
export function noteInserted(loc: Locator, offset: number, n: number, piece: Y.Text, after: Y.Item | null): void {
  if (!loc.valid) return;
  const s = storeOf(loc.ctx.doc);
  if (offset > 0) {
    const at = extentAt(loc, offset);
    if (at === null) {
      invalidate(s, loc);
      return;
    }
    at.ext.len += n;
  } else {
    const first = loc.extents[0];
    if (first !== undefined && first.piece === piece && first.after === after) first.len += n;
    else {
      const e: Extent = { piece, after, len: n };
      loc.extents.unshift(e);
      registerExtent(s, loc, e);
    }
  }
  const wasEmpty = loc.length === 0;
  loc.length += n;
  // An implicit paragraph appearing changes its neighbours' links.
  if (loc.init.implicit && wasEmpty) invalidateLinked(s, loc);
}

/** A local delete removed `[offset, offset + n)` of `loc` (run lengths already applied by the caller). */
export function noteDeleted(loc: Locator, ext: Extent, n: number): void {
  if (!loc.valid) return;
  ext.len -= n;
  loc.length -= n;
  const s = storeOf(loc.ctx.doc);
  // An emptied run stays listed (length 0): the transaction's position mapping still
  // walks it for the deleted content (see `tx-mapping.ts`).
  // An implicit paragraph's identity / existence depends on its content: rebuild it.
  if (loc.init.implicit) invalidateLinked(s, loc);
}

/** Invalidate `loc` and the locators linked to it (sharing its anchor / boundary). */
function invalidateLinked(s: Store, loc: Locator): void {
  invalidate(s, loc);
  for (const r of loc.roles) invalidateAll(s, s.byRole.get(r));
  if (loc.init.holderFlow !== null) invalidateAll(s, s.byHolder.get(loc.init.holderFlow));
}

/** Drop `loc` (a write was diverted to a fresh piece / sub-flow: its runs changed). */
export function dropLocator(loc: Locator): void {
  invalidate(storeOf(loc.ctx.doc), loc);
}

/** Every locator dropped (grid / container / concatenation changes). */
export function clearLocators(doc: Y.Doc): void {
  const s = stores.get(doc);
  if (s === undefined) return;
  for (const loc of [...s.byId.values()]) invalidate(s, loc);
}

/** A raw write into `piece` (not through a locator): drop every locator touching it. */
export function notePieceWrite(doc: Y.Doc, piece: Y.Text): void {
  const s = stores.get(doc);
  if (s === undefined) return;
  invalidateAll(s, s.byPiece.get(piece));
}

/** Locators of `id`'s family (`id`, `id#i`, `id@c:k`) + those holding one of its marks in a role. */
function invalidateFamily(ctx: ReadCtx, s: Store, id: string): void {
  const base = baseOf(id);
  invalidateAll(s, s.byBase.get(base));
  for (const m of liveMarks(ctx.doc, base)) invalidateAll(s, s.byRole.get(m));
}

/**
 * The structural neighbourhood of `item` changed (a mark / sub-flow / piece appeared
 * there): drop the owner of the run it lands in and the locators linked at the
 * nearest effective marks on both sides. The owner is found by its run key in
 * O(piece); otherwise by walking to the nearest effective marks (O(paragraph + E)).
 */
function invalidateAround(ctx: ReadCtx, s: Store, item: Y.Item): void {
  if (s.byId.size === 0) return;
  const piece = item.parent;
  if (piece instanceof Y.Text) {
    const key = runKeyLeft(item);
    const owner = s.byRun.get(piece)?.get(key);
    if (owner !== undefined) {
      invalidateLinked(s, owner);
      return;
    }
    if (key !== null && s.byRole.has(key)) {
      // Directly after a cached entity's (anchor) mark: that entity owns the point.
      invalidateAllLinked(s, s.byRole.get(key));
      return;
    }
  }
  let before: Y.Item | null = null;
  for (let u = prevU(ctx, item); u !== null; u = prevU(ctx, u)) {
    if (eff(ctx, u) !== null) {
      before = u;
      break;
    }
  }
  if (before !== null) invalidateAllLinked(s, s.byRole.get(before));
  else {
    const h = holderOfItem(item);
    const f = h === null ? undefined : holderFlows(ctx, visibleHolder(ctx, h))[0];
    if (f !== undefined) invalidateAllLinked(s, s.byHolder.get(f));
  }
  for (let u = nextU(ctx, item); u !== null; u = nextU(ctx, u)) {
    if (eff(ctx, u) !== null) {
      invalidateAllLinked(s, s.byRole.get(u));
      break;
    }
  }
}

/** A mark or sub-flow item was inserted (eagerly by an op, or on reconcile). */
export function noteMarkInserted(doc: Y.Doc, item: Y.Item): void {
  const s = stores.get(doc);
  if (s === undefined || s.byId.size === 0) return;
  const ctx = readCtx(doc);
  invalidateAround(ctx, s, item);
  const m = markOf(item);
  if (m !== null) {
    invalidateFamily(ctx, s, m.end);
    if (m.section !== undefined) invalidateFamily(ctx, s, m.section);
    if (m.implicitOf !== undefined) invalidateFamily(ctx, s, m.implicitOf);
  }
}

/** A mark or sub-flow item was deleted: its roles, the runs on both sides of it, its family. */
export function noteMarkDeleted(doc: Y.Doc, item: Y.Item): void {
  const s = stores.get(doc);
  if (s === undefined || s.byId.size === 0) return;
  invalidateAllLinked(s, s.byRole.get(item));
  const piece = item.parent;
  if (piece instanceof Y.Text) {
    const runs = s.byRun.get(piece);
    const right = runs?.get(item);
    if (right !== undefined) invalidateLinked(s, right);
    const left = runs?.get(runKeyLeft(item));
    if (left !== undefined) invalidateLinked(s, left);
  }
  const m = markOf(item);
  if (m !== null) {
    const ctx = readCtx(doc);
    invalidateFamily(ctx, s, m.end);
    if (m.section !== undefined) invalidateFamily(ctx, s, m.section);
    if (m.implicitOf !== undefined) invalidateFamily(ctx, s, m.implicitOf);
  }
}

/** Registry entry `id` was created or deleted. */
export function noteEntryChanged(doc: Y.Doc, id: string): void {
  const s = stores.get(doc);
  if (s === undefined || s.byId.size === 0) return;
  const shape = entryShapeRaw(getRegistry(doc), id);
  if (shape !== null && shape !== "text" && shape !== "atomic" && shape !== "section") {
    clearLocators(doc);
    return;
  }
  const ctx = readCtx(doc);
  invalidateFamily(ctx, s, id);
  for (const m of liveMarks(doc, id)) invalidateAround(ctx, s, m);
}

// ---------------------------------------------------------------------------
// Transaction reconcile (local, remote, undo)
// ---------------------------------------------------------------------------

/**
 * The registry entry a non-flow struct sits under: its key, the entry sub-key (null
 * for the entry itself) and the entry's Item. Null when not under the registry or
 * inside a flow (flow content is handled as pieces).
 */
function registryPath(reg: Y.Map<Y.Map<unknown>>, it: Y.Item): { id: string; sub: string | null; entryItem: Y.Item } | null {
  const regType: unknown = reg;
  if (it.parent === regType) return it.parentSub === null ? null : { id: it.parentSub, sub: null, entryItem: it };
  let t: unknown = it.parent;
  let below: string | null = it.parentSub;
  while (t instanceof Y.AbstractType) {
    if (isPiece(t)) return null;
    const ti: Y.Item | null = t._item;
    if (ti === null) return null;
    if (ti.parent === regType) return ti.parentSub === null ? null : { id: ti.parentSub, sub: below, entryItem: ti };
    below = ti.parentSub;
    t = ti.parent;
  }
  return null;
}

/** Shape of a (possibly just deleted) registry entry, read raw (pre-GC) when deleted. */
function entryShapeRaw(reg: Y.Map<Y.Map<unknown>>, id: string): string | null {
  const live = reg.get(id);
  if (live !== undefined) return entryShape(live);
  const c = reg._map.get(id)?.content;
  if (!(c instanceof Y.ContentType) || !(c.type instanceof Y.Map)) return null;
  const shape: unknown = c.type._map.get("shape")?.content.getContent()[0];
  return typeof shape === "string" ? shape : null;
}

function reconcileLocators(doc: Y.Doc, tx: Y.Transaction): void {
  const s = stores.get(doc);
  if (s === undefined || s.byId.size === 0) return;
  const { inserted, deleted } = transactionStructs(tx);
  const ctx = readCtx(doc);
  const reg = getRegistry(doc);
  const insertedSet = new Set(inserted);
  const structuralIns: Y.Item[] = [];
  const structuralDel: Y.Item[] = [];
  const content: Y.Item[] = [];
  const entries = new Set<string>();
  const newPieces: Y.Text[] = [];
  const classify = (it: Y.Item, isInsert: boolean): boolean => {
    const p = it.parent;
    if (isPiece(p)) {
      if (inDeletedFlow(it)) return true;
      if (markOf(it) !== null || isSubflowItem(it)) (isInsert ? structuralIns : structuralDel).push(it);
      else if (!(p._item !== null && insertedSet.has(p._item))) content.push(it);
      return true;
    }
    if (p instanceof Y.Array && it.content instanceof Y.ContentType && isPiece(it.content.type)) {
      if (isInsert) newPieces.push(it.content.type);
      return true;
    }
    const path = registryPath(reg, it);
    if (path === null) return true;
    if (path.sub === null || insertedSet.has(path.entryItem) || path.entryItem.deleted) {
      entries.add(path.id);
      return true;
    }
    if (path.sub === "attrs" || path.sub === "type") return true;
    return false; // grid / flow / span / column change
  };
  for (const it of inserted) {
    if (!classify(it, true)) {
      clearLocators(doc);
      return;
    }
  }
  for (const it of deleted) {
    if (!classify(it, false)) {
      clearLocators(doc);
      return;
    }
  }
  for (const id of entries) {
    noteEntryChanged(doc, id);
    if (s.byId.size === 0) return;
  }
  for (const it of structuralDel) noteMarkDeleted(doc, it);
  for (const it of structuralIns) if (!it.deleted) noteMarkInserted(doc, it);
  for (const piece of newPieces) {
    const first = piece._start;
    if (first !== null) invalidateAround(ctx, s, first);
  }
  const seen = new Map<Y.Text, Set<Y.Item | null>>();
  for (const it of content) {
    const piece = it.parent;
    if (!(piece instanceof Y.Text)) continue;
    const key = runKeyLeft(it);
    let keys = seen.get(piece);
    if (keys === undefined) {
      keys = new Set();
      seen.set(piece, keys);
    }
    if (keys.has(key)) continue;
    keys.add(key);
    const owner = s.byRun.get(piece)?.get(key);
    if (owner === undefined) {
      invalidateAround(ctx, s, it);
      continue;
    }
    if (owner.init.implicit) {
      invalidateLinked(s, owner);
      continue;
    }
    const ext = owner.extents.find((e) => e.piece === piece && e.after === key);
    if (ext === undefined) {
      invalidateLinked(s, owner);
      continue;
    }
    const len = runLength(piece, key);
    owner.length += len - ext.len;
    ext.len = len;
  }
}

addReconcileHook(reconcileLocators);
addClearHook(clearLocators);

/** The cached owner entity of content unit `item` (O(piece)), or null when not cached. */
/** The cached locator + extent whose run holds content unit `item` (O(piece)), or null. */
export function cachedRunOf(doc: Y.Doc, item: Y.Item): { readonly loc: Locator; readonly ext: Extent } | null {
  const s = stores.get(doc);
  const piece = item.parent;
  if (s === undefined || !(piece instanceof Y.Text)) return null;
  const key = runKeyLeft(item);
  const loc = s.byRun.get(piece)?.get(key);
  if (loc === undefined || !loc.valid) return null;
  const ext = loc.extents.find((e) => e.piece === piece && e.after === key);
  return ext === undefined ? null : { loc, ext };
}

export function cachedOwnerOf(doc: Y.Doc, item: Y.Item): string | null {
  const s = stores.get(doc);
  const piece = item.parent;
  if (s === undefined || !(piece instanceof Y.Text)) return null;
  const owner = s.byRun.get(piece)?.get(runKeyLeft(item));
  return owner !== undefined && owner.valid ? owner.id : null;
}
