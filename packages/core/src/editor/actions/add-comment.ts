import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { addComment, spanStart, spanEnd, selectionContextOf, comparePositions, createPosition, createSpan } from "../../state";
import { isCollapsed } from "../../cursor/selection";
import { isCrossContextSelection } from "./helpers/is-cross-context-selection";
import type { ActionOf } from "../editor-action";

/**
 * `ADD_COMMENT` handler — mints a comment thread over the CURRENT selection by
 * splicing the paired zero-width `comment-start`/`comment-end` marker embeds
 * around the selected range AND writing the thread record, in ONE tracked
 * `applyOperation` transaction (the markers ARE content, so this rides the
 * normal content-op path — markers dirty their block(s) → `applyEdit` →
 * repaint; the `comments` map is in the UndoManager's scopes, so the record
 * reverts atomically with its markers).
 *
 * Returns the editor UNCHANGED (same reference) when the selection cannot carry
 * a comment:
 *  - COLLAPSED — a comment needs a range, never a caret.
 *  - CROSS-CONTEXT (`isCrossContextSelection`) — the span straddles two trees
 *    (e.g. main body ↔ footnote body); the span ops cannot place markers across
 *    a tree boundary.
 *  - NOT IN THE MAIN BODY — the focus's selection context is not `rootId` (a
 *    fully-in-footnote / in-header selection passes the cross-context guard yet
 *    is still not body text). Comments anchor in the main document body only,
 *    mirroring the footnote / cross-reference body-only guards.
 *
 * **Selection preservation (Google Docs keeps the text selected after adding a
 * comment).** The two markers each occupy ONE inline offset unit. With the
 * start-marker landing at `start` and the end-marker at `end` (both computed on
 * the PRE-op state), the user's originally-selected characters now live BETWEEN
 * the markers, so the visible selection must shift OFF the markers:
 *  - new start endpoint = `start.offset + 1` (just after the start-marker);
 *  - new end endpoint = `end.offset + (sameBlock ? 1 : 0)`. When start and end
 *    share a block, inserting the start-marker also pushed the end endpoint by
 *    +1; across different blocks the end endpoint is unshifted (the end-marker
 *    is inserted AT `end.offset` and a left-gravity endpoint at that offset
 *    stays before it).
 *
 * The selection DIRECTION is preserved: whichever original endpoint (`anchor`)
 * coincided with `start` stays the anchor in the rebuilt span, so a forward
 * selection stays forward and a backward one stays backward.
 */
export function handleAddComment(
  editor: EditorState,
  { id, author, body, createdAt }: ActionOf<"ADD_COMMENT">,
): Edit | null {
  // A comment needs a range, not a caret.
  if (isCollapsed(editor.selection)) return null;
  // The span ops cannot place markers across a tree boundary.
  if (isCrossContextSelection(editor.document, editor.selection)) return null;
  // Body-text only: refuse a comment whose focus is inside a footnote / header /
  // footer body (a non-root context). The cross-context guard alone misses a
  // fully-in-footnote selection (both endpoints share that body's context).
  if (
    selectionContextOf(editor.document, editor.selection.focus.blockId) !==
    editor.document.rootId
  ) {
    return null;
  }

  // Resolve the range ends on the PRE-op state — the marker offsets are derived
  // against these positions, so they must be captured before `addComment`.
  const start = spanStart(editor.document, editor.selection);
  const end = spanEnd(editor.document, editor.selection);

  const result = addComment(editor.document, editor.selection, {
    id,
    author,
    body,
    createdAt,
  });
  // Identity invariant: a valid expanded range always mutates, but keep the
  // "no change → same reference" contract robust against a surprise no-op.
  if (result.state === editor.document) return null;

  // Re-derive the visible selection against the +2 marker offsets (markers
  // OUTSIDE the selection), preserving the originally-selected characters.
  const sameBlock = end.blockId === start.blockId;
  const newStart = createPosition(start.blockId, start.offset + 1);
  const newEnd = createPosition(end.blockId, end.offset + (sameBlock ? 1 : 0));
  // Preserve direction: if the original anchor sat at `start`, the rebuilt span
  // anchors at the new start (forward); otherwise it anchors at the new end
  // (backward). `createSpan(a, b)` sets `{ anchor: a, focus: b }`.
  const anchoredAtStart =
    comparePositions(editor.document, editor.selection.anchor, start) === 0;
  const selectionAfter = anchoredAtStart
    ? createSpan(newStart, newEnd)
    : createSpan(newEnd, newStart);

  return { change: result, selection: selectionAfter };
}
