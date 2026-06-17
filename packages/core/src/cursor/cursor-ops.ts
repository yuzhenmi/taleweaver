import { resolveBlock, createPosition, createSpan, inlineContentLength, findItemAtOffset, nextBlockInDocOrder, prevBlockInDocOrder } from "../state";
import type { State, BlockId, Position, Span, InlineContent } from "../state";
import {
  nextGraphemeBoundary,
  prevGraphemeBoundary,
  nextWordBoundary,
  prevWordBoundary,
  iterateWordSegments,
} from "./grapheme-utils";

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
  const block = resolveBlock(state, position.blockId)?.block ?? null;
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
    const prevBlock = resolveBlock(state, prev)?.block ?? null;
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
export function findNextContentBlock(state: State, blockId: BlockId): BlockId | null {
  let cursor = nextBlockInDocOrder(state, blockId);
  while (cursor !== null) {
    const block = resolveBlock(state, cursor)?.block ?? null;
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
export function findPrevContentBlock(state: State, blockId: BlockId): BlockId | null {
  let cursor = prevBlockInDocOrder(state, blockId);
  while (cursor !== null) {
    const block = resolveBlock(state, cursor)?.block ?? null;
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

/**
 * Move the cursor by one word (UAX #29 word boundary) in the given direction.
 *
 * Word boundaries are detected within each text item's text via
 * `Intl.Segmenter`. Embeds act as word barriers — `moveByWord` does NOT
 * traverse through an embed; instead, when it would cross one, the
 * position lands at the offset immediately before (forward) or after
 * (backward) the embed. Cross-block transitions: forward advances to
 * offset 0 of the next content-bearing block; backward retreats to the
 * start of the last word of the previous content-bearing block. Container
 * blocks (document, section, list, table, etc.) are skipped via
 * `findNextContentBlock` / `findPrevContentBlock` — cursors are not
 * valid in containers.
 */
export function moveByWord(
  state: State,
  position: Position,
  direction: "forward" | "backward",
): Position {
  const block = resolveBlock(state, position.blockId)?.block ?? null;
  if (block === null) return position;
  const content: InlineContent = block.inlineContent ?? { items: [] };
  const total = inlineContentLength(content);

  if (direction === "forward") {
    if (position.offset >= total) {
      const next = findNextContentBlock(state, position.blockId);
      return next === null ? position : createPosition(next, 0);
    }
    const advanced = advanceWordForward(content, position.offset);
    return createPosition(position.blockId, advanced);
  }

  if (position.offset <= 0) {
    const prev = findPrevContentBlock(state, position.blockId);
    if (prev === null) return position;
    const prevBlock = resolveBlock(state, prev)?.block ?? null;
    if (prevBlock === null) return position;
    const prevContent = prevBlock.inlineContent ?? { items: [] };
    const prevTotal = inlineContentLength(prevContent);
    // Find last word start in prev block. We need the cumulative
    // offset of each item's start; precompute in one forward pass
    // (O(n)) so the reverse scan is O(1) per item instead of O(n)
    // (the prior double-loop was O(n²)).
    const cumulativeStart: number[] = new Array(prevContent.items.length);
    {
      let acc = 0;
      for (let j = 0; j < prevContent.items.length; j++) {
        cumulativeStart[j] = acc;
        const it = prevContent.items[j];
        if (it === undefined) continue;
        acc += it.kind === "text" ? it.text.length : 1;
      }
    }
    for (let i = prevContent.items.length - 1; i >= 0; i--) {
      const item = prevContent.items[i];
      if (item === undefined || item.kind !== "text") continue;
      const boundary = prevWordBoundary(item.text, item.text.length);
      const start = cumulativeStart[i];
      if (start === undefined) {
        throw new Error(`cursor-ops: cumulativeStart[${i}] missing (unreachable)`);
      }
      return createPosition(prev, start + boundary);
    }
    // No text items in prev block — land at its end (block boundary).
    return createPosition(prev, prevTotal);
  }
  const retreated = advanceWordBackward(content, position.offset);
  return createPosition(position.blockId, retreated);
}

function advanceWordForward(content: InlineContent, offset: number): number {
  const { itemIndex, withinItem } = findItemAtOffset(content, offset);
  const item = content.items[itemIndex];
  if (item === undefined) return offset;
  if (item.kind !== "text") {
    // Inside an embed — word movement steps past it (treat as a 1-unit step).
    return offset + 1;
  }
  const nextBoundary = nextWordBoundary(item.text, withinItem);
  if (nextBoundary > withinItem) {
    return offset + (nextBoundary - withinItem);
  }
  // At end of text item — step 1 unit (embed barrier or next item start).
  return offset + 1;
}

function advanceWordBackward(content: InlineContent, offset: number): number {
  const { itemIndex, withinItem } = findItemAtOffset(content, offset);
  if (withinItem > 0) {
    const item = content.items[itemIndex];
    if (item !== undefined && item.kind === "text") {
      const prevBoundary = prevWordBoundary(item.text, withinItem);
      return offset - (withinItem - prevBoundary);
    }
    return offset - 1;
  }
  // At item boundary — step into previous item.
  const prev = content.items[itemIndex - 1];
  if (prev === undefined) return offset;
  if (prev.kind !== "text") return offset - 1;
  const prevBoundary = prevWordBoundary(prev.text, prev.text.length);
  return offset - (prev.text.length - prevBoundary);
}

/**
 * Return a Span covering the word that contains `position`. If `position`
 * lies on whitespace/punctuation, returns the preceding word's span. On
 * an empty block or with no preceding word in the block, returns a
 * collapsed span at `position`. Position on an embed also collapses.
 *
 * Operates within a single block — does not cross block boundaries. (A
 * P11.x action that wants triple-click or similar may compose this with
 * cross-block logic.)
 */
export function selectWord(state: State, position: Position): Span {
  const block = resolveBlock(state, position.blockId)?.block ?? null;
  if (block === null) return createSpan(position, position);
  const content = block.inlineContent ?? { items: [] };
  const { itemIndex, withinItem } = findItemAtOffset(content, position.offset);
  const item = content.items[itemIndex];
  if (item === undefined || item.kind !== "text") {
    return createSpan(position, position);
  }
  // Compute item's start offset in the block.
  let itemStart = 0;
  for (let i = 0; i < itemIndex; i++) {
    const it = content.items[i];
    if (it === undefined) continue;
    itemStart += it.kind === "text" ? it.text.length : 1;
  }

  // Find a word segment containing `withinItem`.
  let containing: { start: number; end: number } | null = null;
  let lastWord: { start: number; end: number } | null = null;
  let nextWord: { start: number; end: number } | null = null;
  for (const seg of iterateWordSegments(item.text)) {
    if (!seg.isWordLike) continue;
    if (seg.start <= withinItem && seg.end >= withinItem) {
      containing = seg;
      break;
    }
    if (seg.end <= withinItem) {
      lastWord = seg;
    } else if (nextWord === null) {
      nextWord = seg;
    }
  }
  const word = containing ?? lastWord ?? nextWord;
  if (word === null) return createSpan(position, position);
  const anchor = createPosition(position.blockId, itemStart + word.start);
  const focus = createPosition(position.blockId, itemStart + word.end);
  return createSpan(anchor, focus);
}

/**
 * Move the selection's focus by one grapheme cluster in the given
 * direction; anchor unchanged. Cross-block movement follows the same
 * rules as `moveByCharacter`.
 */
export function expandSelection(
  state: State,
  span: Span,
  direction: "forward" | "backward",
): Span {
  const newFocus = moveByCharacter(state, span.focus, direction);
  return createSpan(span.anchor, newFocus);
}
