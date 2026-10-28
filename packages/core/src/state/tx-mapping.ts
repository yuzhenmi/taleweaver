/**
 * Transaction-derived EXACT position mapping (schema 3).
 *
 * A transaction's effect on positions is read off the Yjs structure itself, right
 * after the transaction (in `afterTransaction`, before Yjs garbage-collects): the
 * version BEFORE it is the current structure with the transaction's inserted structs
 * not live and its deleted structs live (a `View`, see `flow-read.ts`). So no
 * snapshot of the previous State is needed — a block that was never read maps
 * exactly too.
 *
 * For every block the transaction affected in the PREVIOUS version (the owner of each
 * changed struct, every entity of a changed mark id — canonical renames —, the
 * `implicitOf` targets of materialization / joins, the entities around a registry
 * entry that appeared or vanished, every entity of a table whose grid changed), its
 * previous region is walked once in flow order, unit by unit, classifying each unit as
 * kept / deleted / inserted and following the CURRENT read model's block boundaries.
 * The result per block: the next-version segments it maps into (with a separator
 * between consecutive next blocks) and exact hunks — splits insert a separator, joins
 * delete one, renames (materialization, canonical change, join / collapse, seam / span
 * changes) switch the segment id with no hunk. Blocks inside a container the
 * transaction deleted map to nothing.
 *
 * Cost: O(changed + affected paragraphs) per transaction (one paragraph for a
 * keystroke), computed once and memoized per transaction.
 */
import * as Y from "yjs";
import type { BlockId } from "./block-id";
import { asBlockId } from "./block-id";
import type { Position } from "./block-position";
import { createPosition } from "./block-position";
import { transactionStructs, liveMarks, getMarkIndex, compareItems } from "./mark-index";
import { getRegistry, entryShape, entryString } from "./registry";
import { markOf, isPiece, inDeletedFlow, isSubflowItem, contentLength } from "./y-flow";
import { cachedRunOf, type Locator, type Extent } from "./locator";
import {
  readCtx,
  viewCtx,
  eff,
  clen,
  nextU,
  prevU,
  ownerOfUnit,
  resolveEntity,
  buildTextLocator,
  entityIdOfHead,
  chainHeadOf,
  entityOf,
  gapAfter,
  holderOfItem,
  firstUnitOfHolder,
  deriveBlock,
  holderFlows,
  visibleHolder,
  gridOf,
  type ReadCtx,
  type View,
} from "./flow-read";

/** A next-version segment: local offset `from` sits at region coordinate `base`. */
interface Seg {
  readonly id: string;
  readonly base: number;
  readonly from: number;
  length: number;
}

interface Hunk {
  a0: number;
  a1: number;
  b0: number;
  b1: number;
}

/** How one previous-version block maps into the next version. */
export interface BlockMap {
  /** The block's previous length. */
  readonly len: number;
  readonly segs: readonly Seg[];
  readonly hunks: readonly Hunk[];
}

/** One transaction's exact mapping. */
export interface TxMapping {
  /** Affected previous-version blocks (positions in any other block do not move). */
  readonly blocks: ReadonlyMap<string, BlockMap>;
  /** Previous-version blocks that left with their container (unmappable). */
  readonly gone: ReadonlySet<string>;
  /**
   * Every id whose read-model snapshot this transaction may have changed, as the
   * exact walk sees it: the affected previous blocks, the next blocks they map into,
   * and — for a block that was renamed or left (split / join / materialization /
   * canonical change) — its previous siblings and parent, whose links named it.
   */
  readonly touched: ReadonlySet<string>;
}

export type Assoc = -1 | 1;

const memo = new WeakMap<Y.Transaction, TxMapping>();
const prevMemo = new WeakMap<Y.Transaction, { view: View; ctx: ReadCtx }>();

function prevOf(doc: Y.Doc, tx: Y.Transaction): { view: View; ctx: ReadCtx } {
  const hit = prevMemo.get(tx);
  if (hit !== undefined) return hit;
  const view = viewBefore(doc, tx);
  const p = { view, ctx: viewCtx(doc, view) };
  prevMemo.set(tx, p);
  return p;
}

