import type { State, OperationResult } from "./state";
import type { BlockId } from "./block-id";
import type { Span } from "./block-position";
import type { ReadonlyAttrs } from "./attrs";
import {
  createInlineContent,
  createTextItem,
  createEmbedItem,
  mergeAdjacentTextItems,
  type InlineItem,
} from "./inline-content";
import { createBlock } from "./block";
import { iterateSpan } from "./span-iteration";

/**
 * Apply attrs to all inline content within a span.
 *
 * `attrs` is MERGED into each affected item's existing attrs. To remove
 * an attr, pass it with value `undefined` (e.g., `{ bold: undefined }`).
 *
 * For embed items intersecting the range, the merge applies to the embed's
 * `attrs` field (wrap attrs like link/comment-range — NOT `properties`,
 * which holds intrinsic embed data).
 *
 * After applying, each touched block's items go through a run-merging
 * post-pass so adjacent same-attrs text items collapse.
 *
 * Returns OperationResult with dirtyIds = every block id whose items
 * changed.
 *
 * Behavior:
 *   - Empty incoming attrs ({}): no-op (returns original state with empty dirtyIds).
 *   - Empty span (anchor === focus, in same block at same offset): no-op.
 *   - Span is normalized first (anchor before focus in document order).
 *   - Single-block span: one block touched.
 *   - Multi-block span: each leaf block in the span is touched; the
 *     anchor block from anchor.offset to its end, intervening leaves
 *     fully, focus block from 0 to focus.offset.
 *
 * Throws via `iterateSpan`'s preconditions if endpoints are non-leaf
 * containers or different selection contexts.
 */
export function applyAttrsToRange(
  state: State,
  span: Span,
  attrs: ReadonlyAttrs,
): OperationResult {
  // Empty incoming attrs = no-op (mirrors insertText's empty-text guard;
  // avoids needlessly re-allocating items + dirtying blocks).
  if (Object.keys(attrs).length === 0) {
    return { state, dirtyIds: new Set<BlockId>() };
  }

  // Empty span = no-op. Collapsed-ness (same block + same offset) is
  // normalization-invariant, so we check raw positions directly.
  // Note: a collapsed span whose blockId references a non-existent block
  // also no-ops here without throwing — same behavior as before this
  // refactor (the previous normalizeSpan path also short-circuited via
  // comparePositions when blockIds matched, never reaching block lookup).
  if (
    span.anchor.blockId === span.focus.blockId &&
    span.anchor.offset === span.focus.offset
  ) {
    return { state, dirtyIds: new Set<BlockId>() };
  }
  // iterateSpan owns precondition validation (existence, leaf-block,
  // same-selection-context) AND normalization. We pass the raw span; it
  // validates raw endpoints first (yielding semantically correct error
  // messages) before normalizing internally.

  let blocks = state.blocks;
  const dirtyIds = new Set<BlockId>();

  for (const { block, rangeStart, rangeEnd } of iterateSpan(state, span)) {
    if (!block.inlineContent) continue; // defensive — iterateSpan only yields leaves
    if (rangeStart >= rangeEnd) continue; // zero-width range in this block (e.g., focus at offset 0 of last block)

    const newItems = applyAttrsToBlockRange(
      block.inlineContent.items,
      rangeStart,
      rangeEnd,
      attrs,
    );
    const merged = mergeAdjacentTextItems(newItems);

    const updated = createBlock({
      id: block.id,
      type: block.type,
      attrs: block.attrs,
      parentId: block.parentId,
      prevSiblingId: block.prevSiblingId,
      nextSiblingId: block.nextSiblingId,
      firstChildId: block.firstChildId,
      lastChildId: block.lastChildId,
      inlineContent: createInlineContent(merged),
    });
    blocks = blocks.set(block.id, updated);
    dirtyIds.add(block.id);
  }

  return { state: { ...state, blocks }, dirtyIds };
}

/**
 * Walk one block's items and apply attrs to the portion overlapping
 * [rangeStart, rangeEnd). Splits items at boundaries; merges incoming
 * attrs into each affected item's existing attrs.
 */
function applyAttrsToBlockRange(
  items: ReadonlyArray<InlineItem>,
  rangeStart: number,
  rangeEnd: number,
  attrs: ReadonlyAttrs,
): InlineItem[] {
  const out: InlineItem[] = [];
  let cursor = 0;

  for (const item of items) {
    const itemLen = item.kind === "text" ? item.text.length : 1;
    const itemStart = cursor;
    const itemEnd = cursor + itemLen;
    cursor = itemEnd;

    // Item entirely outside the range: keep as-is.
    if (itemEnd <= rangeStart || itemStart >= rangeEnd) {
      out.push(item);
      continue;
    }

    if (item.kind === "text") {
      // Compute the overlap [overlapStart, overlapEnd) within this item's coordinate frame.
      const overlapStart = Math.max(0, rangeStart - itemStart);
      const overlapEnd = Math.min(itemLen, rangeEnd - itemStart);
      const prefix = item.text.slice(0, overlapStart);
      const middle = item.text.slice(overlapStart, overlapEnd);
      const suffix = item.text.slice(overlapEnd);
      if (prefix.length > 0) out.push(createTextItem(prefix, item.attrs));
      if (middle.length > 0) out.push(createTextItem(middle, mergeAttrs(item.attrs, attrs)));
      if (suffix.length > 0) out.push(createTextItem(suffix, item.attrs));
    } else {
      // Embed: 1 unit; apply merge to its wrap-attrs.
      out.push(createEmbedItem(item.embedType, item.properties, mergeAttrs(item.attrs, attrs)));
    }
  }

  return out;
}

/**
 * Merge incoming attrs into existing attrs.
 * - Keys with value `undefined` in `incoming` are REMOVED from the result.
 * - Other keys in `incoming` overwrite or add to `existing`.
 * - Keys only in `existing` are preserved.
 */
function mergeAttrs(existing: ReadonlyAttrs, incoming: ReadonlyAttrs): ReadonlyAttrs {
  const result: Record<string, unknown> = { ...existing };
  for (const key of Object.keys(incoming)) {
    if (incoming[key] === undefined) {
      delete result[key];
    } else {
      result[key] = incoming[key];
    }
  }
  return result;
}
