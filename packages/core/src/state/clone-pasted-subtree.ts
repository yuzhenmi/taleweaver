import type { State } from "./state";
import { getBlock, getEmbedContent } from "./state";
import type { Block } from "./block";
import type { BlockId, IdAllocator } from "./block-id";
import type { InlineContent, InlineItem } from "./inline-content";
import { assertNoIdCollision } from "./id-collision-check";
import { STATE_INTERNAL } from "./state-internal";
import { COMMENT_START_EMBED_TYPE, COMMENT_END_EMBED_TYPE } from "./comments";

/**
 * The product of cloning a subtree from a source state. Self-contained
 * across two maps:
 *
 *   - `blocks`: cloned main-tree blocks (the root + descendants reachable
 *     via firstChildId/nextSiblingId), keyed by the NEW BlockId.
 *   - `embedContents`: cloned embed-content blocks (footnote bodies and
 *     similar) reached via `EmbedItem.properties.contentBlockId`. Keyed
 *     by the NEW BlockId. Recursive: an embed-content block's own children
 *     and any further contentBlockId references it contains all land here
 *     as well.
 *
 * The split mirrors State.blocks vs State.embedContents segregation:
 * the caller inserts each map into the destination's matching tree.
 *
 * `rootId` is the new BlockId of the cloned root (always in `blocks`).
 *
 * Both maps are plain JS Maps of immutable Block snapshots. This op does
 * NOT mutate the source State (the underlying Y.Doc is never touched).
 */
export interface ClonedSubtree {
  readonly blocks: ReadonlyMap<BlockId, Block>;
  readonly embedContents: ReadonlyMap<BlockId, Block>;
  readonly rootId: BlockId;
}

/**
 * Clone the subtree rooted at `sourceRootId` from `sourceState`. Allocates
 * fresh BlockIds for every cloned block and rewrites all internal id
 * references (parent/sibling/child pointers + embed contentBlockId).
 *
 * Walks: the root and all descendants via `getBlock` (main tree), and
 * every embed-referenced content block recursively via `getEmbedContent`
 * (embed-content tree). Cycle-defended.
 *
 * Cloned main-tree blocks land in `result.blocks`; cloned embed-content
 * blocks (the contentBlockId targets and their own descendants / nested
 * embed-content refs) land in `result.embedContents`.
 *
 * The cloned root has parentId / prevSiblingId / nextSiblingId all null —
 * it's a free-standing subtree-root, ready to be re-parented by the caller
 * during insertion. Non-root parent/sibling/child references are mapped
 * via the oldId → newId map. Cloned embed-content blocks have
 * parentId === null by invariant (they live in a separate tree).
 *
 * Throws if sourceRootId is not in sourceState, or if any reachable id
 * (child, sibling, contentBlockId) points to a block missing from
 * the appropriate source map (corrupted source state).
 */
