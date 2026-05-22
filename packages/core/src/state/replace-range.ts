import type { State, OperationResult } from "./state";
import { getBlock } from "./state";
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
 * Error contract for the non-collapsed paths: existence + leaf are
 * checked in this function's pre-normalize guards (emitting deleteRange-
 * prefixed messages — see "Why normalizeSpan runs BEFORE deleteRange"
 * below); the remaining validations (cross-parent, offset bounds,
 * sibling reachability) come from deleteRange. For the collapsed-insert
 * path, errors come from insertText. After deleteRange succeeds, the
 * cursor position is always valid in the post-delete anchor block, so
 * insertText's defensive existence/offset throws are unreachable from
 * the full-replace path.
 *
 * Behavior:
 *   - Collapsed span + empty text: pure no-op.
 *   - Collapsed span + non-empty text: insertText only.
 *   - Non-collapsed span + empty text: deleteRange only.
 *   - Non-collapsed span + non-empty text: deleteRange then insertText.
 *
 * Why normalizeSpan runs BEFORE deleteRange (architectural note):
 * normalizeSpan reads the focus block to compute document order
 * (comparePositions → compareBlocksInDocOrder → ancestorChain →
 * getBlock(focus)). Running it AFTER deleteRange would read against a
 * post-delete state where the focus block has been removed from the
 * Y.Doc — the read would return null, ancestorChain would yield [],
 * and compareBlocksInDocOrder would throw "block ... not found" on
 * what is a successful replace. Running normalizeSpan FIRST reads
 * against the pre-delete state where the focus block still exists.
 *
 * Error-contract preservation: normalizeSpan's compareBlocksInDocOrder
 * has its own "block ... not found" error message for missing blocks,
 * which would shadow this op's prefixed contract ("anchor block ... not
 * found", "focus block ... not found") if it fired first. To preserve
 * the contract, this function runs the same pre-normalize existence +
 * leaf guards that deleteRange uses (anchor/focus reads + container
 * checks) BEFORE calling normalizeSpan. The remaining validations
 * (cross-parent, offset bounds, intervening-sibling reachability) stay
 * in deleteRange, which runs after normalize. The prefixed error
 * contract is therefore split across the pre-flight guards in this
 * function (existence / leaf) and deleteRange's own checks (everything
 * else), but the externally observable contract from
 * replaceRange's caller is unchanged.
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

  // Non-collapsed span.
  //
  // Pre-normalize existence + leaf guards. These mirror deleteRange's
  // own pre-normalize guards (anchor existence, anchor leaf-ness, focus
  // existence, focus leaf-ness) and emit the same prefixed error
  // messages. They have to live here too — normalizeSpan invokes
  // compareBlocksInDocOrder, whose generic "block ... not found"
  // message would otherwise leak through to the caller and shadow the
  // operation's stated error contract. Same architectural pattern
  // deleteRange itself uses for the same reason.
  const sameBlock = span.anchor.blockId === span.focus.blockId;

  const rawAnchor = getBlock(state, span.anchor.blockId);
  if (!rawAnchor) {
    throw new Error(
      sameBlock
        ? `deleteRange: block "${span.anchor.blockId}" not found`
        : `deleteRange: anchor block "${span.anchor.blockId}" not found`,
    );
  }
  if (!rawAnchor.inlineContent || rawAnchor.firstChildId !== null) {
    throw new Error(
      sameBlock
        ? `deleteRange: block "${span.anchor.blockId}" is a container, not a leaf`
        : `deleteRange: anchor block "${span.anchor.blockId}" is a container, not a leaf`,
    );
  }

  if (!sameBlock) {
    const rawFocus = getBlock(state, span.focus.blockId);
    if (!rawFocus) {
      throw new Error(`deleteRange: focus block "${span.focus.blockId}" not found`);
    }
    if (!rawFocus.inlineContent || rawFocus.firstChildId !== null) {
      throw new Error(
        `deleteRange: focus block "${span.focus.blockId}" is a container, not a leaf`,
      );
    }
  }

  // Normalize FIRST so the read happens against the pre-delete state
  // where the focus block still exists in the Y.Doc. The normalized
  // anchor's blockId is the surviving anchor block; its offset is the
  // seam in the post-delete merged content.
  //
  // We pass the ORIGINAL (un-normalized) span to deleteRange —
  // deleteRange normalizes internally and runs its own cross-parent /
  // offset / sibling-reachability guards on the normalized form.
  const normalized = normalizeSpan(state, span);

  const deleteResult = deleteRange(state, span);

  // Delete-only path.
  if (text === "") {
    return deleteResult;
  }

  const cursorPos = createPosition(normalized.anchor.blockId, normalized.anchor.offset);
  const insertResult = insertText(deleteResult.state, cursorPos, text, attrs);

  const combinedDirty = new Set<BlockId>(deleteResult.dirtyIds);
  for (const id of insertResult.dirtyIds) combinedDirty.add(id);
  return { state: insertResult.state, dirtyIds: combinedDirty };
}
