import * as Y from "yjs";
import type { Block } from "./block";
import type { BlockId } from "./block-id";
import type { ReadonlyAttrs } from "./attrs";
import type {
  InlineContent,
  InlineItem,
  TextItem,
  EmbedItem,
} from "./inline-content";
import {
  getBlocksMap,
  getEmbedContentsMap,
  getTemplateContentsMap,
  type BlockTreeKind,
} from "./yjs-doc";
import { assertNoNestedYTypes } from "./y-utils";
import { BLOCK_FIELDS } from "./block-schema";

/**
 * The three top-level block trees a snapshot can come from. A BlockId is
 * globally unique across all three (the allocator never reuses an id;
 * `id-collision-check.ts` defends the vanishingly-rare `crypto.randomUUID`
 * collision), so an id lives in at most one tree.
 *
 * This is `yjs-doc`'s `BlockTreeKind` — the SINGLE discriminant for the three
 * trees (`"block" | "embedContent" | "templateContent"`, the keys of
 * `TREE_MAP_GETTERS`). The snapshot cache deliberately reuses it rather than
 * defining a parallel `"block" | "embed" | "template"` enum, so adding a fourth
 * tree is a one-place change and there is no name-mismatch to track.
 */
const TREE_KINDS: readonly BlockTreeKind[] = [
  "block",
  "embedContent",
  "templateContent",
];

/** Build an empty per-tree snapshot-map record. */
function emptySnapshots(): Record<BlockTreeKind, Map<BlockId, Block>> {
  return { block: new Map(), embedContent: new Map(), templateContent: new Map() };
}

/**
 * Per-State snapshot cache. Layered so `applyOperation` can produce a
 * new State whose cache reuses the input cache by reference instead of
 * copying every non-dirty entry — making per-mutation bookkeeping
 * O(dirtyIds.size) instead of O(N_cached).
 *
 * **Per-tree snapshot maps, ONE invalidation set.** Snapshots are kept in
 * a per-`BlockTreeKind` map record because the three accessors are
 * tree-specific: `getBlockSnapshot(embedId)` must return `null` (the id is
 * not in the main tree) even though that same id resolves under
 * `getEmbedContentSnapshot` — and `resolveBlock` relies on that precedence.
 * A single id-keyed map could not make that distinction on a cache hit.
 * Invalidation, by contrast, collapses to a SINGLE `invalidated` set:
 * because ids are globally unique, marking an id stale and re-reading it
 * from the accessor's own tree Y.Map is correct regardless of which tree it
 * lives in (an over-broad invalidation at worst forces one extra Y.Doc read
 * that returns the same data — never wrong data). Adding a 4th tree means
 * extending `BlockTreeKind` / `TREE_KINDS`; the per-op code is already a loop.
 *
 * **Read fall-through (S-A2).** A read first checks this layer's
 * `snapshots[kind]` map. On miss it consults `invalidated` — ids the most
 * recent mutation rendered stale on this layer; reads of those skip `base`
 * and re-snapshot from the Y.Doc. Otherwise (`base !== null` and the id is
 * not invalidated) the lookup recurses into `base`. Each successful
 * recursive hit also promotes the entry into every visited layer's
 * `snapshots[kind]` map so subsequent reads are O(1).
 *
 * **Write fall-through.** Writes only ever touch this layer; `base` is
 * never mutated. This preserves the per-State view-stability property:
 * a State holding the older cache continues to see its pre-mutation
 * snapshots regardless of activity on the newer State.
 *
 * **Chain depth.** Each `applyOperation` (when non-no-op) pushes a new
 * layer with the previous cache as `base`. Depth grows linearly with
 * the number of mutations, but promote-on-read amortizes hot-block
 * reads to O(1); cold-block first reads pay O(depth) lookups.
 * `applyOperation` compacts the chain once it exceeds a threshold so a
 * bulk op (paste) cannot leave an arbitrarily deep chain.
 *
 * Root caches have `base === null` and an empty invalidation set.
 */
