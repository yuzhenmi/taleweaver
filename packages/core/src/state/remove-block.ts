import type { State, OperationResult } from "./state";
import type { BlockId } from "./block-id";
import { createBlock, type Block } from "./block";

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
 * TODO (future): cascade-delete embed-referenced content blocks from
 * `state.embedContents` for any embeds in the removed subtree's
 * inlineContent. The `state.embedContents` map doesn't yet exist;
 * today no code creates embed-referenced blocks so no orphaning
 * happens for that pathway. When embedContents lands, this function
 * will walk the removed subtree collecting
 * `EmbedItem.properties.contentBlockId` references and remove each
 * from embedContents.
 */
export function removeBlock(state: State, blockId: BlockId): OperationResult {
  const block = state.blocks.get(blockId);
  if (!block) {
    throw new Error(`removeBlock: block "${blockId}" not found`);
  }
  if (blockId === state.rootId) {
    throw new Error(`removeBlock: cannot remove the document root "${blockId}"`);
  }
  if (!block.parentId) {
    // Defensive: a non-root block with no parent is malformed state.
    // Note: when state.embedContents lands, footnote-body roots will
    // have parentId === null and SHOULD be removable via this function.
    // Revisit this guard at that time.
    throw new Error(`removeBlock: block "${blockId}" has no parentId (orphan)`);
  }

  const parentId = block.parentId;
  const parent = state.blocks.get(parentId);
  if (!parent) {
    throw new Error(`removeBlock: parent "${parentId}" of "${blockId}" not found`);
  }

  // Collect every id in the subtree (the block + all descendants).
  // Cycle-defended via the visited set itself.
  const subtreeIds = new Set<BlockId>();
  collectSubtreeIds(state, blockId, subtreeIds);

  // Delete every id in the subtree from state.blocks.
  let blocks = state.blocks;
  for (const id of subtreeIds) {
    blocks = blocks.delete(id);
  }
  const dirtyIds = new Set<BlockId>(subtreeIds);
  dirtyIds.add(parentId);

  // Relink prev sibling's nextSiblingId → block's nextSiblingId.
  if (block.prevSiblingId) {
    const prev = state.blocks.get(block.prevSiblingId);
    if (!prev) throw new Error(`removeBlock: prev sibling "${block.prevSiblingId}" not found`);
    blocks = blocks.set(block.prevSiblingId, withNextSibling(prev, block.nextSiblingId));
    dirtyIds.add(block.prevSiblingId);
  }

  // Relink next sibling's prevSiblingId → block's prevSiblingId.
  if (block.nextSiblingId) {
    const next = state.blocks.get(block.nextSiblingId);
    if (!next) throw new Error(`removeBlock: next sibling "${block.nextSiblingId}" not found`);
    blocks = blocks.set(block.nextSiblingId, withPrevSibling(next, block.prevSiblingId));
    dirtyIds.add(block.nextSiblingId);
  }

  // Update parent's firstChildId / lastChildId if the removed block was at a boundary.
  const newFirstChildId =
    parent.firstChildId === blockId ? block.nextSiblingId : parent.firstChildId;
  const newLastChildId =
    parent.lastChildId === blockId ? block.prevSiblingId : parent.lastChildId;
  blocks = blocks.set(parentId, withChildPointers(parent, newFirstChildId, newLastChildId));

  return {
    state: { ...state, blocks },
    dirtyIds,
  };
}

/**
 * Walk the subtree rooted at `rootId` and add every visited id to `out`.
 * Cycle-defended: a block already in `out` is not re-visited.
 */
function collectSubtreeIds(state: State, rootId: BlockId, out: Set<BlockId>): void {
  if (out.has(rootId)) return;
  const block = state.blocks.get(rootId);
  if (!block) return;
  out.add(rootId);
  let current = block.firstChildId;
  while (current) {
    if (out.has(current)) break; // defensive: sibling cycle
    collectSubtreeIds(state, current, out);
    const c = state.blocks.get(current);
    current = c ? c.nextSiblingId : null;
  }
}

function withNextSibling(b: Block, nextSiblingId: BlockId | null): Block {
  return createBlock({
    id: b.id,
    type: b.type,
    attrs: b.attrs,
    parentId: b.parentId,
    prevSiblingId: b.prevSiblingId,
    nextSiblingId,
    firstChildId: b.firstChildId,
    lastChildId: b.lastChildId,
    inlineContent: b.inlineContent,
  });
}

function withPrevSibling(b: Block, prevSiblingId: BlockId | null): Block {
  return createBlock({
    id: b.id,
    type: b.type,
    attrs: b.attrs,
    parentId: b.parentId,
    prevSiblingId,
    nextSiblingId: b.nextSiblingId,
    firstChildId: b.firstChildId,
    lastChildId: b.lastChildId,
    inlineContent: b.inlineContent,
  });
}

function withChildPointers(
  b: Block,
  firstChildId: BlockId | null,
  lastChildId: BlockId | null,
): Block {
  return createBlock({
    id: b.id,
    type: b.type,
    attrs: b.attrs,
    parentId: b.parentId,
    prevSiblingId: b.prevSiblingId,
    nextSiblingId: b.nextSiblingId,
    firstChildId,
    lastChildId,
    inlineContent: b.inlineContent,
  });
}
