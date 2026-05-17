import * as Y from "yjs";
import type { State, OperationResult } from "./state";
import { applyOperation, getBlock } from "./state";
import type { BlockId } from "./block-id";
import type { Position } from "./block-position";
import type { ReadonlyAttrs } from "./attrs";
import { attrsEqual } from "./attrs";
import {
  inlineContentLength,
  splitInlineContentAtOffset,
  mergeAdjacentTextItems,
  findItemAtOffset,
  type InlineItem,
} from "./inline-content";
import { getYBlock } from "./yjs-doc";
import { buildYInlineContent } from "./y-block";

/**
 * Insert text into a leaf block's inlineContent at `position`.
 *
 * `attrs` is the attribute bag for the inserted text. Caller computes
 * surrounding-context attrs (e.g., from the cursor's containing run).
 *
 * Returns OperationResult with dirtyIds = { position.blockId }.
 *
 * Behavior:
 *   - Empty `text`: no-op (returns original state with empty dirtyIds).
 *   - Insert in middle of a same-attrs text item: splice text in.
 *   - Insert in middle of a different-attrs text item: split the item
 *     into prefix + new + suffix.
 *   - Insert at a boundary: create new text item or merge with adjacent
 *     same-attrs item.
 *   - Adjacent text items with equal attrs are merged in a normalize pass.
 *
 * Throws if:
 *   - The block does not exist.
 *   - The block is not a leaf (has no inlineContent).
 *   - `position.offset` is outside `[0, inlineContentLength(content)]`.
 *
 * Implementation: prefer a Y.Text-preserving in-place mutation when the
 * insertion point lands inside (or adjacent to) a text run whose attrs
 * match the incoming attrs — this preserves per-character CRDT identity
 * across edits, which is what Yjs is for. Falls back to a full-replace
 * (compute new items via pure helpers, then rebuild the Y.Array) for
 * cases where in-place mutation cannot reproduce the legacy result shape
 * (e.g., different-attrs split, insertion adjacent to embed, empty block).
 */
export function insertText(
  state: State,
  position: Position,
  text: string,
  attrs: ReadonlyAttrs,
): OperationResult {
  if (text === "") {
    return { state, dirtyIds: new Set<BlockId>() };
  }

  const block = getBlock(state, position.blockId);
  if (block === null) {
    throw new Error(`insertText: block "${position.blockId}" not found`);
  }
  if (block.inlineContent === null) {
    throw new Error(`insertText: block "${position.blockId}" is not a leaf (no inlineContent)`);
  }

  const totalLen = inlineContentLength(block.inlineContent);
  if (position.offset < 0 || position.offset > totalLen) {
    throw new Error(
      `insertText: offset ${position.offset} out of range [0, ${totalLen}] for block "${position.blockId}"`,
    );
  }

  const items = block.inlineContent.items;

  // Identify the in-place target text item (if any). Two cases:
  //   (a) offset lies strictly inside a text item (withinItem > 0) with matching attrs.
  //   (b) offset is at the leading edge of a text item (withinItem === 0) AND
  //       the previous item is a text item with matching attrs — prefer the
  //       trailing edge of the prev item (mirrors legacy "trailing-edge of
  //       text" preference, so we can keep the prev run's CRDT identity).
  //   (c) offset is at the leading edge of a text item with matching attrs
  //       and no eligible prev (e.g., at offset 0 or after an embed).
  //   (d) offset is at end of content AND the last item is text with
  //       matching attrs — mutate the last item.
  const inPlace = findInPlaceTarget(items, position.offset, attrs);

  if (inPlace !== null) {
    return applyOperation(state, () => {
      const yBlock = getYBlock(state.doc, position.blockId, "insertText");
      const yItems = yBlock.get("inlineContent") as Y.Array<Y.Map<unknown>>;
      const yItem = yItems.get(inPlace.itemIndex);
      const yText = yItem.get("text") as Y.Text;
      yText.insert(inPlace.within, text);
    });
  }

  // Fallback (Strategy A full-replace): compute new items via the existing
  // pure helpers, then rebuild the Y.Array. Used when no eligible
  // matching-attrs text run exists at/adjacent to the insertion point
  // (different attrs split, embed-adjacent, empty block, etc.).
  const [left, right] = splitInlineContentAtOffset(block.inlineContent, position.offset);
  const newRun: InlineItem = { kind: "text", text, attrs };
  const merged = mergeAdjacentTextItems([...left, newRun, ...right]);

  return applyOperation(state, () => {
    const yBlock = getYBlock(state.doc, position.blockId, "insertText");
    yBlock.set("inlineContent", buildYInlineContent({ items: merged }));
  });
}

/**
 * Pick the target text item for an in-place Y.Text insertion, mirroring
 * the legacy algorithm's "prefer trailing edge of text item" preference.
 * Returns `null` when no in-place mutation is possible (caller falls back
 * to the full-replace path).
 *
 * Bails to `null` if the items array contains ANY adjacent same-attrs
 * text pair (i.e., the block is already unnormalized). Strategy B only
 * mutates a single Y.Text in isolation, so it would leave such pre-existing
 * unnormalized adjacencies untouched. The legacy `insertText` always ran
 * `mergeAdjacentTextItems` over the whole items array; the full-replace
 * fallback (Strategy A) preserves that contract.
 */
function findInPlaceTarget(
  items: ReadonlyArray<InlineItem>,
  offset: number,
  attrs: ReadonlyAttrs,
): { itemIndex: number; within: number } | null {
  if (hasAdjacentSameAttrsTextPair(items)) return null;
  return pickCandidate(items, offset, attrs);
}

function hasAdjacentSameAttrsTextPair(items: ReadonlyArray<InlineItem>): boolean {
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const curr = items[i];
    if (prev.kind === "text" && curr.kind === "text" && attrsEqual(prev.attrs, curr.attrs)) {
      return true;
    }
  }
  return false;
}

function pickCandidate(
  items: ReadonlyArray<InlineItem>,
  offset: number,
  attrs: ReadonlyAttrs,
): { itemIndex: number; within: number } | null {
  const { itemIndex, withinItem } = findItemAtOffset({ items }, offset);

  // Case: offset at end of content. itemIndex === items.length.
  // If the last item is text with matching attrs, append to it.
  if (itemIndex === items.length) {
    const last = items.length - 1;
    if (last >= 0) {
      const lastItem = items[last];
      if (lastItem.kind === "text" && attrsEqual(lastItem.attrs, attrs)) {
        return { itemIndex: last, within: lastItem.text.length };
      }
    }
    return null;
  }

  const here = items[itemIndex];

  // Case: offset strictly inside a text item.
  if (withinItem > 0) {
    if (here.kind === "text" && attrsEqual(here.attrs, attrs)) {
      return { itemIndex, within: withinItem };
    }
    return null;
  }

  // withinItem === 0: leading edge of items[itemIndex].
  // Prefer the trailing edge of the previous item if it's a matching-attrs
  // text item (legacy preference).
  if (itemIndex > 0) {
    const prev = items[itemIndex - 1];
    if (prev.kind === "text" && attrsEqual(prev.attrs, attrs)) {
      return { itemIndex: itemIndex - 1, within: prev.text.length };
    }
  }

  // No matching prev — try the leading edge of items[itemIndex].
  if (here.kind === "text" && attrsEqual(here.attrs, attrs)) {
    return { itemIndex, within: 0 };
  }

  return null;
}