export interface SnapshotCache {
  /** Per-tree, per-layer block snapshots. Either freshly read on this
   *  layer, or promoted up from `base` by a prior read. Mutable maps to
   *  support promote-on-read amortization. */
  readonly snapshots: Record<BlockTreeKind, Map<BlockId, Block>>;
  /** Ids whose `base` entry is stale at this layer; reads of these skip
   *  fall-through and re-snapshot from the Y.Doc. One set across all trees
   *  (ids are globally unique).
   *
   *  IMMUTABLE after construction. `ReadonlySet` (not `Set`) is load-bearing:
   *  `walkChain` checks the own `snapshots[kind]` hit BEFORE `invalidated`, and
   *  `promoteInto` writes the fresh post-mutation snapshot into the very layer
   *  whose `invalidated` stopped the chain. That promoted entry is correct ONLY
   *  because `invalidated` never grows after this layer is built — every
   *  invalidation for this layer is known at construction (`createOverlayCache`
   *  seeds it from the producing transaction's `dirtyIds`). A post-construction
   *  `.add` would make an already-promoted snapshot silently win over a newer
   *  invalidation. The type forbids that at compile time. */
  readonly invalidated: ReadonlySet<BlockId>;
  /** Underlying cache layer for fall-through reads, or null for a root
   *  cache produced by `createSnapshotCache` / `freshState`. */
  readonly base: SnapshotCache | null;
}

/**
 * Construct a root (base-less) cache. Used by `createState`,
 * `freshState`, and the post-no-op short-circuit's untouched return.
 */
export function createSnapshotCache(): SnapshotCache {
  return {
    snapshots: emptySnapshots(),
    invalidated: new Set(),
    base: null,
  };
}

/**
 * Construct an overlay cache on top of `base`. `dirtyIds` are the
 * ids touched by the transaction that produced this layer — they are
 * invalidated on the new layer so future reads do not see the stale
 * `base` entries.
 */
export function createOverlayCache(
  base: SnapshotCache,
  dirtyIds: ReadonlySet<BlockId>,
): SnapshotCache {
  return {
    snapshots: emptySnapshots(),
    invalidated: new Set(dirtyIds),
    base,
  };
}

/**
 * Count the depth of the layer chain rooted at `cache`. Used by
 * `applyOperation` to decide when to compact (L-PERF-E). O(depth) but
 * called once per applyOperation, never inside a tight loop.
 */
export function chainDepth(cache: SnapshotCache): number {
  let n = 0;
  let layer: SnapshotCache | null = cache;
  while (layer !== null) {
    n++;
    layer = layer.base;
  }
  return n;
}

/**
 * Flatten the chain rooted at `prev` into a single root-level
 * `SnapshotCache`, plus invalidate `dirtyIds` (the ids touched by the
 * applyOperation that's triggering compaction). Subsequent reads on
 * the returned cache are O(1) — no chain to walk.
 *
 * Algorithm (top-down walk, newest entries win):
 *   1. Seed `invalidatedAbove` with `dirtyIds` (this op invalidates
 *      every cached entry at every layer for those ids).
 *   2. For each layer (top to bottom): collect each snapshot entry unless
 *      already collected OR in `invalidatedAbove`; then fold this layer's
 *      `invalidated` into `invalidatedAbove` BEFORE moving down (its
 *      invalidations apply to all lower layers).
 *   3. Return a fresh SnapshotCache with the collected entries, an empty
 *      invalidation set, `base = null`.
 *
 * Used by L-PERF-E (chain compaction). Without it, a paste handler
 * that chains many applyOperation calls leaves a deep chain; subsequent
 * reads pay O(depth) per call, making bulk ops O(N²).
 */
export function compactCache(
  prev: SnapshotCache,
  dirtyIds: ReadonlySet<BlockId>,
): SnapshotCache {
  const snapshots = emptySnapshots();
  const invalidatedAbove = new Set<BlockId>(dirtyIds);
  let layer: SnapshotCache | null = prev;
  while (layer !== null) {
    for (const kind of TREE_KINDS) {
      const out = snapshots[kind];
      for (const [id, snap] of layer.snapshots[kind]) {
        if (out.has(id) || invalidatedAbove.has(id)) continue;
        out.set(id, snap);
      }
    }
    for (const id of layer.invalidated) invalidatedAbove.add(id);
    layer = layer.base;
  }
  return {
    snapshots,
    invalidated: new Set(),
    base: null,
  };
}

/**
 * Iterative chain walk used by the read functions. Returns the resolved
 * Block (own-hit or base-hit) and the list of layers visited during the
 * descent, so the caller can promote the entry into each on a fresh Y.Doc
 * read or pass through an existing hit. Iteration — rather than recursion —
 * keeps stack depth O(1) regardless of how many `applyOperation` calls have
 * built up in a long editing session (V8's default stack limit is ~10K
 * frames; a recursive walk would overflow there).
 *
 * Tree-specific on hits (it reads `snapshots[kind]`), but uses the single
 * `invalidated` set for the stop check. The caller's Y.Map choice on a full
 * chain miss is encoded by the same `kind` (see `readSnapshot`).
 */
