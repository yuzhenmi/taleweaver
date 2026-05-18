import * as Y from "yjs";
import type { State, OperationResult } from "./state";
import { applyOperation, getBlock } from "./state";
import type { BlockId, IdAllocator } from "./block-id";
import type { Position } from "./block-position";
import { inlineContentLength } from "./inline-content";
import { getBlocksMap, getYBlock } from "./yjs-doc";
import { buildYBlock, buildYInlineItem } from "./y-block";
import { yMapAsObject, cloneInlineItem } from "./y-utils";

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
 *
 * Y.Doc identity: the original block's content Y.Text retains identity
 * for the left half — when the split lands inside a text run, the
 * straddling Y.Text is shortened in place (not rebuilt). Only the new
 * block's suffix items are freshly materialized. No normalization
 * post-pass is needed: a clean split of normalized inline content yields
 * two halves that are each individually normalized.
 */
export function splitBlockAtPosition(
  state: State,
  position: Position,
  allocator: IdAllocator,
): OperationResult {
  const block = getBlock(state, position.blockId);
  if (block === null) {
    throw new Error(`splitBlockAtPosition: block "${position.blockId}" not found`);
  }
  if (block.inlineContent === null || block.firstChildId !== null) {
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

  // Allocate the new block id OUTSIDE applyOperation so retries (if added
  // later) don't burn through multiple ids.
  const newBlockId = allocator.allocate();
  const parentId = block.parentId;

  return applyOperation(state, () => {
    const yBlocks = getBlocksMap(state.doc);
    const yOriginal = getYBlock(state.doc, position.blockId, "splitBlockAtPosition");

    // Split yOriginal's inlineContent: items in [0, offset) stay; items in
    // [offset, end) move to a new block. Straddling text items split.
    const suffixItems = splitInlineContent(yOriginal, position.offset);

    // Build new block. Inherits type + attrs; prev = original, next = original.next.
    const originalNextId = (yOriginal.get("nextSiblingId") as BlockId | null) ?? null;
    const newYBlock = buildYBlock({
      type: yOriginal.get("type") as string,
      attrs: yMapAsObject(yOriginal.get("attrs") as Y.Map<unknown>),
      parentId,
      prevSiblingId: position.blockId,
      nextSiblingId: originalNextId,
      firstChildId: null,
      lastChildId: null,
      inlineContent: null,
    });
    const newInlineContent = new Y.Array<Y.Map<unknown>>();
    if (suffixItems.length > 0) newInlineContent.push(suffixItems);
    newYBlock.set("inlineContent", newInlineContent);
    yBlocks.set(newBlockId, newYBlock);

    // Re-wire sibling pointers around the insertion.
    if (originalNextId !== null) {
      getYBlock(state.doc, originalNextId, "splitBlockAtPosition").set(
        "prevSiblingId",
        newBlockId,
      );
    }
    yOriginal.set("nextSiblingId", newBlockId);

    // Re-wire parent's lastChildId if original was the last child.
    const yParent = getYBlock(state.doc, parentId, "splitBlockAtPosition");
    if (yParent.get("lastChildId") === position.blockId) {
      yParent.set("lastChildId", newBlockId);
    }
  });
}

/**
 * Mutates `yOriginal.inlineContent` by removing items (and the trailing part
 * of any straddling text item) from `offset` onward, returning a fresh array
 * of detached Y.Map items representing the suffix. Caller owns inserting them
 * into the new block's inlineContent Y.Array.
 *
 * Straddling-text case: the original's Y.Text is shortened in-place
 * (preserving CRDT identity for the left half) and a fresh Y.Map text item
 * carrying the right half is returned in the suffix.
 *
 * Entirely-in-suffix case: items are cloned into the suffix and removed from
 * the original. (Move-without-clone isn't supported by Yjs — a Y type can
 * only belong to one parent.)
 */
function splitInlineContent(yOriginal: Y.Map<unknown>, offset: number): Y.Map<unknown>[] {
  const yItems = yOriginal.get("inlineContent") as Y.Array<Y.Map<unknown>>;
  const suffix: Y.Map<unknown>[] = [];
  let cursor = 0;
  let i = 0;
  while (i < yItems.length) {
    const yItem = yItems.get(i);
    const kind = yItem.get("kind") as "text" | "embed";
    const itemLen = kind === "text" ? (yItem.get("text") as Y.Text).length : 1;
    const itemEnd = cursor + itemLen;

    if (itemEnd <= offset) {
      // Entirely in prefix: leave alone.
      cursor = itemEnd;
      i++;
      continue;
    }
    if (cursor >= offset) {
      // Entirely in suffix: clone into the suffix, remove from original.
      suffix.push(cloneInlineItem(yItem));
      yItems.delete(i, 1);
      // Don't advance i — yItems.delete shifts subsequent items down.
      continue;
    }
    // Straddles boundary; must be text (embed length is 1, can't straddle).
    const yText = yItem.get("text") as Y.Text;
    const within = offset - cursor;
    const after = yText.toString().slice(within);
    const attrs = yMapAsObject(yItem.get("attrs") as Y.Map<unknown>);
    if (after.length > 0) {
      yText.delete(within, after.length);
      suffix.push(buildYInlineItem({ kind: "text", text: after, attrs }));
    }
    cursor = itemEnd;
    i++;
  }
  return suffix;
}
