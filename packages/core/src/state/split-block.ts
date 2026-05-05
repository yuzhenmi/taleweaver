import type { State, OperationResult } from "./state";
import type { BlockId, IdAllocator } from "./block-id";
import type { Position } from "./block-position";
import {
  createInlineContent,
  createTextItem,
  inlineContentLength,
  findItemAtOffset,
  type InlineContent,
  type InlineItem,
} from "./inline-content";
import { createBlock, type Block } from "./block";

/**
 * Split a leaf block at `position` into two adjacent siblings under the
 * same parent.
 *
 * The original block keeps its id, type, attrs, parentId, prevSiblingId.
 * Its inlineContent becomes items in [0, offset). Its nextSiblingId is
 * rewired to the new block.
 *
 * A new block is created with a fresh id from `allocator`, carrying the
 * original block's type, attrs, parentId. Its prevSiblingId is the
 * original block's id; its nextSiblingId is the original block's
 * previous nextSiblingId. Its inlineContent is items in
 * [offset, length).
 *
 * Returns OperationResult with dirtyIds containing:
 *   - the original block's id (content + nextSiblingId changed)
 *   - the new block's id (new entry)
 *   - the original's previous nextSibling, if non-null (its prevSiblingId
 *     was rewired)
 *   - the parent's id, if the original was the last child (parent's
 *     lastChildId updated)
 *
 * Throws if:
 *   - the block does not exist,
 *   - the block is a container (has firstChildId or null inlineContent),
 *   - the block is the root (parentId === null),
 *   - the offset is out of range [0, inlineContentLength].
 */
export function splitBlockAtPosition(
  state: State,
  position: Position,
  allocator: IdAllocator,
): OperationResult {
  const block = state.blocks.get(position.blockId);
  if (!block) {
    throw new Error(`splitBlockAtPosition: block "${position.blockId}" not found`);
  }
  if (!block.inlineContent || block.firstChildId !== null) {
    throw new Error(
      `splitBlockAtPosition: block "${position.blockId}" is a container, not a leaf`,
    );
  }
  if (block.parentId === null) {
    throw new Error(
      `splitBlockAtPosition: block "${position.blockId}" is the root and has no parent to host a sibling`,
    );
  }
  const totalLen = inlineContentLength(block.inlineContent);
  if (position.offset < 0 || position.offset > totalLen) {
    throw new Error(
      `splitBlockAtPosition: offset ${position.offset} out of range [0, ${totalLen}] for block "${position.blockId}"`,
    );
  }

  const [leftItems, rightItems] = splitInlineContentAtOffset(
    block.inlineContent,
    position.offset,
  );

  const newId = allocator.allocate();

  // New block: same type/attrs/parent; sits between original and original's old next sibling.
  const newBlock = createBlock({
    id: newId,
    type: block.type,
    attrs: block.attrs,
    parentId: block.parentId,
    prevSiblingId: block.id,
    nextSiblingId: block.nextSiblingId,
    inlineContent: createInlineContent(rightItems),
  });

  // Updated original block: keeps id/type/attrs/parent/prev; nextSiblingId rewired to newId; new inline content.
  const updatedOriginal = createBlock({
    id: block.id,
    type: block.type,
    attrs: block.attrs,
    parentId: block.parentId,
    prevSiblingId: block.prevSiblingId,
    nextSiblingId: newId,
    inlineContent: createInlineContent(leftItems),
  });

  let blocks = state.blocks.set(block.id, updatedOriginal).set(newId, newBlock);
  const dirtyIds = new Set<BlockId>([block.id, newId]);

  // Rewire the original block's old next sibling, if any.
  if (block.nextSiblingId) {
    const oldNext = state.blocks.get(block.nextSiblingId);
    if (!oldNext) {
      throw new Error(
        `splitBlockAtPosition: original block's next sibling "${block.nextSiblingId}" not found`,
      );
    }
    blocks = blocks.set(block.nextSiblingId, withPrevSibling(oldNext, newId));
    dirtyIds.add(block.nextSiblingId);
  } else {
    // Original was the last child of its parent — parent's lastChildId now points to the new block.
    const parent = state.blocks.get(block.parentId);
    if (!parent) {
      throw new Error(
        `splitBlockAtPosition: parent "${block.parentId}" of block "${block.id}" not found`,
      );
    }
    blocks = blocks.set(block.parentId, withLastChild(parent, newId));
    dirtyIds.add(block.parentId);
  }

  return {
    state: { ...state, blocks },
    dirtyIds,
  };
}

/**
 * Partition `content.items` at `offset` into [leftItems, rightItems].
 *
 * - Clean boundary (offset falls between items, or at start/end of content):
 *   pure array slice, no item splitting.
 * - Mid-text (offset falls inside a text item): split that item into its
 *   left and right halves; both halves preserve the original item's attrs.
 * - Mid-embed: unreachable per findItemAtOffset's contract (embeds count
 *   as one cursor position; offsets at embed boundaries return withinItem=0).
 *   Throws defensively.
 */
function splitInlineContentAtOffset(
  content: InlineContent,
  offset: number,
): [InlineItem[], InlineItem[]] {
  const items = content.items;
  const { itemIndex, withinItem } = findItemAtOffset(content, offset);

  if (withinItem === 0) {
    return [items.slice(0, itemIndex), items.slice(itemIndex)];
  }

  // withinItem > 0: must be a text item per findItemAtOffset's contract.
  const straddle = items[itemIndex];
  if (straddle.kind !== "text") {
    throw new Error(
      `splitBlockAtPosition: offset falls inside non-text item at index ${itemIndex} (kind="${straddle.kind}")`,
    );
  }
  const leftHead = createTextItem(straddle.text.slice(0, withinItem), straddle.attrs);
  const rightHead = createTextItem(straddle.text.slice(withinItem), straddle.attrs);
  return [
    [...items.slice(0, itemIndex), leftHead],
    [rightHead, ...items.slice(itemIndex + 1)],
  ];
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

function withLastChild(b: Block, lastChildId: BlockId | null): Block {
  return createBlock({
    id: b.id,
    type: b.type,
    attrs: b.attrs,
    parentId: b.parentId,
    prevSiblingId: b.prevSiblingId,
    nextSiblingId: b.nextSiblingId,
    firstChildId: b.firstChildId,
    lastChildId,
    inlineContent: b.inlineContent,
  });
}