function walkChain(
  cache: SnapshotCache,
  id: BlockId,
  kind: BlockTreeKind,
): { hit: Block | null; visited: SnapshotCache[] | null } {
  let visited: SnapshotCache[] | null = null;
  let layer: SnapshotCache | null = cache;
  while (layer !== null) {
    const own = layer.snapshots[kind].get(id);
    if (own !== undefined) {
      // Own-hit wins WITHOUT consulting `invalidated`. This is correct even
      // when `id` is also in this layer's `invalidated`: such an entry can only
      // have been written by `promoteInto` on a prior read (which carries the
      // FRESH post-mutation snapshot up into the invalidation-stop layer), and
      // `invalidated` is immutable after construction (see SnapshotCache field
      // doc) — so the own entry is never staler than `invalidated` implies.
      return { hit: own, visited };
    }
    if (layer.invalidated.has(id)) {
      // Include this layer in the visited list so its post-mutation
      // view also receives the fresh re-snapshot.
      if (visited === null) visited = [layer];
      else visited.push(layer);
      return { hit: null, visited };
    }
    if (visited === null) visited = [layer];
    else visited.push(layer);
    layer = layer.base;
  }
  return { hit: null, visited };
}

function promoteInto(
  visited: SnapshotCache[] | null,
  id: BlockId,
  snap: Block,
  kind: BlockTreeKind,
): void {
  if (visited === null) return;
  for (const v of visited) v.snapshots[kind].set(id, snap);
}

/**
 * Shared read path for all three trees. Walks the cache chain's `kind`
 * sub-map; on a full miss, reads the cold block from `getYMap(doc)` (the
 * tree-specific Y.Map) and promotes the fresh snapshot into every visited
 * layer's `kind` sub-map.
 */
function readSnapshot(
  doc: Y.Doc,
  id: BlockId,
  cache: SnapshotCache,
  kind: BlockTreeKind,
  getYMap: (doc: Y.Doc) => Y.Map<Y.Map<unknown>>,
): Block | null {
  const { hit, visited } = walkChain(cache, id, kind);
  if (hit !== null) {
    promoteInto(visited, id, hit, kind);
    return hit;
  }
  // Chain miss or invalidation-stop → fresh read from the tree's Y.Map.
  const yBlock = getYMap(doc).get(id);
  if (yBlock === undefined) return null;
  const snap = buildBlockSnapshot(id, yBlock);
  promoteInto(visited, id, snap, kind);
  return snap;
}

export function getBlockSnapshot(
  doc: Y.Doc,
  id: BlockId,
  cache: SnapshotCache,
): Block | null {
  return readSnapshot(doc, id, cache, "block", getBlocksMap);
}

export function getEmbedContentSnapshot(
  doc: Y.Doc,
  id: BlockId,
  cache: SnapshotCache,
): Block | null {
  return readSnapshot(doc, id, cache, "embedContent", getEmbedContentsMap);
}

export function getTemplateContentSnapshot(
  doc: Y.Doc,
  id: BlockId,
  cache: SnapshotCache,
): Block | null {
  return readSnapshot(doc, id, cache, "templateContent", getTemplateContentsMap);
}

/**
 * Read a required field from a block's Y.Map. Yjs `Y.Map.get` returns
 * `undefined` for absent keys, distinct from a value that was
 * deliberately set to `null`. Casting the result silently widens
 * `undefined` to the expected type and crashes opaquely downstream;
 * this helper turns "missing key" into a clear error naming the field.
 */
function requireField<T>(yBlock: Y.Map<unknown>, id: BlockId, key: string): T {
  const raw = yBlock.get(key);
  if (raw === undefined) {
    throw new Error(
      `buildBlockSnapshot: block "${id}" missing required "${key}" field`,
    );
  }
  return raw as T;
}

/**
 * Like requireField, but for fields whose legal value-set includes
 * `null` (e.g. `parentId`, `inlineContent`). `null` is a valid value
 * meaning "no parent" / "container without inline content"; `undefined`
 * (the key wasn't set) is still an error.
 */
function requireNullableField<T>(
  yBlock: Y.Map<unknown>,
  id: BlockId,
  key: string,
): T | null {
  const raw = yBlock.get(key);
  if (raw === undefined) {
    throw new Error(
      `buildBlockSnapshot: block "${id}" missing required "${key}" field (use null for absence)`,
    );
  }
  return raw as T | null;
}

