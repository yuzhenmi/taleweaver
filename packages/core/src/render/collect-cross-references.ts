import {
  BOOKMARK_START_EMBED_TYPE,
  CROSS_REFERENCE_EMBED_TYPE,
  bookmarkIdOf,
  pairBookmarkMarkers,
  getBlock,
  nextBlockInDocOrder,
  prevBlockInDocOrder,
  iterateBlocksInDocumentOrder,
} from "../state";
import { createWalkGuard } from "../state/state";
import type { Block, BlockId, BookmarkMarker, BookmarkRange, State } from "../state";
import { createPosition } from "../state";
import { recordSample } from "../perf/perf-trace";

/**
 * The document's cross-reference index: `hosts` — bookmarkId → the blocks holding a
 * field that references it — and `bookmarks` — bookmarkId → its paired range (the
 * duplicate-id rule of `pairBookmarkMarkers`).
 *
 * Why a reverse index: an edit's `dirtyIds` names the blocks a bookmark covers, not
 * the fields that display it. The incremental pass re-renders a host when a block its
 * bookmark covers is dirty (the text changed), its pairing changed, or the block
 * holding its start was renumbered (number mode).
 *
 * The index is maintained INCREMENTALLY from each render pass's dirty blocks
 * ({@link updateCrossReferenceIndex}): per-block marker / field entries hold
 * block-relative offsets, so an edit costs O(dirty blocks), not O(document) or
 * O(bookmarks). Its tables are handed from one cycle's index to the next (not
 * copied): a `RenderOutput`'s index is current until an incremental render consumes
 * it; a consumed index given again as `prev` is rebuilt from the state.
 */
export interface CrossReferenceIndex {
  readonly hosts: ReadonlyMap<string, ReadonlySet<BlockId>>;
  readonly bookmarks: ReadonlyMap<string, BookmarkRange>;
}

/** A bookmark marker of a block, with its id. */
interface Marker extends BookmarkMarker {
  readonly id: string;
}

/** A block's index inputs: its bookmark markers (block-relative) and the bookmarks its fields reference. */
interface BlockEntry {
  readonly markers: readonly Marker[];
  readonly fields: ReadonlySet<string>;
}

interface Tables {
  /** Blocks holding a bookmark marker or a field. */
  readonly blocks: Map<BlockId, BlockEntry>;
  /** bookmarkId → the blocks holding its markers. */
  readonly occurrences: Map<string, Set<BlockId>>;
  readonly hosts: Map<string, Set<BlockId>>;
  readonly bookmarks: Map<string, BookmarkRange>;
  /** Block → the paired bookmarks whose range touches it (start block … end block, document order). */
  readonly covered: Map<BlockId, Set<string>>;
  /** bookmarkId → the blocks its range touches (inverse of `covered`). */
  readonly spans: Map<string, Set<BlockId>>;
}

/** The tables each live index owns; a consumed index has none. */
const tablesOf = new WeakMap<CrossReferenceIndex, Tables>();

/** One block the index read (scanned or walked): a deterministic perf counter, no-op unless tracing. */
function countBlockRead(): void {
  recordSample("crossReferences.blockRead", 0);
}

function entryOf(block: Block | null): BlockEntry | null {
  if (block === null || block.inlineContent === null) return null;
  countBlockRead();
  const markers: Marker[] = [];
  const fields = new Set<string>();
  let offset = 0;
  for (const item of block.inlineContent.items) {
    if (item.kind === "embed") {
      const id = bookmarkIdOf(item);
      if (id !== null) markers.push({ id, blockId: block.id, offset, start: item.embedType === BOOKMARK_START_EMBED_TYPE });
      else if (item.embedType === CROSS_REFERENCE_EMBED_TYPE && typeof item.properties.bookmarkId === "string") {
        fields.add(item.properties.bookmarkId);
      }
    }
    offset += item.kind === "text" ? item.text.length : 1;
  }
  return markers.length === 0 && fields.size === 0 ? null : { markers, fields };
}

function addTo<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  const set = map.get(key);
  if (set === undefined) map.set(key, new Set([value]));
  else set.add(value);
}

function removeFrom<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  const set = map.get(key);
  if (set === undefined) return;
  set.delete(value);
  if (set.size === 0) map.delete(key);
}

function publish(t: Tables): CrossReferenceIndex {
  const index: CrossReferenceIndex = { hosts: t.hosts, bookmarks: t.bookmarks };
  tablesOf.set(index, t);
  return index;
}

/**
 * Set bookmark `id`'s pairing to `range` (undefined = broken) and its coverage: every
 * block from the start block to the end block in document order. O(span).
 */
function setPair(t: Tables, state: State, id: string, range: BookmarkRange | undefined): void {
  for (const b of t.spans.get(id) ?? []) removeFrom(t.covered, b, id);
  t.spans.delete(id);
  if (range === undefined) {
    t.bookmarks.delete(id);
    return;
  }
  t.bookmarks.set(id, range);
  const guard = createWalkGuard(state);
  for (let b: BlockId | null = range.start.blockId; b !== null; b = nextBlockInDocOrder(state, b)) {
    if (guard.step()) throw new Error(`cross-reference index: cycle in the block tree after "${b}"`);
    countBlockRead();
    addTo(t.covered, b, id);
    addTo(t.spans, id, b);
    if (b === range.end.blockId) break;
  }
}

