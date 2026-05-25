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
} from "./yjs-doc";
import { assertNoNestedYTypes } from "./y-utils";
import { BLOCK_FIELDS } from "./block-schema";

/**
 * Per-State snapshot cache. Layered so `applyOperation` can produce a
 * new State whose cache reuses the input cache by reference instead of
 * copying every non-dirty entry — making per-mutation bookkeeping
 * O(dirtyIds.size) instead of O(N_cached).
 *
 * **Read fall-through (S-A2).** A read first checks this layer's
 * `blocks` / `embedContents` / `templateContents` map. On miss it
 * consults `invalidatedBlocks` / `invalidatedEmbeds` /
 * `invalidatedTemplates` — ids the most recent
 * mutation rendered stale on this layer; reads of those skip `base`
 * and re-snapshot from the Y.Doc. Otherwise (`base !== null` and the id
 * is not invalidated) the lookup recurses into `base`. Each successful
 * recursive hit also promotes the entry into this layer's own map so
 * subsequent reads are O(1).
 *
 * **Write fall-through.** Writes only ever touch this layer; `base` is
 * never mutated. This preserves the per-State view-stability property:
 * a State holding the older cache continues to see its pre-mutation
 * snapshots regardless of activity on the newer State.
 *
 * **Chain depth.** Each `applyOperation` (when non-no-op) pushes a new
 * layer with the previous cache as `base`. Depth grows linearly with
 * the number of mutations, but promote-on-read amortizes hot-block
 * reads to O(1); cold-block first reads pay O(depth) lookups. There is
 * no automatic flattening today — long-session memory growth is
 * bounded by the chain of per-layer `invalidatedBlocks` /
 * `invalidatedEmbeds` / `invalidatedTemplates` Sets plus the per-layer
 * promoted-block maps.
 * Adding a flattener is a future task if a measurement reveals it
 * matters.
 *
 * Root caches have `base === null` and empty invalidation sets.
 */
export interface SnapshotCache {
  /** Per-layer block snapshots: either freshly read on this layer, or
   *  promoted up from `base` by a prior read. Mutable to support
   *  promote-on-read amortization. */
  readonly blocks: Map<BlockId, Block>;
  /** Per-layer embed-content block snapshots. Same shape as `blocks`. */
  readonly embedContents: Map<BlockId, Block>;
  /** Per-layer template-content block snapshots. Same shape as `blocks`. */
  readonly templateContents: Map<BlockId, Block>;
  /** Block ids whose `base` entry is stale at this layer (the same id
   *  may be in any tree; we conservatively invalidate all trees
   *  because the cache layer cannot cheaply tell at write time). */
  readonly invalidatedBlocks: Set<BlockId>;
  readonly invalidatedEmbeds: Set<BlockId>;
  readonly invalidatedTemplates: Set<BlockId>;
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
    blocks: new Map(),
    embedContents: new Map(),
    templateContents: new Map(),
    invalidatedBlocks: new Set(),
    invalidatedEmbeds: new Set(),
    invalidatedTemplates: new Set(),
    base: null,
  };
}

/**
 * Construct an overlay cache on top of `base`. `dirtyIds` are the
 * ids touched by the transaction that produced this layer — they are
 * invalidated on the new layer so future reads do not see the stale
 * `base` entries. All invalidation sets share the same ids because
 * a single BlockId can belong to only one tree and the layer can't
 * cheaply distinguish at construction time; the wasted entries in the
 * unused sets are just one Set.has miss per uninvolved read.
 */
