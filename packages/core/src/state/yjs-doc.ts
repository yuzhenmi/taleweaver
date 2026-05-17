import * as Y from "yjs";
import type { BlockId } from "./block-id";

const BLOCKS_KEY = "blocks";
const EMBED_CONTENTS_KEY = "embedContents";
const META_KEY = "meta";

export function createYDoc(args?: { rootId?: BlockId }): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap(BLOCKS_KEY);
  doc.getMap(EMBED_CONTENTS_KEY);
  const meta = doc.getMap(META_KEY);
  if (args?.rootId !== undefined) {
    meta.set("rootId", args.rootId);
  }
  return doc;
}

export function getBlocksMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(BLOCKS_KEY) as Y.Map<Y.Map<unknown>>;
}

export function getEmbedContentsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(EMBED_CONTENTS_KEY) as Y.Map<Y.Map<unknown>>;
}

export function getMetaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(META_KEY);
}

export interface TransactionResult {
  readonly dirtyIds: ReadonlySet<BlockId>;
}

// Yjs's Transaction#changed is typed as Map<AbstractType<YEvent<any>>, Set<string|null>>
// and #changedParentTypes uses the same key type. Y.Map's event-type generic is
// invariant, so to look up our concrete Y.Map<Y.Map<unknown>> instance we use
// reference identity and treat the map keys uniformly as AbstractType<YEvent<any>>.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyYType = Y.AbstractType<Y.YEvent<any>>;

/**
 * Runs `fn` inside a Y.Doc transaction and returns the set of BlockIds
 * whose subtree was touched. A BlockId becomes dirty when:
 *   - the blocks map adds/removes/replaces it as a key, OR
 *   - the embedContents map adds/removes/replaces it as a key, OR
 *   - any Y type nested under one of those entries is mutated.
 *
 * Implementation: attach an `afterTransaction` listener for the duration
 * of this call. Reentrant `runTransaction` calls are merged by Yjs into a
 * single outer transaction; the listener fires once with the union of all
 * changes.
 */
export function runTransaction(
  doc: Y.Doc,
  fn: () => void,
): TransactionResult {
  const dirtyIds = new Set<BlockId>();
  const blocksMap = getBlocksMap(doc);
  const embedContentsMap = getEmbedContentsMap(doc);
  const blocksMapAsAny = blocksMap as unknown as AnyYType;
  const embedContentsMapAsAny = embedContentsMap as unknown as AnyYType;

  const captureDirty = (tx: Y.Transaction) => {
    const blocksEvent = tx.changed.get(blocksMapAsAny);
    if (blocksEvent) {
      for (const key of blocksEvent) {
        if (key !== null) dirtyIds.add(key as BlockId);
      }
    }
    const embedsEvent = tx.changed.get(embedContentsMapAsAny);
    if (embedsEvent) {
      for (const key of embedsEvent) {
        if (key !== null) dirtyIds.add(key as BlockId);
      }
    }
    for (const [type] of tx.changedParentTypes) {
      const owningBlockId = findOwningBlockId(
        type,
        blocksMapAsAny,
        embedContentsMapAsAny,
        blocksMap,
        embedContentsMap,
      );
      if (owningBlockId !== null) {
        dirtyIds.add(owningBlockId);
      }
    }
  };

  doc.on("afterTransaction", captureDirty);
  try {
    doc.transact(fn);
  } finally {
    doc.off("afterTransaction", captureDirty);
  }
  return { dirtyIds };
}

/**
 * Walks up the Y type parent chain to find the BlockId that owns `type`,
 * i.e. the key under blocksMap or embedContentsMap whose value is an
 * ancestor of `type`. Returns null if `type` is not nested under either.
 *
 * O(depth) per call. Acceptable for P4e; revisit in P14 if benchmarks
 * justify a reverse map.
 */
function findOwningBlockId(
  type: AnyYType,
  blocksMapAsAny: AnyYType,
  embedContentsMapAsAny: AnyYType,
  blocksMap: Y.Map<Y.Map<unknown>>,
  embedContentsMap: Y.Map<Y.Map<unknown>>,
): BlockId | null {
  let cursor: AnyYType | null = type;
  while (cursor !== null) {
    const parent = cursor.parent as AnyYType | null;
    if (parent === blocksMapAsAny || parent === embedContentsMapAsAny) {
      const owningMap =
        parent === blocksMapAsAny ? blocksMap : embedContentsMap;
      for (const [key, value] of owningMap.entries()) {
        if ((value as unknown as AnyYType) === cursor) {
          return key as BlockId;
        }
      }
      return null;
    }
    cursor = parent;
  }
  return null;
}