/**
 * Document order of two main-tree blocks by walking forward from both in lockstep:
 * O(the distance between them), not O(document).
 */
function compareInDocumentOrder(state: State, a: BlockId, b: BlockId): number {
  if (a === b) return 0;
  let x: BlockId | null = a;
  let y: BlockId | null = b;
  const guard = createWalkGuard(state);
  for (;;) {
    if (guard.step()) throw new Error(`cross-reference index: cycle in the block tree after "${a}"`);
    countBlockRead();
    countBlockRead();
    x = x === null ? null : nextBlockInDocOrder(state, x);
    if (x === b) return -1;
    y = y === null ? null : nextBlockInDocOrder(state, y);
    if (y === a) return 1;
    if (x === null) return 1;
    if (y === null) return -1;
  }
}

/** Re-derive bookmark `id`'s pairing from its markers. O(its marker blocks + span). */
function repair(t: Tables, state: State, id: string): void {
  const blocks = [...(t.occurrences.get(id) ?? [])];
  if (blocks.length > 1) blocks.sort((a, b) => compareInDocumentOrder(state, a, b));
  const markers: Marker[] = [];
  for (const b of blocks) for (const m of t.blocks.get(b)?.markers ?? []) if (m.id === id) markers.push(m);
  setPair(t, state, id, pairBookmarkMarkers(markers));
}

function addEntry(t: Tables, blockId: BlockId, e: BlockEntry): void {
  t.blocks.set(blockId, e);
  for (const m of e.markers) addTo(t.occurrences, m.id, blockId);
  for (const f of e.fields) addTo(t.hosts, f, blockId);
}

/** The full index of `state`'s main tree. O(document). */
export function buildCrossReferenceIndex(state: State): CrossReferenceIndex {
  const t: Tables = {
    blocks: new Map(),
    occurrences: new Map(),
    hosts: new Map(),
    bookmarks: new Map(),
    covered: new Map(),
    spans: new Map(),
  };
  const byId = new Map<string, Marker[]>();
  for (const block of iterateBlocksInDocumentOrder(state)) {
    const e = entryOf(block);
    if (e === null) continue;
    addEntry(t, block.id, e);
    for (const m of e.markers) {
      const list = byId.get(m.id);
      if (list === undefined) byId.set(m.id, [m]);
      else list.push(m);
    }
  }
  for (const [id, markers] of byId) setPair(t, state, id, pairBookmarkMarkers(markers));
  return publish(t);
}

function sameShape(a: readonly Marker[], b: readonly Marker[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i]?.id !== b[i]?.id || a[i]?.start !== b[i]?.start) return false;
  return true;
}

/**
 * Whether block `id`'s place changed between the versions (a different parent or
 * neighbour): it may have MOVED (a move keeps block ids and marker sequences).
 */
function linksChanged(prevState: State, state: State, id: BlockId): boolean {
  const a = getBlock(prevState, id);
  const b = getBlock(state, id);
  return a !== null && b !== null && (a.parentId !== b.parentId || a.prevSiblingId !== b.prevSiblingId || a.nextSiblingId !== b.nextSiblingId);
}

/** The descendants of `id` (excluding `id`), depth-first. */
function* descendants(state: State, id: BlockId): Iterable<BlockId> {
  const guard = createWalkGuard(state);
  const stack: BlockId[] = [];
  for (let c = getBlock(state, id)?.firstChildId ?? null; c !== null; c = getBlock(state, c)?.nextSiblingId ?? null) stack.push(c);
  for (let c = stack.pop(); c !== undefined; c = stack.pop()) {
    if (guard.step()) throw new Error(`cross-reference index: cycle in the block tree under "${id}"`);
    yield c;
    for (let k = getBlock(state, c)?.firstChildId ?? null; k !== null; k = getBlock(state, k)?.nextSiblingId ?? null) stack.push(k);
  }
}

/**
 * The index of `state` from `prev` (the index of `prevState`) and the blocks that
 * changed between them, plus `staleHosts`: every field host whose resolved value may
 * have changed (a block its bookmark covers is dirty, its pairing changed, or its
 * start block is in `renumbered`). O(dirty blocks); an edit that adds / removes /
 * reorders a bookmark's markers also re-derives that bookmark (O(its span)).
 *
 * A MOVE keeps block ids and marker sequences, so a dirty block whose place changed
 * re-pairs the bookmarks it holds markers of, and a dirty CONTAINER re-derives its
 * whole subtree (its descendants are not dirty when it moves) — O(subtree), the
 * subtree the incremental render re-renders for a dirty container anyway. Any other
 * block whose markers kept their sequence keeps its pairing.
 */