/** The version right before `tx` as a read context (memoized; shared by the mapping and the dirty compare). */
export function prevCtxOf(doc: Y.Doc, tx: Y.Transaction): ReadCtx {
  return prevOf(doc, tx).ctx;
}

/** The exact mapping of `tx` (memoized). Call inside `afterTransaction`. */
export function txMappingOf(doc: Y.Doc, tx: Y.Transaction): TxMapping {
  const hit = memo.get(tx);
  if (hit !== undefined) return hit;
  const m = computeTxMapping(doc, tx);
  memo.set(tx, m);
  return m;
}

/** The version right before `tx`, read off the current structure. */
function viewBefore(doc: Y.Doc, tx: Y.Transaction): View {
  const { inserted, deleted } = transactionStructs(tx);
  const ins = new Set(inserted);
  const del = new Set(deleted);
  const keepPieces = new Set<Y.Text>();
  const delMarks = new Map<string, Y.Item[]>();
  for (const it of deleted) {
    // A piece deleted with its container: the past version still reads it.
    if (it.content instanceof Y.ContentType && isPiece(it.content.type)) keepPieces.add(it.content.type);
    if (!isPiece(it.parent)) continue;
    keepPieces.add(it.parent);
    const m = markOf(it);
    if (m !== null) {
      for (const key of m.section === undefined ? [m.end] : [m.end, m.section]) {
        const list = delMarks.get(key) ?? [];
        list.push(it);
        delMarks.set(key, list);
      }
    }
  }
  const live = (it: Y.Item): boolean => !ins.has(it) && (!it.deleted || del.has(it));
  const get = (map: Y.Map<unknown>, key: string): unknown => {
    for (let it: Y.Item | null = map._map.get(key) ?? null; it !== null; it = it.left) {
      if (live(it)) return it.content.getContent()[it.length - 1];
    }
    return undefined;
  };
  const reg = getRegistry(doc);
  const idx = getMarkIndex(doc);
  // Lazy: a keystroke never reads it (no O(#sections) copy per transaction).
  let sectionMarks: Y.Item[] | null = null;
  const view: View = {
    live,
    get,
    entry: (id) => {
      const v = get(reg as unknown as Y.Map<unknown>, id);
      return v instanceof Y.Map ? (v as Y.Map<unknown>) : undefined;
    },
    ids: (arr) => {
      const out: string[] = [];
      for (let it = arr._start; it !== null; it = it.right) {
        if (!live(it) || !it.countable) continue;
        for (const v of it.content.getContent()) if (typeof v === "string") out.push(v);
      }
      return out;
    },
    canonical: (id) => {
      let best: Y.Item | null = null;
      for (const it of [...liveMarks(doc, id), ...(delMarks.get(id) ?? [])]) {
        if (!live(it)) continue;
        if (best === null || compareItems(it, best) < 0) best = it;
      }
      return best;
    },
    keep: (p) => keepPieces.has(p),
    get sectionMarks(): Iterable<Y.Item> {
      if (sectionMarks === null) {
        const out: Y.Item[] = [];
        for (const it of idx.sectionMarks) if (live(it)) out.push(it);
        for (const it of deleted) if (isPiece(it.parent) && markOf(it)?.section !== undefined) out.push(it);
        sectionMarks = out;
      }
      return sectionMarks;
    },
  };
  return view;
}

