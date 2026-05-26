import * as Y from "yjs";
import type { Block } from "./block";
import type { BlockId } from "./block-id";
import { getEmbedContentsMap, getTemplateContentsMap } from "./yjs-doc";
import type { SnapshotCache } from "./snapshot";
import {
  createSnapshotCache,
  getEmbedContentSnapshot,
  getTemplateContentSnapshot,
} from "./snapshot";

/**
 * Cached set of ROOT BlockIds (`parentId === null`) for one top-level
 * block-tree Y.Map (the embedContents map or the templateContents map),
 * plus a `stale` flag set by a flat `Y.Map.observe` handler.
 *
 * The set is recomputed lazily — only when `stale` is true on a read, i.e.
 * only after a key was added to or removed from the underlying map. Reads
 * on the common render path (which fire on every keystroke) hit the cached
 * set with no scan, preserving the engine's O(1)-per-keystroke contract for
 * footnote/header-heavy documents (#317).
 */
interface MapRootCache {
  /** The cached root-id set. Recomputed on read when `stale` is true. */
  rootIds: Set<BlockId>;
  /** Set true by the map observer on ANY key add/delete; cleared on recompute. */
  stale: boolean;
}

/**
 * Per-Y.Doc holder for the two root-id caches (embedContents,
 * templateContents), plus a per-map snapshot reader closed over the doc.
 * Created lazily on first accessor call.
 */
interface Holder {
  readonly embed: MapRootCache;
  readonly template: MapRootCache;
}

/**
 * The cache + observers ride the shared Y.Doc, NOT `State`.
 * `applyOperation` / `freshState` mint new State objects that SHARE the
 * same Y.Doc (structural sharing), and the maps are shared. Keying off the
 * doc means a keystroke (which produces a fresh State on the same doc)
 * never re-attaches observers or re-scans.
 *
 * WeakMap so a discarded Y.Doc (and its holder + the closure-captured
 * observers) is garbage-collected.
 */
const rootIdCaches = new WeakMap<Y.Doc, Holder>();

/**
 * Scan a tree Y.Map for ROOT ids — keys whose block snapshot has
 * `parentId === null`. Reads through the committed snapshot accessor so the
 * recompute observes whatever `parentId` is in the doc at recompute time,
 * sidestepping any "is the freshly-added block's parentId populated yet at
 * observe time" question (the observer only flags staleness; this read does
 * the work). A fresh throwaway snapshot cache is used — recompute is rare,
 * and this never touches the per-State view-stability cache.
 *
 * O(N_map_keys) — but only runs on a stale read, i.e. only after a root was
 * added or removed (a RARE event relative to keystrokes).
 */
function scanRootIds(
  map: Y.Map<Y.Map<unknown>>,
  readSnapshot: (id: BlockId, cache: SnapshotCache) => Block | null,
): Set<BlockId> {
  const rootIds = new Set<BlockId>();
  // ONE throwaway snapshot cache per scan (not per id). Recompute is rare,
  // and this never touches the per-State view-stability cache.
  const cache = createSnapshotCache();
  for (const id of map.keys() as IterableIterator<BlockId>) {
    const block = readSnapshot(id, cache);
    if (block !== null && block.parentId === null) rootIds.add(id);
  }
  return rootIds;
}

/**
 * Build a MapRootCache for one tree map: compute the initial root set and
 * attach a flat `observe` (NOT `observeDeep`) handler that marks the cache
 * stale on any key add/delete.
 *
 * Flat `observe` reacts only to the map's own key-set changes — a
 * `YMapEvent` fires on every key add/delete INCLUDING those inside
 * `UndoManager` transactions and cascade-deletes, so the cache stays
 * correct across undo/redo and cascade-delete (the load-bearing
 * invalidation requirement: an op-hook would miss the Yjs-surgery paths).
 * A deep observer would instead fire on every nested mutation — every
 * keystroke that edits an embed body's text — re-introducing the
 * per-keystroke cost we are removing.
 */
function buildMapRootCache(
  map: Y.Map<Y.Map<unknown>>,
  readSnapshot: (id: BlockId, cache: SnapshotCache) => Block | null,
): MapRootCache {
  const cache: MapRootCache = {
    rootIds: scanRootIds(map, readSnapshot),
    stale: false,
  };
  map.observe(() => {
    cache.stale = true;
  });
  return cache;
}

/** Lazily create (and observer-attach) the per-doc holder. */
function getHolder(doc: Y.Doc): Holder {
  const existing = rootIdCaches.get(doc);
  if (existing !== undefined) return existing;
  const holder: Holder = {
    embed: buildMapRootCache(getEmbedContentsMap(doc), (id, cache) =>
      getEmbedContentSnapshot(doc, id, cache),
    ),
    template: buildMapRootCache(getTemplateContentsMap(doc), (id, cache) =>
      getTemplateContentSnapshot(doc, id, cache),
    ),
  };
  rootIdCaches.set(doc, holder);
  return holder;
}

/** Recompute `cache.rootIds` if stale, then clear the flag. */
function ensureFresh(
  cache: MapRootCache,
  map: Y.Map<Y.Map<unknown>>,
  readSnapshot: (id: BlockId, snapshotCache: SnapshotCache) => Block | null,
): void {
  if (!cache.stale) return;
  cache.rootIds = scanRootIds(map, readSnapshot);
  cache.stale = false;
  _recomputeCounter++;
}

/**
 * The set of ROOT BlockIds (`parentId === null`) currently registered in
 * the doc's embedContents map. Lazily attaches observers on first call;
 * returns the cached set on the common path, recomputing only after a root
 * was added/removed.
 */
export function getEmbedContentRootIds(doc: Y.Doc): ReadonlySet<BlockId> {
  const holder = getHolder(doc);
  ensureFresh(holder.embed, getEmbedContentsMap(doc), (id, cache) =>
    getEmbedContentSnapshot(doc, id, cache),
  );
  return holder.embed.rootIds;
}

/**
 * The set of ROOT BlockIds (`parentId === null`) currently registered in
 * the doc's templateContents map. Mirrors `getEmbedContentRootIds`.
 */
export function getTemplateContentRootIds(doc: Y.Doc): ReadonlySet<BlockId> {
  const holder = getHolder(doc);
  ensureFresh(holder.template, getTemplateContentsMap(doc), (id, cache) =>
    getTemplateContentSnapshot(doc, id, cache),
  );
  return holder.template.rootIds;
}

/**
 * Test-only counter incremented each time a root-set is rescanned
 * (`ensureFresh` recompute). Lets tests assert the perf shape: keystrokes
 * that touch only main-tree blocks trigger 0 recomputes; one root add/remove
 * triggers exactly 1 recompute of that map's set. Production only pays the
 * increment (negligible) on the rare recompute path.
 */
let _recomputeCounter = 0;

export function __resetRootIdRecomputesForTest(): void {
  _recomputeCounter = 0;
}

export function __getRootIdRecomputesForTest(): number {
  return _recomputeCounter;
}
