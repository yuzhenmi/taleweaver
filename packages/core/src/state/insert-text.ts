import type { State, OperationResult } from "./state";
import { applyOperation, getBlock } from "./state";
import type { BlockId } from "./block-id";
import type { Position } from "./block-position";
import type { ReadonlyAttrs } from "./attrs";
import {
  inlineContentLength,
  splitInlineContentAtOffset,
  mergeAdjacentTextItems,
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
 * Strategy A: compute the new inline-content shape using existing pure
 * helpers (operating on plain `InlineItem[]` arrays), then replace the
 * block's entire Y.Array<inlineContent>. This recreates the Y.Array and
 * ALL Y.Text identities — it loses Y.Text per-character CRDT identity on
 * every keystroke. Strategy B (Y.Text-preserving in-place mutation) is
 * deferred; see plan doc P4e Task 17.
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

  // Compute new items via the existing pure helpers (mirrors legacy logic).
  const [left, right] = splitInlineContentAtOffset(block.inlineContent, position.offset);
  const newRun: InlineItem = { kind: "text", text, attrs };
  const merged = mergeAdjacentTextItems([...left, newRun, ...right]);

  return applyOperation(state, () => {
    const yBlock = getYBlock(state.doc, position.blockId, "insertText");
    yBlock.set("inlineContent", buildYInlineContent({ items: merged }));
  });
}
