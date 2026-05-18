import type { State } from "../state/state";
import { getBlock } from "../state/state";
import type { BlockId } from "../state/block-id";
import type { Position } from "../state/block-position";
import { createPosition } from "../state/block-position";
import type { InlineContent } from "../state/inline-content";
import { inlineContentLength, findItemAtOffset } from "../state/inline-content";
import { nextBlockInDocOrder, prevBlockInDocOrder } from "../state/block-traversal";
import { nextGraphemeBoundary, prevGraphemeBoundary } from "./grapheme-utils";

/**
 * Move the cursor by one grapheme cluster in the given direction.
 *
 * Within a text item: advances by `nextGraphemeBoundary` /
 * `prevGraphemeBoundary` against the item's text. Embed items count as
 * exactly 1 cursor position (per master spec line 124) — moving across
 * an embed advances `offset` by 1. At the boundary of a block's inline
 * content, transitions to the next/prev block via
 * `nextBlockInDocOrder` / `prevBlockInDocOrder`.
 *
 * Returns the input position unchanged at document boundaries (no prev
 * before the first block; no next after the last) and for unknown
 * blockIds (defensive — caller is expected to validate, but we degrade
 * gracefully).
 */
export function moveByCharacter(
  state: State,
  position: Position,
  direction: "forward" | "backward",
): Position {
  const block = getBlock(state, position.blockId);
  if (block === null) return position;
  const content: InlineContent = block.inlineContent ?? { items: [] };
  const total = inlineContentLength(content);

  if (direction === "forward") {
    if (position.offset >= total) {
      const next = findNextContentBlock(state, position.blockId);
      return next === null ? position : createPosition(next, 0);
    }
    const advanced = advanceForward(content, position.offset);
    return createPosition(position.blockId, advanced);
  }

  if (position.offset <= 0) {
    const prev = findPrevContentBlock(state, position.blockId);
    if (prev === null) return position;
    const prevBlock = getBlock(state, prev);
    if (prevBlock === null) return position;
    const prevTotal = inlineContentLength(prevBlock.inlineContent ?? { items: [] });
    return createPosition(prev, prevTotal);
  }
  const retreated = advanceBackward(content, position.offset);
  return createPosition(position.blockId, retreated);
}

/**
 * Walk `nextBlockInDocOrder` past container blocks (those without
 * `inlineContent`) until a text-bearing leaf is found, or null at end
 * of document. Container blocks (document, section, list, table, etc.)
 * aren't valid cursor destinations; only blocks with non-null
 * `inlineContent` are.
 */
function findNextContentBlock(state: State, blockId: BlockId): BlockId | null {
  let cursor = nextBlockInDocOrder(state, blockId);
  while (cursor !== null) {
    const block = getBlock(state, cursor);
    if (block === null) return null;
    if (block.inlineContent !== null) return cursor;
    cursor = nextBlockInDocOrder(state, cursor);
  }
  return null;
}

/**
 * Symmetric to `findNextContentBlock` — walks `prevBlockInDocOrder` past
 * container blocks.
 */
function findPrevContentBlock(state: State, blockId: BlockId): BlockId | null {
  let cursor = prevBlockInDocOrder(state, blockId);
  while (cursor !== null) {
    const block = getBlock(state, cursor);
    if (block === null) return null;
    if (block.inlineContent !== null) return cursor;
    cursor = prevBlockInDocOrder(state, cursor);
  }
  return null;
}

function advanceForward(content: InlineContent, offset: number): number {
  const { itemIndex, withinItem } = findItemAtOffset(content, offset);
  const item = content.items[itemIndex];
  if (item === undefined) return offset; // defensive; total-check above should prevent this
  if (item.kind === "text") {
    const nextBoundary = nextGraphemeBoundary(item.text, withinItem);
    if (nextBoundary > withinItem) {
      return offset + (nextBoundary - withinItem);
    }
    // Already at item end — step to next item start (1 unit).
    return offset + 1;
  }
  // Embed item — single-unit step.
  return offset + 1;
}

function advanceBackward(content: InlineContent, offset: number): number {
  const { itemIndex, withinItem } = findItemAtOffset(content, offset);
  if (withinItem > 0) {
    const item = content.items[itemIndex];
    if (item !== undefined && item.kind === "text") {
      const prevBoundary = prevGraphemeBoundary(item.text, withinItem);
      return offset - (withinItem - prevBoundary);
    }
    // Inside an embed (shouldn't happen — embeds have withinItem === 0)
    // or item undefined — step 1 unit defensively.
    return offset - 1;
  }
  // At an item boundary (start of items[itemIndex]). Step into the previous item.
  const prev = content.items[itemIndex - 1];
  if (prev === undefined) return offset; // defensive; offset === 0 case handled above
  if (prev.kind === "text") {
    const prevBoundary = prevGraphemeBoundary(prev.text, prev.text.length);
    return offset - (prev.text.length - prevBoundary);
  }
  // Previous item is an embed — single-unit step.
  return offset - 1;
}