export function clonePastedSubtree(
  sourceState: State,
  sourceRootId: BlockId,
  allocator: IdAllocator,
  // The doc the clone will be inserted INTO — the namespace newly-allocated
  // ids must not collide with. Defaults to `sourceState` for same-document
  // paste (source === destination). For cross-document paste, pass the
  // destination state so the dev collision check guards the right namespace.
  destinationState: State = sourceState,
): ClonedSubtree {
  if (getBlock(sourceState, sourceRootId) === null) {
    throw new Error(
      `clonePastedSubtree: source root "${sourceRootId}" not found in sourceState`,
    );
  }

  // Phase 1: collect all reachable block ids, partitioned by tree.
  //   treeIds: ids reachable via main-tree walk (children).
  //   embedContentIds: ids reachable via EmbedItem.contentBlockId references
  //     (recursive: includes the embed-content's own children + nested refs).
  // The two sets are disjoint by construction — once an id is classified
  // as embed-content (because it was reached via a contentBlockId edge), the
  // walker uses `getEmbedContent` exclusively for further traversal from it.
  const treeIds = new Set<BlockId>();
  const embedContentIds = new Set<BlockId>();
  collectTreeSubtreeIds(sourceState, sourceRootId, treeIds, embedContentIds);

  // Phase 2: allocate a new id for each visited id. Allocation order:
  // tree ids first (in walk order), then embed-content ids. Either order
  // is valid — internal references are remapped by id, not by allocation
  // position.
  //
  // Each newly-allocated id is verified (in dev) against the DESTINATION
  // state's Y.Doc to detect colliding ids — the cloned subtree's ids must not
  // overlap with the namespace it will be inserted into, or downstream
  // merges/inserts will corrupt either tree. (For same-document paste
  // `destinationState === sourceState`.) This matters more here than for
  // single-block ops because clonePastedSubtree allocates many ids in a row,
  // multiplying collision risk under counter-based test allocators.
  const destinationDoc = destinationState[STATE_INTERNAL].doc;
  const idMap = new Map<BlockId, BlockId>();
  for (const oldId of treeIds) {
    const newId = allocator.allocate();
    assertNoIdCollision(destinationDoc, newId, "clonePastedSubtree");
    idMap.set(oldId, newId);
  }
  for (const oldId of embedContentIds) {
    const newId = allocator.allocate();
    assertNoIdCollision(destinationDoc, newId, "clonePastedSubtree");
    idMap.set(oldId, newId);
  }

  // Phase 3: construct cloned blocks with rewritten references, routed to
  // the correct output map by their classification.
  const clonedBlocks = new Map<BlockId, Block>();
  const clonedEmbedContents = new Map<BlockId, Block>();

  for (const oldId of treeIds) {
    const oldBlock = getBlock(sourceState, oldId);
    if (oldBlock === null) {
      // Defensive — treeIds only contains ids that resolved during phase 1.
      throw new Error(
        `clonePastedSubtree: block "${oldId}" disappeared between phase 1 and phase 3`,
      );
    }
    const newId = requireMapped(idMap, oldId);
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

  for (const oldId of embedContentIds) {
    const oldBlock = getEmbedContent(sourceState, oldId);
    if (oldBlock === null) {
      // Defensive — embedContentIds only contains ids that resolved during phase 1.
      throw new Error(
        `clonePastedSubtree: embed-content block "${oldId}" disappeared between phase 1 and phase 3`,
      );
    }
    const newId = requireMapped(idMap, oldId);

    // Embed-content blocks live in a separate tree; parent/sibling pointers
    // outside the cloned set are dropped (mapped to null). The source's
    // own parentId/prev/next may already be null (the typical case) — this
    // just preserves that. Children pointers within the embed-content
    // subtree DO get remapped via mapId.
    const cloned: Block = Object.freeze({
      id: newId,
      type: oldBlock.type,
      attrs: oldBlock.attrs,
      parentId: mapId(oldBlock.parentId, idMap),
      prevSiblingId: mapId(oldBlock.prevSiblingId, idMap),
      nextSiblingId: mapId(oldBlock.nextSiblingId, idMap),
      firstChildId: mapId(oldBlock.firstChildId, idMap),
      lastChildId: mapId(oldBlock.lastChildId, idMap),
      inlineContent: oldBlock.inlineContent
        ? rewriteInlineContent(oldBlock.inlineContent, idMap)
        : null,
    });
    clonedEmbedContents.set(newId, cloned);
  }

  const clonedRootId = idMap.get(sourceRootId);
  if (clonedRootId === undefined) {
    throw new Error(`clonePastedSubtree: root "${sourceRootId}" missing from idMap`);
  }
  return {
    blocks: clonedBlocks,
    embedContents: clonedEmbedContents,
    rootId: clonedRootId,
  };
}

/**
 * Walk the main-tree subtree from `id` collecting every reachable BlockId
 * into `treeIds`. Includes:
 *   - the block itself
 *   - all descendants (firstChildId, then sibling chain via nextSiblingId
 *     within the subtree)
 *   - every embed-referenced content block (via item.properties.contentBlockId)
 *     — those are resolved via `getEmbedContent` and recursed via
 *     collectEmbedContentSubtreeIds; their ids land in `embedContentIds`.
 *
 * Cycle defense: skip ids already classified into either set.
 *
 * Does NOT follow the input id's own nextSiblingId/prevSiblingId — those
 * are outside the subtree.
 */
function collectTreeSubtreeIds(
  state: State,
  id: BlockId,
  treeIds: Set<BlockId>,
  embedContentIds: Set<BlockId>,
): void {
  if (treeIds.has(id) || embedContentIds.has(id)) return;
  const block = getBlock(state, id);
  if (block === null) {
    throw new Error(`clonePastedSubtree: referenced block "${id}" not found in sourceState`);
  }
  treeIds.add(id);

  // Walk children: from firstChildId, follow each child's nextSiblingId.
  // Cycle defense: collectTreeSubtreeIds is a no-op for ids already classified.
  let cur: BlockId | null = block.firstChildId;
  while (cur !== null) {
    if (treeIds.has(cur) || embedContentIds.has(cur)) break;
    collectTreeSubtreeIds(state, cur, treeIds, embedContentIds);
    const child = getBlock(state, cur);
    cur = child ? child.nextSiblingId : null;
  }

  // Walk embed-content references — resolve via getEmbedContent (embed-tree split).
  if (block.inlineContent) {
    for (const item of block.inlineContent.items) {
      if (item.kind !== "embed") continue;
      const cbId = item.properties.contentBlockId;
      if (typeof cbId !== "string") continue;
      collectEmbedContentSubtreeIds(state, cbId as BlockId, treeIds, embedContentIds);
    }
  }
}

/**
 * Walk an embed-content subtree from `id` (looking up via `getEmbedContent`).
 * Includes the block itself, its descendants (children + sibling chain),
 * and any further embed-content references it contains. All visited ids
 * land in `embedContentIds`.
 *
 * Cycle defense: skip ids already classified into either set. If an id is
 * already in `treeIds` (id collision between the two trees — pathological
 * but defensively handled), we skip; the main-tree classification wins,
 * matching `resolveBlock`'s main → embedContents precedence.
 */
function collectEmbedContentSubtreeIds(
  state: State,
  id: BlockId,
  treeIds: Set<BlockId>,
  embedContentIds: Set<BlockId>,
): void {
  if (treeIds.has(id) || embedContentIds.has(id)) return;
  const block = getEmbedContent(state, id);
  if (block === null) {
    throw new Error(
      `clonePastedSubtree: referenced embed-content block "${id}" not found in sourceState`,
    );
  }
  embedContentIds.add(id);

  // Walk children of the embed-content block (if any). Children of an
  // embed-content block are themselves embed-content.
  let cur: BlockId | null = block.firstChildId;
  while (cur !== null) {
    if (treeIds.has(cur) || embedContentIds.has(cur)) break;
    collectEmbedContentSubtreeIds(state, cur, treeIds, embedContentIds);
    const child = getEmbedContent(state, cur);
    cur = child ? child.nextSiblingId : null;
  }

  // Walk nested embed-content references.
  if (block.inlineContent) {
    for (const item of block.inlineContent.items) {
      if (item.kind !== "embed") continue;
      const cbId = item.properties.contentBlockId;
      if (typeof cbId !== "string") continue;
      collectEmbedContentSubtreeIds(state, cbId as BlockId, treeIds, embedContentIds);
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

/** Like `mapId` but for a non-null input — returns the mapped id, throwing if absent. */
function requireMapped(idMap: Map<BlockId, BlockId>, oldId: BlockId): BlockId {
  const newId = idMap.get(oldId);
  if (newId === undefined) {
    throw new Error(`clonePastedSubtree: id "${oldId}" missing from idMap (allocator inconsistency)`);
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
  const newItems: InlineItem[] = content.items.flatMap((item) => {
    if (item.kind === "embed") {
      // Strip comment-range markers: pasting commented text must NOT duplicate
      // the comment / its commentId (Google-Docs-faithful — a paste of a
      // commented range drops the markers, leaving the copied text uncommented).
      // The markers carry `properties.commentId` and own no body, so they pass
      // the contentBlockId/targetId rebinds below verbatim if not dropped here.
      if (
        item.embedType === COMMENT_START_EMBED_TYPE ||
        item.embedType === COMMENT_END_EMBED_TYPE
      ) {
        return [];
      }
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
      // A POINTER embed (a cross-reference: `properties.targetId`) points at a block
      // it does NOT own — unlike `contentBlockId`, which the walkers follow + clone.
      // The walkers never follow `targetId` (they key on `contentBlockId`), so the
      // target is in `idMap` ONLY when it was independently part of the copied
      // subtree. Rebind in that case (you copied the reference AND its target → the
      // clone references the cloned target, matching Google Docs); otherwise leave it
      // pointing at the ORIGINAL target (the target is outside the paste). NEVER throw
      // on a missing id — a pointer to an outside block is a legal state.
      const targetId = item.properties.targetId;
      if (typeof targetId === "string") {
        const newTargetId = idMap.get(targetId as BlockId);
        if (newTargetId !== undefined) {
          const rewritten: InlineItem = Object.freeze({
            kind: "embed",
            embedType: item.embedType,
            attrs: item.attrs,
            properties: Object.freeze({ ...item.properties, targetId: newTargetId }),
          });
          return rewritten;
        }
      }
    }
    return item;
  });
  return Object.freeze({ items: Object.freeze(newItems) });
}