function computeTxMapping(doc: Y.Doc, tx: Y.Transaction): TxMapping {
  const { inserted, deleted } = transactionStructs(tx);
  const { view, ctx: prev } = prevOf(doc, tx);
  const next = readCtx(doc);
  const fast = contentOnly(doc, prev, inserted, deleted);
  if (fast !== null) return fast;
  const reg = getRegistry(doc);
  const affected = new Set<string>();
  const gone = new Set<string>();
  const tables = new Set<string>();

  /** The previous-version entity owning the position of `it`. */
  // Walks to the nearest previous-version mark are memoized across the transaction's
  // structs (a multi-paragraph paste inserts marks the previous version does not have:
  // without the memo every struct would walk back over the whole pasted run).
  const before = new Map<Y.Item, Y.Item | null>();
  const after = new Map<Y.Item, Y.Item | null>();
  const nearest = (
    from: Y.Item,
    step: (u: Y.Item) => Y.Item | null,
    memoOf: Map<Y.Item, Y.Item | null>,
  ): Y.Item | null => {
    const hit = memoOf.get(from);
    if (hit !== undefined) return hit;
    const path: Y.Item[] = [from];
    let res: Y.Item | null = null;
    for (let u = step(from); u !== null; u = step(u)) {
      if (eff(prev, u) !== null) {
        res = u;
        break;
      }
      const m = memoOf.get(u);
      if (m !== undefined) {
        res = m;
        break;
      }
      path.push(u);
    }
    for (const p of path) memoOf.set(p, res);
    return res;
  };
  const ownerIds = new Map<Y.Item, string>();
  const idOf = (mark: Y.Item): string | null => {
    const known = ownerIds.get(mark);
    if (known !== undefined) return known;
    const e = eff(prev, mark);
    if (e === null) return null;
    const id = entityOf(prev, e);
    ownerIds.set(mark, id);
    return id;
  };
  /**
   * The previous-version entity owning the position of `it`: the paragraph whose ¶ is
   * the next effective item, else (before an object / the flow end) the implicit run
   * after the previous one.
   */
  const ownerBefore = (it: Y.Item): string | null => {
    const fwd = nearest(it, (u) => nextU(prev, u), after);
    const fe = eff(prev, fwd);
    if (fe !== null && fe.shape === "text") return idOf(fe.item);
    const back = nearest(it, (u) => prevU(prev, u), before);
    if (back === null) {
      const h = holderOfItem(it);
      return h === null ? null : `${visibleHolder(prev, h)}#i`;
    }
    const b = idOf(back);
    return b === null ? null : `${b}#i`;
  };
  const seenAt = new Set<Y.Item>();
  /** The previous-version entity ending at item `it` (and the implicit run that may follow it). */
  const entityAt = (it: Y.Item): void => {
    if (seenAt.has(it)) return;
    seenAt.add(it);
    const id = idOf(it);
    if (id === null) return;
    affected.add(id);
    affected.add(`${id}#i`);
  };
  const family = (id: string): void => {
    for (const m of liveMarks(doc, id)) entityAt(m);
    const c = view.canonical(id);
    if (c !== null) entityAt(c);
    for (const it of deletedMarks.get(id) ?? []) entityAt(it);
  };
  const deletedMarks = new Map<string, Y.Item[]>();
  for (const it of deleted) {
    const mk = markOf(it);
    if (mk === null) continue;
    for (const key of mk.section === undefined ? [mk.end] : [mk.end, mk.section]) {
      const list = deletedMarks.get(key) ?? [];
      list.push(it);
      deletedMarks.set(key, list);
    }
  }
  const families = new Set<string>();
  const familyOnce = (id: string): void => {
    if (families.has(id)) return;
    families.add(id);
    family(id);
  };

  for (const it of [...inserted, ...deleted]) {
    if (isPiece(it.parent)) {
      if (inDeletedFlow(it)) {
        const o = view.live(it) ? ownerBefore(it) : null;
        if (o !== null) gone.add(o);
        continue;
      }
      const o = ownerBefore(it);
      if (o !== null) affected.add(o);
      const m = markOf(it);
      if (m !== null) {
        entityAt(it);
        // The next item's chain may join / split here (a duplicate becoming consecutive).
        const nextMark = nearest(it, (u) => nextU(prev, u), after);
        if (nextMark !== null) entityAt(nextMark);
        familyOnce(m.end);
        if (m.section !== undefined) familyOnce(m.section);
        if (m.implicitOf !== undefined) {
          affected.add(m.implicitOf);
          // A materialized holder-start / object implicit paragraph's anchor family.
          familyOnce(m.implicitOf.endsWith("#i") ? m.implicitOf.slice(0, -2) : m.implicitOf);
        }
      }
      continue;
    }
    // Registry side: an entry appearing / vanishing re-reads its marks; grid fields re-read the table.
    const path = registryKey(reg, it);
    if (path === null) continue;
    const { id, sub } = path;
    if (sub === "attrs" || sub === "type") continue;
    const entry = view.entry(id) ?? reg.get(id);
    const shape = entry === undefined ? null : entryShape(entry, view.get);
    if (shape === "table") tables.add(id);
    else if (entry !== undefined && (shape === "row" || shape === "cell")) {
      const rowId = shape === "row" ? id : (entryString(entry, "row", view.get) ?? entryString(entry, "row"));
      const re = rowId === undefined ? undefined : (view.entry(rowId) ?? reg.get(rowId));
      const t = re === undefined ? undefined : (entryString(re, "table", view.get) ?? entryString(re, "table"));
      if (t !== undefined) tables.add(t);
    }
    if (sub === null || shape === "text" || shape === "atomic" || shape === "section") {
      for (const m of liveMarks(doc, id)) {
        const o = ownerBefore(m);
        if (o !== null) affected.add(o);
      }
      familyOnce(id);
    }
  }
  for (const t of tables) for (const id of tableEntities(prev, t)) affected.add(id);

  const blocks = new Map<string, BlockMap>();
  const touched = new Set<string>([...affected, ...gone]);
  for (const id of affected) {
    if (gone.has(id) || blocks.has(id)) continue;
    const bm = mapBlock(prev, next, id, touched);
    if (bm === "gone") gone.add(id);
    else if (bm !== null) blocks.set(id, bm);
  }
  // Only ids that exist in one of the two versions (a walk may name an implicit
  // entity that exists in neither, e.g. a holder start before a fresh first mark).
  for (const t of [...touched]) {
    if (resolveEntity(prev, t) === null && resolveEntity(next, t) === null) {
      touched.delete(t);
      gone.delete(t);
    }
  }
  return { blocks, gone, touched };
}