export function createOverlayCache(
  base: SnapshotCache,
  dirtyIds: ReadonlySet<BlockId>,
): SnapshotCache {
  return {
    blocks: new Map(),
    embedContents: new Map(),
    templateContents: new Map(),
    invalidatedBlocks: new Set(dirtyIds),
    invalidatedEmbeds: new Set(dirtyIds),
    invalidatedTemplates: new Set(dirtyIds),
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
 *   2. For each layer (top to bottom):
 *      a. For each blocks/embeds/templates entry: skip if already
 *         collected OR in the matching `invalidatedAbove*` set. Else
 *         collect.
 *      b. Add this layer's invalidations to `invalidatedAbove` BEFORE
 *         moving down (its invalidations apply to all lower layers).
 *   3. Return a fresh SnapshotCache with the collected entries,
 *      empty invalidation sets, `base = null`.
 *
 * Used by L-PERF-E (chain compaction). Without it, a paste handler
 * that chains ~8000 applyOperation calls leaves the chain 8000-deep;
 * subsequent reads pay O(depth) per call, making bulk ops O(N²).
 */
export function compactCache(
  prev: SnapshotCache,
  dirtyIds: ReadonlySet<BlockId>,
): SnapshotCache {
  const blocks = new Map<BlockId, Block>();
  const embedContents = new Map<BlockId, Block>();
  const templateContents = new Map<BlockId, Block>();
  const invalidatedAbove = new Set<BlockId>(dirtyIds);
  const invalidatedAboveEmbeds = new Set<BlockId>(dirtyIds);
  const invalidatedAboveTemplates = new Set<BlockId>(dirtyIds);
  let layer: SnapshotCache | null = prev;
  while (layer !== null) {
    for (const [id, snap] of layer.blocks) {
      if (blocks.has(id) || invalidatedAbove.has(id)) continue;
      blocks.set(id, snap);
    }
    for (const [id, snap] of layer.embedContents) {
      if (embedContents.has(id) || invalidatedAboveEmbeds.has(id)) continue;
      embedContents.set(id, snap);
    }
    for (const [id, snap] of layer.templateContents) {
      if (templateContents.has(id) || invalidatedAboveTemplates.has(id))
        continue;
      templateContents.set(id, snap);
    }
    for (const id of layer.invalidatedBlocks) invalidatedAbove.add(id);
    for (const id of layer.invalidatedEmbeds) invalidatedAboveEmbeds.add(id);
    for (const id of layer.invalidatedTemplates)
      invalidatedAboveTemplates.add(id);
    layer = layer.base;
  }
  return {
    blocks,
    embedContents,
    templateContents,
    invalidatedBlocks: new Set(),
    invalidatedEmbeds: new Set(),
    invalidatedTemplates: new Set(),
    base: null,
  };
}

/**
 * Evict the snapshot for `id` from the blocks, embedContents, and
 * templateContents sub-caches at this layer AND mark it invalidated so
 * any base fall-through cannot resurrect a stale entry. BlockIds are
 * globally unique across the three trees, so the id can live in at most
 * one map; deleting from all is cheap (O(1) miss) and avoids requiring
 * callers to know which tree owns the id.
 */
export function invalidateSnapshot(cache: SnapshotCache, id: BlockId): void {
  cache.blocks.delete(id);
  cache.embedContents.delete(id);
  cache.templateContents.delete(id);
  cache.invalidatedBlocks.add(id);
  cache.invalidatedEmbeds.add(id);
  cache.invalidatedTemplates.add(id);
}

/**
 * Clear every entry from this layer's maps and invalidate every key
 * known to the base chain. After this call, reads on this layer
 * re-snapshot from the Y.Doc for any id encountered, since both the
 * layer and (via invalidation) the base are excluded.
 */
export function invalidateAll(cache: SnapshotCache): void {
  cache.blocks.clear();
  cache.embedContents.clear();
  cache.templateContents.clear();
  // Walk the base chain to seed invalidation entries for every id the
  // chain knows about, so fall-through cannot resurrect a base hit.
  for (let layer: SnapshotCache | null = cache.base; layer !== null; layer = layer.base) {
    for (const id of layer.blocks.keys()) cache.invalidatedBlocks.add(id);
    for (const id of layer.embedContents.keys()) cache.invalidatedEmbeds.add(id);
    for (const id of layer.templateContents.keys())
      cache.invalidatedTemplates.add(id);
  }
}

/**
 * Iterative chain walk used by the read functions. Returns the
 * resolved Block (own-hit or base-hit) and the list of layers visited
 * during the descent, so the caller can promote the entry into each on
 * a fresh Y.Doc read or pass through an existing hit. Iteration —
 * rather than recursion — keeps stack depth O(1) regardless of how
 * many `applyOperation` calls have built up in a long editing session
 * (V8's default stack limit is ~10K frames; a recursive walk would
 * overflow there).
 */
type LayerKind = "block" | "embed" | "template";

/** Map a LayerKind to its snapshot-map field on SnapshotCache. */
const OWN_MAP_KEY: Record<LayerKind, "blocks" | "embedContents" | "templateContents"> = {
  block: "blocks",
  embed: "embedContents",
  template: "templateContents",
};

/** Map a LayerKind to its invalidation-set field on SnapshotCache. */
const INVALIDATION_KEY: Record<
  LayerKind,
  "invalidatedBlocks" | "invalidatedEmbeds" | "invalidatedTemplates"
> = {
  block: "invalidatedBlocks",
  embed: "invalidatedEmbeds",
  template: "invalidatedTemplates",
};

function walkChain(
  cache: SnapshotCache,
  id: BlockId,
  kind: LayerKind,
): { hit: Block | null; visited: SnapshotCache[] | null } {
  const ownMapKey = OWN_MAP_KEY[kind];
  const invalidationKey = INVALIDATION_KEY[kind];
  let visited: SnapshotCache[] | null = null;
  let layer: SnapshotCache | null = cache;
  while (layer !== null) {
    const own = layer[ownMapKey].get(id);
    if (own !== undefined) {
      return { hit: own, visited };
    }
    if (layer[invalidationKey].has(id)) {
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
  kind: LayerKind,
): void {
  if (visited === null) return;
  const mapKey = OWN_MAP_KEY[kind];
  for (const v of visited) v[mapKey].set(id, snap);
}

export function getBlockSnapshot(
  doc: Y.Doc,
  id: BlockId,
  cache: SnapshotCache,
): Block | null {
  const { hit, visited } = walkChain(cache, id, "block");
  if (hit !== null) {
    promoteInto(visited, id, hit, "block");
    return hit;
  }
  // Chain miss or invalidation-stop → fresh read from Y.Doc.
  const yBlock = getBlocksMap(doc).get(id);
  if (yBlock === undefined) return null;
  const snap = buildBlockSnapshot(id, yBlock);
  promoteInto(visited, id, snap, "block");
  return snap;
}

export function getEmbedContentSnapshot(
  doc: Y.Doc,
  id: BlockId,
  cache: SnapshotCache,
): Block | null {
  const { hit, visited } = walkChain(cache, id, "embed");
  if (hit !== null) {
    promoteInto(visited, id, hit, "embed");
    return hit;
  }
  const yBlock = getEmbedContentsMap(doc).get(id);
  if (yBlock === undefined) return null;
  const snap = buildBlockSnapshot(id, yBlock);
  promoteInto(visited, id, snap, "embed");
  return snap;
}

export function getTemplateContentSnapshot(
  doc: Y.Doc,
  id: BlockId,
  cache: SnapshotCache,
): Block | null {
  const { hit, visited } = walkChain(cache, id, "template");
  if (hit !== null) {
    promoteInto(visited, id, hit, "template");
    return hit;
  }
  const yBlock = getTemplateContentsMap(doc).get(id);
  if (yBlock === undefined) return null;
  const snap = buildBlockSnapshot(id, yBlock);
  promoteInto(visited, id, snap, "template");
  return snap;
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

function buildInlineContentSnapshot(yItems: Y.Array<Y.Map<unknown>>): InlineContent {
  const items: InlineItem[] = [];
  for (let i = 0; i < yItems.length; i++) {
    const yItem = yItems.get(i);
    const kind = yItem.get("kind") as "text" | "embed";
    if (kind === "text") {
      const yText = yItem.get("text") as Y.Text;
      const yAttrs = yItem.get("attrs") as Y.Map<unknown>;
      const item: TextItem = Object.freeze({
        kind: "text",
        text: yText.toString(),
        attrs: freezeAttrs(yMapToObject(yAttrs)),
      });
      items.push(item);
    } else {
      const embedType = yItem.get("embedType") as string;
      const yAttrs = yItem.get("attrs") as Y.Map<unknown>;
      const yProps = yItem.get("properties") as Y.Map<unknown>;
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