export function updateCrossReferenceIndex(
  prev: CrossReferenceIndex,
  prevState: State,
  state: State,
  dirtyIds: ReadonlySet<BlockId>,
  renumbered: ReadonlySet<BlockId>,
): { readonly index: CrossReferenceIndex; readonly staleHosts: ReadonlySet<BlockId> } {
  const t = tablesOf.get(prev);
  if (t === undefined) {
    // `prev` was already consumed: rebuild, and treat every host as stale.
    const index = buildCrossReferenceIndex(state);
    const staleHosts = new Set<BlockId>();
    for (const hosts of index.hosts.values()) for (const h of hosts) staleHosts.add(h);
    return { index, staleHosts };
  }
  tablesOf.delete(prev);
  const stale = new Set<string>();
  const touched = new Set<string>();
  // The blocks whose coverage is re-derived: the dirty ones plus each dirty container's subtree.
  const rederive = new Set<BlockId>(dirtyIds);

  // 1. Per-block entries. Unchanged marker shape → shift the endpoints in place.
  for (const id of dirtyIds) {
    for (const b of t.covered.get(id) ?? []) stale.add(b);
    const before = t.blocks.get(id) ?? null;
    const after = entryOf(getBlock(state, id));
    for (const f of before?.fields ?? []) if (after?.fields.has(f) !== true) removeFrom(t.hosts, f, id);
    for (const f of after?.fields ?? []) addTo(t.hosts, f, id);
    const was = before?.markers ?? [];
    const now = after?.markers ?? [];
    for (const d of descendants(state, id)) {
      countBlockRead();
      rederive.add(d);
      for (const m of t.blocks.get(d)?.markers ?? []) touched.add(m.id);
    }
    if (sameShape(was, now) && (now.length === 0 || !linksChanged(prevState, state, id))) {
      for (let i = 0; i < now.length; i++) {
        const w = was[i];
        const n = now[i];
        if (w === undefined || n === undefined || w.offset === n.offset) continue;
        const r = t.bookmarks.get(w.id);
        if (r === undefined) continue;
        const start = w.start && r.start.blockId === id && r.start.offset === w.offset + 1 ? createPosition(id, n.offset + 1) : r.start;
        const end = !w.start && r.end.blockId === id && r.end.offset === w.offset ? createPosition(id, n.offset) : r.end;
        if (start !== r.start || end !== r.end) t.bookmarks.set(w.id, { start, end });
      }
    } else {
      for (const m of was) {
        touched.add(m.id);
        removeFrom(t.occurrences, m.id, id);
      }
      for (const m of now) {
        touched.add(m.id);
        addTo(t.occurrences, m.id, id);
      }
    }
    if (after === null) t.blocks.delete(id);
    else t.blocks.set(id, after);
  }

  // 2. Re-pair every bookmark whose markers changed.
  for (const id of touched) {
    stale.add(id);
    repair(t, state, id);
  }

  // 3. Coverage of each dirty / moved block: a block inside a range (inserted into it,
  //    moved in or out) inherits from its document-order predecessor every range that
  //    continues past it. Predecessors being re-derived are derived first.
  const done = new Set<BlockId>();
  const derive = (id: BlockId): void => {
    done.add(id);
    const have = t.covered.get(id);
    if (getBlock(state, id) === null) {
      for (const b of have ?? []) removeFrom(t.spans, b, id);
      t.covered.delete(id);
      return;
    }
    const want = new Set<string>();
    const p = prevBlockInDocOrder(state, id);
    if (p !== null) for (const b of t.covered.get(p) ?? []) if (t.bookmarks.get(b)?.end.blockId !== p) want.add(b);
    for (const m of t.blocks.get(id)?.markers ?? []) {
      const r = t.bookmarks.get(m.id);
      if (r !== undefined && (r.start.blockId === id || r.end.blockId === id)) want.add(m.id);
    }
    // Entering or leaving a range already made it stale above: the block (or its moved
    // container) was dirty and covered, or the change re-linked a covered neighbour
    // (the predecessor, or a container on its path), which is dirty and covered.
    for (const b of have ?? []) {
      if (want.has(b)) continue;
      removeFrom(t.covered, id, b);
      removeFrom(t.spans, b, id);
    }
    for (const b of want) {
      if (have?.has(b) === true) continue;
      addTo(t.covered, id, b);
      addTo(t.spans, b, id);
    }
  };
  for (const id of rederive) {
    if (done.has(id)) continue;
    const chain = [id];
    const inChain = new Set<BlockId>(chain);
    for (let p = prevBlockInDocOrder(state, id); p !== null && rederive.has(p) && !done.has(p) && !inChain.has(p); p = prevBlockInDocOrder(state, p)) {
      chain.push(p);
      inChain.add(p);
    }
    for (let i = chain.length - 1; i >= 0; i--) {
      const c = chain[i];
      if (c !== undefined) derive(c);
    }
  }

  // 4. Hosts to re-render.
  const staleHosts = new Set<BlockId>();
  for (const b of stale) for (const h of t.hosts.get(b) ?? []) staleHosts.add(h);
  for (const block of renumbered) {
    for (const b of t.covered.get(block) ?? []) {
      if (t.bookmarks.get(b)?.start.blockId !== block) continue;
      for (const h of t.hosts.get(b) ?? []) staleHosts.add(h);
    }
  }
  return { index: publish(t), staleHosts };
}