/**
 * The common case — a transaction that changed only characters / inline embeds /
 * formats of blocks whose locators are cached (typing, deleting inside paragraphs,
 * a peer's keystroke): each block's prev / next offsets come from its extents, and
 * only the touched runs are walked. O(extents + touched runs × piece) — no walk
 * over the paragraph or the pieces it crosses. Null when the transaction is
 * structural or touches an uncached run (the general walk handles it).
 */
function contentOnly(doc: Y.Doc, prev: ReadCtx, inserted: readonly Y.Item[], deleted: readonly Y.Item[]): TxMapping | null {
  const reg = getRegistry(doc);
  const insertedSet = new Set(inserted);
  const runsBy = new Map<Locator, Set<Extent>>();
  for (const it of [...inserted, ...deleted]) {
    if (isPiece(it.parent)) {
      if (inDeletedFlow(it) || markOf(it) !== null || isSubflowItem(it)) return null;
      if (it.parent._item !== null && insertedSet.has(it.parent._item)) return null;
      const run = cachedRunOf(doc, it);
      if (run === null) return null;
      let set = runsBy.get(run.loc);
      if (set === undefined) {
        set = new Set();
        runsBy.set(run.loc, set);
      }
      set.add(run.ext);
      continue;
    }
    const path = registryKey(reg, it);
    if (path === null) {
      // A piece, or a sub-flow's internals: structural. Side tables (comments,
      // suggestions, meta) do not move positions.
      if (it.content instanceof Y.ContentType && isPiece(it.content.type)) return null;
      const owner: unknown = it.parent instanceof Y.AbstractType ? it.parent._item?.parent : null;
      if (owner instanceof Y.Text) return null;
      continue;
    }
    if (path.sub !== "attrs" && path.sub !== "type") return null;
  }
  const blocks = new Map<string, BlockMap>();
  const touched = new Set<string>();
  for (const [loc, runs] of runsBy) {
    const hunks: Hunk[] = [];
    let a = 0;
    let b = 0;
    let pending: Hunk | null = null;
    for (const ext of loc.extents) {
      if (!runs.has(ext)) {
        if (ext.len > 0) pending = null;
        a += ext.len;
        b += ext.len;
        continue;
      }
      for (let it = ext.after === null ? ext.piece._start : ext.after.right; it !== null; it = it.right) {
        if (!it.deleted && (markOf(it) !== null || isSubflowItem(it))) break;
        const pl = clen(prev, it);
        const nl = contentLength(it);
        if (pl === 0 && nl === 0) continue;
        if (pl > 0 && nl > 0) {
          pending = null;
          a += pl;
          b += nl;
          continue;
        }
        if (pending === null) {
          pending = { a0: a, a1: a, b0: b, b1: b };
          hunks.push(pending);
        }
        pending.a1 += pl;
        pending.b1 += nl;
        a += pl;
        b += nl;
      }
    }
    blocks.set(loc.id, { len: a, segs: [{ id: loc.id, base: 0, from: 0, length: b }], hunks });
    touched.add(loc.id);
  }
  return { blocks, gone: new Set(), touched };
}

