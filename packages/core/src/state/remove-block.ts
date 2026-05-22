import type { State, OperationResult } from "./state";
import { applyOperation, getBlock } from "./state";
import type { BlockId } from "./block-id";
import { getBlocksMap, getEmbedContentsMap, getYBlock } from "./yjs-doc";
import { collectEmbedContentSubtreeFromInlineContent } from "./embed-content-cascade";

/**
 * Remove a block (and its entire subtree) from the document tree.
 *
 * Per the spec's "no orphaned blocks" invariant, every block in
 * state.blocks must be reachable from state.rootId via parent/child
 * links (or referenced by an embed's contentBlockId, once embedContents
 * exists). When removing a container block, leaving its descendants
 * in state.blocks would orphan them. Therefore removeBlock always
 * deletes the named block AND its full subtree.
 *
 * Updates the linked-list pointers of the prev/next siblings of the
 * named block, and the parent's firstChildId / lastChildId if the
 * named block was at a boundary.
 *
 * Returns OperationResult with dirtyIds containing:
 *   - every id in the deleted subtree (the named block + all descendants)
 *   - the parent's id (firstChildId / lastChildId may have changed)
 *   - the previous sibling's id (its nextSiblingId is rewired) — if exists
 *   - the next sibling's id (its prevSiblingId is rewired) — if exists
 *
 * Render consumers must drop their cached render nodes for ids in
 * dirtyIds that are NOT in result.state.blocks (they were deleted).
 *
 * Throws if the block does not exist OR is the document root.
 *
 * Cascade-deletes embed-content references: walks the removed subtree's
 * inlineContent for `EmbedItem.properties.contentBlockId` references and
 * recursively removes each referenced block (plus its descendants and
 * any nested contentBlockId refs) from `state.embedContents`. This pass
 * fires ONLY for direct `removeBlock` calls; ops like `deleteRange` and
 * `replaceRange` transfer the focus block's inline content (including
 * embed anchors) into the anchor block, so they preserve embed
 * references rather than orphaning them.
 */
export function removeBlock(state: State, blockId: BlockId): OperationResult {
  const block = getBlock(state, blockId);
  if (block === null) {
    throw new Error(`removeBlock: block "${blockId}" not found`);
  }
  if (blockId === state.rootId) {
    throw new Error(`removeBlock: cannot remove the document root "${blockId}"`);
  }
  const parentId = block.parentId;
  if (parentId === null) {
    // Defensive: a non-root, non-orphan block in state.blocks must have a
    // parent. Embed-content blocks (which DO have parentId === null) live
    // in state.embedContents — not in state.blocks — and are removed via
    // cascade-delete from their referencing tree block, never directly
    // via removeBlock. So if we see a null-parent block here, state.blocks
    // is malformed.
    throw new Error(`removeBlock: block "${blockId}" has no parentId (orphan)`);
  }
  const parent = getBlock(state, parentId);
  if (parent === null) {
    throw new Error(`removeBlock: parent "${parentId}" of "${blockId}" not found`);
  }
  if (block.prevSiblingId !== null && getBlock(state, block.prevSiblingId) === null) {
    throw new Error(`removeBlock: prev sibling "${block.prevSiblingId}" not found`);
  }
  if (block.nextSiblingId !== null && getBlock(state, block.nextSiblingId) === null) {
    throw new Error(`removeBlock: next sibling "${block.nextSiblingId}" not found`);
  }

  return applyOperation(state, () => {
    const yBlocks = getBlocksMap(state.doc);

    // Collect every id in the subtree (the block + all descendants).
    // Cycle-defended via the visited set itself.
    const subtreeIds = new Set<BlockId>();
    collectSubtreeIds(state, blockId, subtreeIds);

    // Collect embed-content ids to cascade-delete: walk the removed
    // subtree's inlineContent for EmbedItem.properties.contentBlockId
    // references; recursively follow each via getEmbedContent.
    const embedContentIdsToDelete = new Set<BlockId>();
    for (const id of subtreeIds) {
      const subBlock = getBlock(state, id);
      if (subBlock === null || subBlock.inlineContent === null) continue;
      collectEmbedContentSubtreeFromInlineContent(
        state,
        subBlock.inlineContent,
        embedContentIdsToDelete,
      );
    }
    const yEmbeds = getEmbedContentsMap(state.doc);
    for (const id of embedContentIdsToDelete) {
      yEmbeds.delete(id);
    }

    // Relink prev sibling's nextSiblingId → block's nextSiblingId.
    if (block.prevSiblingId !== null) {
      getYBlock(state.doc, block.prevSiblingId, "removeBlock").set(
        "nextSiblingId",
        block.nextSiblingId,
      );
    }

    // Relink next sibling's prevSiblingId → block's prevSiblingId.
    if (block.nextSiblingId !== null) {
      getYBlock(state.doc, block.nextSiblingId, "removeBlock").set(
        "prevSiblingId",
        block.prevSiblingId,
      );
    }

    // Always write both keys on the parent — preserves the explicit
    // contract that parentId is always in dirtyIds (asserted by the
    // middle-child removal test). Yjs's same-value `.set` happens to
    // fire change events too, but we don't want the contract coupled
    // to that internal Yjs detail.
    const yParent = getYBlock(state.doc, parentId, "removeBlock");
    const newFirstChildId =
      yParent.get("firstChildId") === blockId ? block.nextSiblingId : yParent.get("firstChildId");
    const newLastChildId =
      yParent.get("lastChildId") === blockId ? block.prevSiblingId : yParent.get("lastChildId");
    yParent.set("firstChildId", newFirstChildId);
    yParent.set("lastChildId", newLastChildId);

    // Delete every id in the subtree from the blocks map.
    for (const id of subtreeIds) {
      yBlocks.delete(id);
    }
  });
}

/**
 * Walk the subtree rooted at `rootId` and add every visited id to `out`.
 * Cycle-defended: a block already in `out` is not re-visited.
 */
function collectSubtreeIds(state: State, rootId: BlockId, out: Set<BlockId>): void {
  if (out.has(rootId)) return;
  const block = getBlock(state, rootId);
  if (block === null) return;
  out.add(rootId);
  let current = block.firstChildId;
  while (current !== null) {
    if (out.has(current)) break; // defensive: sibling cycle
    collectSubtreeIds(state, current, out);
    const c = getBlock(state, current);
    current = c !== null ? c.nextSiblingId : null;
  }
}
