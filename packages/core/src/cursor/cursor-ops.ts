import { resolveBlock, createPosition, createSpan, inlineContentLength, findItemAtOffset, nextBlockInDocOrder, prevBlockInDocOrder } from "../state";
import type { Document, BlockId, Position, Span, InlineContent, InlineItem } from "../state";
import { isStructuralMarkerEmbedType } from "../state/embed-markers";
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
  document: Document,
  position: Position,
  direction: "forward" | "backward",
): Position {
  const block = resolveBlock(document, position.blockId)?.block ?? null;
  if (block === null) return position;
  const content: InlineContent = block.inlineContent ?? { items: [] };
  const total = inlineContentLength(content);

  // Markers are not caret stops: a move skips the markers on its side first,
  // crosses ONE character, and lands after any markers adjacent to it.
  if (direction === "forward") {
    const from = offsetAfterMarkers(content, position.offset);
    if (from >= total) {
      const next = findNextContentBlock(document, position.blockId);
      return next === null ? position : caretAfterMarkers(document, createPosition(next, 0));
    }
    return createPosition(position.blockId, offsetAfterMarkers(content, advanceForward(content, from)));
  }

  const from = offsetBeforeMarkers(content, position.offset);
  if (from <= 0) {
    const prev = findPrevContentBlock(document, position.blockId);
    if (prev === null) return position;
    const prevBlock = resolveBlock(document, prev)?.block ?? null;
    if (prevBlock === null) return position;
    const prevTotal = inlineContentLength(prevBlock.inlineContent ?? { items: [] });
    return createPosition(prev, prevTotal);
  }
  return createPosition(position.blockId, advanceBackward(content, from));
}

/**
 * Walk `nextBlockInDocOrder` past container blocks (those without
 * `inlineContent`) until a text-bearing leaf is found, or null at end
 * of document. Container blocks (document, section, list, table, etc.)
 * aren't valid cursor destinations; only blocks with non-null
 * `inlineContent` are.
 */
export function findNextContentBlock(document: Document, blockId: BlockId): BlockId | null {
  let cursor = nextBlockInDocOrder(document, blockId);
  while (cursor !== null) {
    const block = resolveBlock(document, cursor)?.block ?? null;
    if (block === null) return null;
    if (block.inlineContent !== null) return cursor;
    cursor = nextBlockInDocOrder(document, cursor);
  }
  return null;
}

/**
 * Symmetric to `findNextContentBlock` — walks `prevBlockInDocOrder` past
 * container blocks.
 */
export function findPrevContentBlock(document: Document, blockId: BlockId): BlockId | null {
  let cursor = prevBlockInDocOrder(document, blockId);
  while (cursor !== null) {
    const block = resolveBlock(document, cursor)?.block ?? null;
    if (block === null) return null;
    if (block.inlineContent !== null) return cursor;
    cursor = prevBlockInDocOrder(document, cursor);
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
  document: Document,
  position: Position,
  direction: "forward" | "backward",
): Position {
  const block = resolveBlock(document, position.blockId)?.block ?? null;
  if (block === null) return position;
  const content: InlineContent = block.inlineContent ?? { items: [] };
  const total = inlineContentLength(content);

  if (direction === "forward") {
    if (position.offset >= total) {
      const next = findNextContentBlock(document, position.blockId);
      return next === null ? position : createPosition(next, 0);
    }
    const advanced = advanceWordForward(content, position.offset);
    return createPosition(position.blockId, advanced);
  }

  if (position.offset <= 0) {
    const prev = findPrevContentBlock(document, position.blockId);
    if (prev === null) return position;
    const prevBlock = resolveBlock(document, prev)?.block ?? null;
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
 * Operates within a single block — does not cross block boundaries. (An
 * action that wants triple-click or similar may compose this with
 * cross-block logic.)
 */
export function selectWord(document: Document, position: Position): Span {
  const block = resolveBlock(document, position.blockId)?.block ?? null;
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
  document: Document,
  span: Span,
  direction: "forward" | "backward",
): Span {
  const newFocus = moveByCharacter(document, span.focus, direction);
  return createSpan(span.anchor, newFocus);
}

/** True when `item` is a zero-width structural marker (bookmark / comment start or end). */
function isMarkerItem(item: InlineItem | undefined): boolean {
  return item?.kind === "embed" && isStructuralMarkerEmbedType(item.embedType);
}

/**
 * Caret affinity at structural markers (Word): markers are not caret
 * stops — a caret Position adjacent to markers stands AFTER every adjacent marker, so
 * typing at a bookmark's (or comment's) start lands inside it and at its end outside.
 * Returns `offset` moved past the run of markers starting at it. O(items before
 * `offset` + adjacent markers) — block-local, never a document scan.
 */
function offsetAfterMarkers(content: InlineContent, offset: number): number {
  const { itemIndex, withinItem } = findItemAtOffset(content, offset);
  if (withinItem !== 0) return offset;
  let at = offset;
  for (let i = itemIndex; isMarkerItem(content.items[i]); i++) at++;
  return at;
}

/** `offset` moved back over the run of markers ending at it (the marker-skipping half of a backward move). */
function offsetBeforeMarkers(content: InlineContent, offset: number): number {
  const { itemIndex, withinItem } = findItemAtOffset(content, offset);
  if (withinItem !== 0) return offset;
  let at = offset;
  for (let i = itemIndex - 1; isMarkerItem(content.items[i]); i--) at--;
  return at;
}

/**
 * THE caret-affinity normalization: `position` moved past every structural
 * marker adjacent on its right. Every caret-producing point applies it — core's reducer
 * entry for every caret insertion (`INSERTS_AT_CARET`) and character moves; print's hit-test / arrow keys and digital's DOM bridge call it
 * too. Unknown or container blocks return `position` unchanged.
 */
export function caretAfterMarkers(document: Document, position: Position): Position {
  const content = resolveBlock(document, position.blockId)?.block.inlineContent ?? null;
  if (content === null) return position;
  const at = offsetAfterMarkers(content, position.offset);
  return at === position.offset ? position : createPosition(position.blockId, at);
}

/** `position` moved back before every structural marker adjacent on its left (where a backward move starts). */
export function caretBeforeMarkers(document: Document, position: Position): Position {
  const content = resolveBlock(document, position.blockId)?.block.inlineContent ?? null;
  if (content === null) return position;
  const at = offsetBeforeMarkers(content, position.offset);
  return at === position.offset ? position : createPosition(position.blockId, at);
}