/** The registry key a non-flow struct sits under + the entry sub-key (null = the entry itself). */
function registryKey(reg: Y.Map<Y.Map<unknown>>, it: Y.Item): { id: string; sub: string | null } | null {
  const regType: unknown = reg;
  if (it.parent === regType) return it.parentSub === null ? null : { id: it.parentSub, sub: null };
  let t: unknown = it.parent;
  let below: string | null = it.parentSub;
  while (t instanceof Y.AbstractType) {
    if (isPiece(t)) return null;
    const ti: Y.Item | null = t._item;
    if (ti === null) return null;
    if (ti.parent === regType) return ti.parentSub === null ? null : { id: ti.parentSub, sub: below };
    below = ti.parentSub;
    t = ti.parent;
  }
  return null;
}

/** Every text entity read in a table's cells in version `ctx` (O(table)). */
function tableEntities(ctx: ReadCtx, tableId: string): string[] {
  const out: string[] = [];
  const g = gridOf(ctx, tableId);
  if (g === null) return out;
  for (const cells of g.byRow.values()) {
    for (const gc of cells) {
      for (const cid of gc.cells) {
        for (const f of holderFlows(ctx, cid)) {
          const first = firstUnitOfHolder(ctx, [f]);
          if (first !== null) {
            const o = ownerOfUnit(ctx, first);
            if (o !== null) out.push(o.id);
          }
          for (let u = first; u !== null && holderOfItem(u) === cid; u = nextU(ctx, u)) {
            const e = eff(ctx, u);
            if (e !== null) out.push(entityIdOfHead(ctx, chainHeadOf(ctx, e)));
          }
        }
      }
      out.push(`${gc.id}#i`);
    }
  }
  return out;
}

/**
 * Walk previous-version block `id`'s region once, following the current read model's
 * blocks: the next segments + exact hunks. Null when `id` is not a text entity in the
 * previous version; "gone" when its region cannot be found any more.
 */
