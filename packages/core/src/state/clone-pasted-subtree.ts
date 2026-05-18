import type { State } from "./state";
import { getBlock } from "./state";
import type { Block } from "./block";
import type { BlockId, IdAllocator } from "./block-id";
import type { InlineContent, InlineItem } from "./inline-content";

/**
 * The product of cloning a subtree from a source state. Self-contained:
 * `blocks` holds every cloned block (the root + all descendants + every
 * embed-referenced content block recursively), keyed by the NEW BlockId.
 * `rootId` is the new BlockId of the cloned root.
 *
 * The caller composes this with insertBlock (or similar) to merge the
 * cloned subtree into a destination state.
 *
 * `blocks` is a plain JS Map of immutable Block snapshots. This op does
 * NOT mutate the source State (the underlying Y.Doc is never touched).
 */
export interface ClonedSubtree {
  readonly blocks: ReadonlyMap<BlockId, Block>;
  readonly rootId: BlockId;
}

/**
 * Clone the subtree rooted at `sourceRootId` from `sourceState`. Allocates
 * fresh BlockIds for every cloned block and rewrites all internal id
 * references (parent/sibling/child pointers + embed contentBlockId).
 *
 * Walks: the root, all descendants (via firstChildId/nextSiblingId chains),
 * and every embed-referenced content block recursively. Cycle-defended.
 *
 * The cloned root has parentId / prevSiblingId / nextSiblingId all null —
 * it's a free-standing subtree-root, ready to be re-parented by the caller
 * during insertion. Non-root parent/sibling/child references are mapped
 * via the oldId → newId map.
 *
 * Throws if sourceRootId is not in sourceState, or if any reachable id
 * (child, sibling, contentBlockId) points to a block missing from
 * sourceState (corrupted source state).
 */
export function clonePastedSubtree(
  sourceState: State,
  sourceRootId: BlockId,
  allocator: IdAllocator,
): ClonedSubtree {
  if (getBlock(sourceState, sourceRootId) === null) {
    throw new Error(
      `clonePastedSubtree: source root "${sourceRootId}" not found in sourceState`,
    );
  }

  // Phase 1: collect all reachable block ids in the subtree.
  const visited = new Set<BlockId>();
  collectSubtreeIds(sourceState, sourceRootId, visited);

  // Phase 2: allocate a new id for each visited id.
  const idMap = new Map<BlockId, BlockId>();
  for (const oldId of visited) {
    idMap.set(oldId, allocator.allocate());
  }

  // Phase 3: construct cloned blocks with rewritten references.
  const clonedBlocks = new Map<BlockId, Block>();
  for (const oldId of visited) {
    const oldBlock = getBlock(sourceState, oldId);
    if (oldBlock === null) {
      // Defensive — visited only contains ids that resolved during phase 1.
      throw new Error(
        `clonePastedSubtree: block "${oldId}" disappeared between phase 1 and phase 3`,
      );
    }
    const newId = idMap.get(oldId);
    if (newId === undefined) {
      throw new Error(`clonePastedSubtree: missing newId for "${oldId}"`);
    }

    const isRoot = oldId === sourceRootId;

    const cloned: Block = Object.freeze({
      id: newId,
      type: oldBlock.type,
      attrs: oldBlock.attrs,
      parentId: isRoot ? null : mapId(oldBlock.parentId, idMap),
      prevSiblingId: isRoot ? null : mapId(oldBlock.prevSiblingId, idMap),
      nextSiblingId: isRoot ? null : mapId(oldBlock.nextSiblingId, idMap),
      firstChildId: mapId(oldBlock.firstChildId, idMap),
      lastChildId: mapId(oldBlock.lastChildId, idMap),
      inlineContent: oldBlock.inlineContent
        ? rewriteInlineContent(oldBlock.inlineContent, idMap)
        : null,
    });
    clonedBlocks.set(newId, cloned);
  }

  const clonedRootId = idMap.get(sourceRootId);
  if (clonedRootId === undefined) {
    throw new Error(`clonePastedSubtree: root "${sourceRootId}" missing from idMap`);
  }
  return { blocks: clonedBlocks, rootId: clonedRootId };
}

/**
 * Walk the subtree from `id` collecting every reachable BlockId into
 * `visited`. Includes:
 *   - the block itself
 *   - all descendants (firstChildId, then sibling chain via nextSiblingId
 *     within the subtree)
 *   - every embed-referenced content block (via item.properties.contentBlockId)
 *     and its subtree (recursively)
 *
 * Cycle defense: skip ids already in `visited`.
 *
 * Does NOT follow the input id's own nextSiblingId/prevSiblingId — those
 * are outside the subtree.
 */
function collectSubtreeIds(state: State, id: BlockId, visited: Set<BlockId>): void {
  if (visited.has(id)) return;
  const block = getBlock(state, id);
  if (block === null) {
    throw new Error(`clonePastedSubtree: referenced block "${id}" not found in sourceState`);
  }
  visited.add(id);

  // Walk children: from firstChildId, follow each child's nextSiblingId.
  // Cycle defense: collectSubtreeIds is a no-op for ids already in `visited`.
  let cur: BlockId | null = block.firstChildId;
  while (cur !== null) {
    collectSubtreeIds(state, cur, visited);
    const child = getBlock(state, cur);
    cur = child ? child.nextSiblingId : null;
  }

  // Walk embed-content references in this block's inline content.
  if (block.inlineContent) {
    for (const item of block.inlineContent.items) {
      if (item.kind === "embed") {
        const cbId = item.properties.contentBlockId;
        if (typeof cbId === "string") {
          collectSubtreeIds(state, cbId as BlockId, visited);
        }
      }
    }
  }
}

/** Map an old BlockId to a new BlockId via `idMap`. Returns null if the input is null. Throws if the input is non-null but absent from idMap (corrupted state — the walker should have visited every reachable block). */
function mapId(oldId: BlockId | null, idMap: Map<BlockId, BlockId>): BlockId | null {
  if (oldId === null) return null;
  const newId = idMap.get(oldId);
  if (newId === undefined) {
    throw new Error(`clonePastedSubtree: id "${oldId}" was not visited (subtree-walk inconsistency)`);
  }
  return newId;
}

/**
 * Build a fresh InlineContent with embed items' `properties.contentBlockId`
 * rewritten via `idMap`. Non-embed items and embeds without a `contentBlockId`
 * pass through unchanged (by reference).
 */
function rewriteInlineContent(
  content: InlineContent,
  idMap: Map<BlockId, BlockId>,
): InlineContent {
  const newItems: InlineItem[] = content.items.map((item) => {
    if (item.kind === "embed") {
      const cbId = item.properties.contentBlockId;
      if (typeof cbId === "string") {
        const newCbId = idMap.get(cbId as BlockId);
        if (newCbId === undefined) {
          throw new Error(
            `clonePastedSubtree: embed contentBlockId "${cbId}" was not visited`,
          );
        }
        const rewritten: InlineItem = Object.freeze({
          kind: "embed",
          embedType: item.embedType,
          attrs: item.attrs,
          properties: Object.freeze({ ...item.properties, contentBlockId: newCbId }),
        });
        return rewritten;
      }
    }
    return item;
  });
  return Object.freeze({ items: Object.freeze(newItems) });
}
