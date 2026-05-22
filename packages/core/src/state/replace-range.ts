import type { State, OperationResult } from "./state";
import type { BlockId } from "./block-id";
import type { Span } from "./block-position";
import { createPosition } from "./block-position";
import type { ReadonlyAttrs } from "./attrs";
import { normalizeSpan } from "./span-iteration";
import { deleteRange } from "./delete-range";
import { insertText } from "./insert-text";

/**
 * Replace the inline content within a Span with the given text + attrs.
 *
 * Composes deleteRange and insertText:
 *   1. If the span is non-collapsed, delete its content via deleteRange.
 *   2. If the text is non-empty, insert it at the cursor position via
 *      insertText.
 *
 * The cursor position lands at the seam between the surviving anchor
 * prefix and the focus suffix — i.e., `{ normalized.anchor.blockId,
 * normalized.anchor.offset }` post-delete.
 *
 * `attrs` is the formatting for the inserted text. Caller computes the
 * intended formatting (e.g., from the cursor's containing run, or a
 * paste payload's attrs).
 *
 * Returns OperationResult with dirtyIds = union of the two underlying
 * operations' dirtyIds.
 *
 * Error contract delegates entirely to deleteRange (existence, leaf,
 * cross-parent, cross-context, offset bounds) for the non-collapsed
 * paths, and to insertText (offset bounds) for the collapsed-insert
 * path. After deleteRange succeeds, the cursor position is always
 * valid in the post-delete anchor block, so insertText's defensive
 * existence/offset throws are unreachable from the full-replace path.
 *
 * Behavior:
 *   - Collapsed span + empty text: pure no-op.
 *   - Collapsed span + non-empty text: insertText only.
 *   - Non-collapsed span + empty text: deleteRange only.
 *   - Non-collapsed span + non-empty text: deleteRange then insertText.
 *
 * Why deleteRange runs BEFORE normalizeSpan (architectural note): a top-
 * level normalizeSpan would invoke compareBlocksInDocOrder, which throws
 * a generic "compareBlocksInDocOrder: block ... not found" message when
 * either endpoint references a missing block. That message would shadow
 * deleteRange's prefixed contract ("anchor block ... not found", "focus
 * block ... not found"). By calling deleteRange first (which has its own
 * pre-normalize existence/leaf guards), the operation's stated error
 * contract wins. Same architectural pattern applyAttrsToRange and
 * deleteRange use for the same reason.
 */
export function replaceRange(
  state: State,
  span: Span,
  text: string,
  attrs: ReadonlyAttrs,
): OperationResult {
  const isCollapsed =
    span.anchor.blockId === span.focus.blockId &&
    span.anchor.offset === span.focus.offset;

  // Collapsed span (no range to delete).
  if (isCollapsed) {
    // Pure no-op when there's also no text to insert.
    if (text === "") {
      return { state, dirtyIds: new Set<BlockId>() };
    }
    // Insert-only path. The cursor is just span.anchor — no normalization
    // needed for a collapsed span. insertText's own validation handles
    // missing block / container / offset bounds.
    return insertText(state, span.anchor, text, attrs);
  }

  // Non-collapsed span. Delete first; deleteRange owns existence + leaf +
  // cross-parent + cross-context + offset validation and emits the
  // prefixed error contract directly.
  const deleteResult = deleteRange(state, span);

  // Delete-only path.
  if (text === "") {
    return deleteResult;
  }

  // Full replace: compute the cursor position and insert. Since deleteRange
  // succeeded, both endpoints exist, are leaves, and are in the same
  // selection context — so normalizeSpan(state, span) on the ORIGINAL
  // pre-delete state cannot throw here. The normalized anchor's blockId
  // is the surviving anchor block; its offset is the seam in the post-
  // delete merged content.
  const normalized = normalizeSpan(state, span);
  const cursorPos = createPosition(normalized.anchor.blockId, normalized.anchor.offset);
  const insertResult = insertText(deleteResult.state, cursorPos, text, attrs);

  const combinedDirty = new Set<BlockId>(deleteResult.dirtyIds);
  for (const id of insertResult.dirtyIds) combinedDirty.add(id);
  return { state: insertResult.state, dirtyIds: combinedDirty };
}