function mapBlock(prev: ReadCtx, next: ReadCtx, id: string, touched: Set<string>): BlockMap | "gone" | null {
  const loc = buildTextLocator(prev, id);
  if (loc === null) return resolveEntity(prev, id) === null || resolveEntity(next, id) !== null ? null : "gone";
  /** The block was renamed or left: whatever linked to it in the previous version re-reads. */
  const relink = (): void => {
    if (loc.init.prevId !== null) touched.add(loc.init.prevId);
    if (loc.init.nextId !== null) touched.add(loc.init.nextId);
    if (loc.init.prevId === null || loc.init.nextId === null) {
      const parent = deriveBlock(prev, id)?.block.parentId;
      if (parent !== undefined && parent !== null) touched.add(parent);
    }
  };
  const stop = loc.boundary?.item ?? null;
  const segs: Seg[] = [];
  const hunks: Hunk[] = [];
  let a = 0;
  let b = 0;
  let pending: Hunk | null = null;
  const change = (da: number, db: number): void => {
    if (pending === null) {
      pending = { a0: a, a1: a, b0: b, b1: b };
      hunks.push(pending);
    }
    pending.a1 += da;
    pending.b1 += db;
    a += da;
    b += db;
  };
  const open = (segId: string, from: number): void => {
    const last = segs[segs.length - 1];
    if (last !== undefined) {
      if (last.id === segId) return;
      if (last.length === 0 && resolveEntity(next, last.id) === null) {
        // A phantom (a block that no longer exists, e.g. materialized): rename in place.
        segs[segs.length - 1] = { id: segId, base: last.base, from, length: 0 };
        return;
      }
      change(0, 1); // the separator between two next blocks
    }
    segs.push({ id: segId, base: b, from, length: 0 });
  };
  // Where the previous region starts in the next version: the position just before its
  // first unit (a seam, join or collapse may continue an earlier block there).
  const first = loc.start;
  const o = first === null ? gapAfter(next, null, loc.init.holder) : ownerOfUnit(next, first);
  if (o === null) return "gone";
  open(o.id, o.offset);
  for (let u = first; u !== null && u !== stop; u = nextU(prev, u)) {
    const ne = eff(next, u);
    if (ne !== null) {
      // A boundary item in the next version: what follows belongs to the region after it.
      const g = gapAfter(next, ne, holderOfItem(ne.item) ?? loc.init.holder);
      const last = segs[segs.length - 1];
      if (g !== null && (last === undefined || last.id !== g.id)) open(g.id, g.offset);
      continue;
    }
    const pl = clen(prev, u);
    const nl = clen(next, u);
    if (pl === 0 && nl === 0) continue;
    const seg = segs[segs.length - 1];
    if (seg === undefined) return "gone";
    if (pl > 0 && nl > 0) {
      pending = null;
      a += pl;
      b += nl;
      seg.length += nl;
    } else if (pl > 0) change(pl, 0);
    else {
      change(0, nl);
      seg.length += nl;
    }
  }
  for (const seg of segs) touched.add(seg.id);
  if (segs[0]?.id !== id || resolveEntity(next, id) === null) relink();
  return { len: a, segs, hunks };
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

export interface MappedPos {
  readonly position: Position | null;
  readonly deleted: boolean;
}

/** Map a previous-version position through one transaction's mapping. */
export function mapThrough(m: TxMapping, position: Position, assoc: Assoc): MappedPos {
  const id: string = position.blockId;
  if (m.gone.has(id)) return { position: null, deleted: true };
  const bm = m.blocks.get(id);
  if (bm === undefined) return { position, deleted: false };
  const x = Math.max(0, Math.min(position.offset, bm.len));
  let delta = 0;
  let y = x;
  let deleted = false;
  let done = false;
  for (const h of bm.hunks) {
    if (x < h.a0) break;
    const oldSize = h.a1 - h.a0;
    const newSize = h.b1 - h.b0;
    if (x <= h.a1) {
      const side = oldSize === 0 ? assoc : x === h.a0 ? -1 : x === h.a1 ? 1 : assoc;
      deleted = oldSize > 0 && x !== (assoc < 0 ? h.a0 : h.a1);
      y = h.b0 + (side < 0 ? 0 : newSize);
      done = true;
      break;
    }
    delta += newSize - oldSize;
  }
  if (!done) y = x + delta;
  for (const seg of bm.segs) {
    if (y >= seg.base && y <= seg.base + seg.length) {
      return { position: createPosition(asBlockId(seg.id), seg.from + (y - seg.base)), deleted };
    }
  }
  return { position: null, deleted: true };
}

/** Whether the transaction changed content of `id` inside `[lo, hi]` (insertions strictly inside). */
export function blockTouched(m: TxMapping, id: string, lo: number, hi: number): boolean {
  if (m.gone.has(id)) return true;
  const bm = m.blocks.get(id);
  if (bm === undefined) return false;
  for (const h of bm.hunks) {
    if (h.a0 === h.a1 ? h.a0 > lo && h.a0 < hi : h.a0 < hi && h.a1 > lo) return true;
  }
  return false;
}

/** Previous-version blocks whose content changed (hunks) or left. */
export function changedBlocks(m: TxMapping): string[] {
  const out = [...m.gone];
  for (const [id, bm] of m.blocks) if (bm.hunks.length > 0 || bm.segs.some((s) => s.id !== id)) out.push(id);
  return out;
}

export type { BlockId };
