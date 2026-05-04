import type { State, OperationResult } from "./state";
import type { BlockId } from "./block-id";
import type { Position } from "./block-position";
import type { ReadonlyAttrs } from "./attrs";
import { attrsEqual } from "./attrs";
import {
  createInlineContent,
  createTextItem,
  inlineContentLength,
  type InlineItem,
  type TextItem,
} from "./inline-content";
import { createBlock } from "./block";

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

  const block = state.blocks.get(position.blockId);
  if (!block) {
    throw new Error(`insertText: block "${position.blockId}" not found`);
  }
  if (!block.inlineContent) {
    throw new Error(`insertText: block "${position.blockId}" is not a leaf (no inlineContent)`);
  }

  const totalLen = inlineContentLength(block.inlineContent);
  if (position.offset < 0 || position.offset > totalLen) {
    throw new Error(
      `insertText: offset ${position.offset} out of range [0, ${totalLen}] for block "${position.blockId}"`,
    );
  }

  const items = block.inlineContent.items;
  const newItems = spliceTextIntoItems(items, position.offset, text, attrs);
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

  return {
    state: { ...state, blocks: state.blocks.set(position.blockId, updated) },
    dirtyIds: new Set([position.blockId]),
  };
}

/**
 * Walk items, find the position, and splice in a new TextItem with
 * the given attrs. Splits the affected item if needed; preserves all
 * other items. Run-merging is done in a separate normalize pass.
 */
function spliceTextIntoItems(
  items: ReadonlyArray<InlineItem>,
  offset: number,
  text: string,
  attrs: ReadonlyAttrs,
): InlineItem[] {
  const out: InlineItem[] = [];
  let cursor = 0;
  let inserted = false;

  for (const item of items) {
    const itemLen = item.kind === "text" ? item.text.length : 1;
    const itemEnd = cursor + itemLen;

    if (inserted) {
      out.push(item);
      cursor = itemEnd;
      continue;
    }

    if (offset < cursor + itemLen || (offset === cursor + itemLen && item.kind === "text")) {
      // The insertion point falls inside this item, OR exactly at its
      // trailing edge for a text item (we prefer to land at the trailing
      // edge of a text item rather than the leading edge of the next item,
      // so we can merge if attrs match).
      // Asymmetry: at an embed→text boundary, the OR clause is FALSE for
      // the embed (because item.kind === "embed"), so the embed is pushed
      // and the loop continues; the next iteration enters the text item
      // at within=0 and creates [embed, new, text]. The merge pass then
      // joins new+text if attrs match. This is the correct behavior:
      // we cannot "merge" with a non-text item.
      if (item.kind === "text") {
        const within = offset - cursor;
        const prefix = item.text.slice(0, within);
        const suffix = item.text.slice(within);
        if (prefix.length > 0) out.push(createTextItem(prefix, item.attrs));
        out.push(createTextItem(text, attrs));
        if (suffix.length > 0) out.push(createTextItem(suffix, item.attrs));
      } else {
        // Embed item with offset inside it: offset===cursor means before, offset===cursor+1 means after.
        if (offset === cursor) {
          out.push(createTextItem(text, attrs));
          out.push(item);
        } else {
          out.push(item);
          out.push(createTextItem(text, attrs));
        }
      }
      inserted = true;
      cursor = itemEnd;
      continue;
    }

    out.push(item);
    cursor = itemEnd;
  }

  if (!inserted) {
    // Offset was at end-of-content (or content was empty).
    out.push(createTextItem(text, attrs));
  }

  return out;
}

/**
 * Merge adjacent text items with equal attrs into a single item.
 * Embed items are not merged. Returns a fresh array.
 */
function mergeAdjacentTextItems(items: ReadonlyArray<InlineItem>): InlineItem[] {
  if (items.length <= 1) return [...items];
  const out: InlineItem[] = [];
  let pending: TextItem | null = null;

  for (const item of items) {
    if (item.kind === "text") {
      if (pending && attrsEqual(pending.attrs, item.attrs)) {
        // pending.attrs and item.attrs are equal-by-value (attrsEqual
        // returned true); using either side yields the same result.
        // We pick pending.attrs for stability.
        pending = createTextItem(pending.text + item.text, pending.attrs);
      } else {
        if (pending) {
          out.push(pending);
        }
        pending = item;
      }
    } else {
      if (pending) {
        out.push(pending);
        pending = null;
      }
      out.push(item);
    }
  }
  if (pending) out.push(pending);
  return out;
}