/**
 * Build a frozen Block snapshot from a block's inner Y.Map. Iterates the
 * shared BLOCK_FIELDS catalog and dispatches on each field's `kind`, so
 * the read path cannot drift from the write path's field list (see
 * block-schema.ts for the compile-time coverage check).
 */
function buildBlockSnapshot(id: BlockId, yBlock: Y.Map<unknown>): Block {
  // We accumulate into a record then cast to Block at the end. The cast is
  // safe because (a) BLOCK_FIELDS' compile-time coverage check guarantees
  // every Block field except `id` is iterated, (b) `id` is assigned
  // separately below, and (c) each kind's branch assigns a value of the
  // correct shape for its key.
  const result: Record<string, unknown> = { id };
  for (const spec of BLOCK_FIELDS) {
    switch (spec.kind) {
      case "string": {
        result[spec.key] = requireField<string>(yBlock, id, spec.key);
        break;
      }
      case "id-nullable": {
        result[spec.key] = requireNullableField<BlockId>(yBlock, id, spec.key);
        break;
      }
      case "attrs-map": {
        const yAttrs = requireField<Y.Map<unknown>>(yBlock, id, spec.key);
        result[spec.key] = freezeAttrs(yMapToObject(yAttrs));
        break;
      }
      case "inline-content-array-nullable": {
        const yInline = requireNullableField<Y.Array<Y.Map<unknown>>>(
          yBlock,
          id,
          spec.key,
        );
        result[spec.key] =
          yInline === null ? null : buildInlineContentSnapshot(yInline);
        break;
      }
    }
  }
  return Object.freeze(result) as unknown as Block;
}

/**
 * Like `requireField`, but for an inline item inside `buildInlineContentSnapshot`.
 * Yjs `Y.Map.get` returns `undefined` for absent keys; casting the result
 * silently widens `undefined` to the expected type and crashes opaquely
 * downstream (e.g. `Cannot read properties of undefined`). This turns a
 * malformed item (a collab peer / migration that wrote an item missing a
 * required key) into a clear error naming the field and its index.
 */
function requireItemField<T>(
  yItem: Y.Map<unknown>,
  i: number,
  key: string,
): T {
  const raw = yItem.get(key);
  if (raw === undefined) {
    throw new Error(
      `buildInlineContentSnapshot: inline item at index ${i} missing required "${key}" field`,
    );
  }
  return raw as T;
}

function buildInlineContentSnapshot(yItems: Y.Array<Y.Map<unknown>>): InlineContent {
  const items: InlineItem[] = [];
  for (let i = 0; i < yItems.length; i++) {
    const yItem = yItems.get(i);
    const kind = requireItemField<"text" | "embed">(yItem, i, "kind");
    if (kind === "text") {
      const yText = requireItemField<Y.Text>(yItem, i, "text");
      const yAttrs = requireItemField<Y.Map<unknown>>(yItem, i, "attrs");
      const item: TextItem = Object.freeze({
        kind: "text",
        text: yText.toString(),
        attrs: freezeAttrs(yMapToObject(yAttrs)),
      });
      items.push(item);
    } else {
      const embedType = requireItemField<string>(yItem, i, "embedType");
      const yAttrs = requireItemField<Y.Map<unknown>>(yItem, i, "attrs");
      const yProps = requireItemField<Y.Map<unknown>>(yItem, i, "properties");
      const item: EmbedItem = Object.freeze({
        kind: "embed",
        embedType,
        attrs: freezeAttrs(yMapToObject(yAttrs)),
        properties: Object.freeze(yMapToObject(yProps)),
      });
      items.push(item);
    }
  }
  return Object.freeze({ items: Object.freeze(items) });
}

/**
 * Read a Y.Map of attrs/properties into a plain object. Asserts that no
 * value (or nested array/object value) is a live Yjs shared type — see
 * `assertNoNestedYTypes` in y-utils.ts. Without this guard a snapshot
 * could embed a live Y.Map/Y.Text reference, defeating the "frozen
 * value snapshot" contract and propagating cross-doc on paste.
 */
function yMapToObject(yMap: Y.Map<unknown>): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [key, value] of yMap.entries()) {
    assertNoNestedYTypes(value, key);
    obj[key] = value;
  }
  return obj;
}

function freezeAttrs(obj: Record<string, unknown>): ReadonlyAttrs {
  return Object.freeze(obj) as ReadonlyAttrs;
}
