import type { EditorState, EditorConfig } from "../editor-state";
import {
  addComment,
  resolveComment,
  reopenComment,
  deleteComment,
  addReply,
  spanStart,
  spanEnd,
  selectionContextOf,
  comparePositions,
  createPosition,
  createSpan,
  getBlock,
  COMMENT_START_EMBED_TYPE,
  COMMENT_END_EMBED_TYPE,
  type CommentId,
  type OperationResult,
  type Position,
} from "../../state";
import { isCollapsed } from "../../cursor/selection";
import { rebuildTrees } from "./helpers";
import { isCrossContextSelection } from "./selection-guards";

/**
 * `ADD_COMMENT` handler — mints a comment thread over the CURRENT selection by
 * splicing the paired zero-width `comment-start`/`comment-end` marker embeds
 * around the selected range AND writing the thread record, in ONE tracked
 * `applyOperation` transaction (the markers ARE content, so this rides the
 * normal content-op path — markers dirty their block(s) → `rebuildTrees` →
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
  id: CommentId,
  author: string,
  body: string,
  createdAt: number,
  config: EditorConfig,
): EditorState {
  // A comment needs a range, not a caret.
  if (isCollapsed(editor.selection)) return editor;
  // The span ops cannot place markers across a tree boundary.
  if (isCrossContextSelection(editor.state, editor.selection)) return editor;
  // Body-text only: refuse a comment whose focus is inside a footnote / header /
  // footer body (a non-root context). The cross-context guard alone misses a
  // fully-in-footnote selection (both endpoints share that body's context).
  if (
    selectionContextOf(editor.state, editor.selection.focus.blockId) !==
    editor.state.rootId
  ) {
    return editor;
  }

  // Resolve the range ends on the PRE-op state — the marker offsets are derived
  // against these positions, so they must be captured before `addComment`.
  const start = spanStart(editor.state, editor.selection);
  const end = spanEnd(editor.state, editor.selection);

  const result = addComment(editor.state, editor.selection, {
    id,
    author,
    body,
    createdAt,
  });
  // Identity invariant: a valid expanded range always mutates, but keep the
  // "no change → same reference" contract robust against a surprise no-op.
  if (result.state === editor.state) return editor;

  // Re-derive the visible selection against the +2 marker offsets (markers
  // OUTSIDE the selection), preserving the originally-selected characters.
  const sameBlock = end.blockId === start.blockId;
  const newStart = createPosition(start.blockId, start.offset + 1);
  const newEnd = createPosition(end.blockId, end.offset + (sameBlock ? 1 : 0));
  // Preserve direction: if the original anchor sat at `start`, the rebuilt span
  // anchors at the new start (forward); otherwise it anchors at the new end
  // (backward). `createSpan(a, b)` sets `{ anchor: a, focus: b }`.
  const anchoredAtStart =
    comparePositions(editor.state, editor.selection.anchor, start) === 0;
  const selectionAfter = anchoredAtStart
    ? createSpan(newStart, newEnd)
    : createSpan(newEnd, newStart);

  editor.history.commit(
    { state: result.state, dirtyIds: result.dirtyIds },
    { before: editor.selection, after: selectionAfter },
  );
  return rebuildTrees(
    { ...editor, state: result.state, selection: selectionAfter },
    editor,
    config,
    result.dirtyIds,
  );
}

/**
 * `RESOLVE_COMMENT` handler — flips the thread record's `resolved` flag to
 * `true` (a tracked side-table write; the `comments` map is in the
 * UndoManager's scopes, so this is undoable). Identity no-op (returns the editor
 * UNCHANGED) when the comment is absent or already resolved — the op returns the
 * same `state` reference per the T7 contract.
 *
 * The selection is unaffected (this touches only the comments side-table — or
 * surfaces `rootId` as its dirtyId — never inline content), so the `after`
 * selection equals the `before` selection.
 */
export function handleResolveComment(
  editor: EditorState,
  id: CommentId,
  config: EditorConfig,
): EditorState {
  return commitFlagChange(editor, resolveComment(editor.state, id), config);
}

/**
 * `REOPEN_COMMENT` handler — flips the thread record's `resolved` flag back to
 * `false`. The exact mirror of {@link handleResolveComment}: undoable tracked
 * write, identity no-op when absent or already open, selection unchanged.
 */
export function handleReopenComment(
  editor: EditorState,
  id: CommentId,
  config: EditorConfig,
): EditorState {
  return commitFlagChange(editor, reopenComment(editor.state, id), config);
}

/**
 * `DELETE_COMMENT` handler — removes BOTH markers from content AND the thread
 * record, in ONE tracked transaction (undoable as a unit; redo re-adds).
 * Identity no-op (returns the editor UNCHANGED) when the comment is absent.
 *
 * Invoked from the comment sidebar, so the document selection is typically in an
 * UNRELATED block. The `after` selection is the current selection REMAPPED through
 * the (zero-width) marker removal: each endpoint's offset is reduced by the number
 * of this comment's markers stripped at earlier positions in ITS block, so a
 * caret/selection that sat IN a block that lost a marker keeps its visually-correct
 * position and never lands past the shrunk block length. For an endpoint in a block
 * with no stripped markers (the sidebar-driven case — caret elsewhere) the remap is
 * the identity, so the supported path is unchanged.
 */
export function handleDeleteComment(
  editor: EditorState,
  id: CommentId,
  config: EditorConfig,
): EditorState {
  const result = deleteComment(editor.state, id);
  if (result.state === editor.state) return editor;
  const remap = (p: Position): Position => {
    const stripped = strippedMarkersBefore(editor, id, p);
    return stripped === 0 ? p : createPosition(p.blockId, p.offset - stripped);
  };
  const after = createSpan(remap(editor.selection.anchor), remap(editor.selection.focus));
  editor.history.commit(
    { state: result.state, dirtyIds: result.dirtyIds },
    { before: editor.selection, after },
  );
  return rebuildTrees(
    { ...editor, state: result.state, selection: after },
    editor,
    config,
    result.dirtyIds,
  );
}

/**
 * Count this comment's `comment-start`/`comment-end` markers in `pos`'s block that
 * sit STRICTLY BEFORE `pos.offset` (against the PRE-delete state) — the amount to
 * subtract from `pos.offset` to keep its visual position after the markers are
 * stripped. Markers are zero-width (one offset unit each), so this is exact; a
 * block with no markers for `id` yields 0 (identity remap).
 */
function strippedMarkersBefore(editor: EditorState, id: CommentId, pos: Position): number {
  const items = getBlock(editor.state, pos.blockId)?.inlineContent?.items ?? [];
  let running = 0;
  let stripped = 0;
  for (const it of items) {
    if (
      it.kind === "embed" &&
      (it.embedType === COMMENT_START_EMBED_TYPE || it.embedType === COMMENT_END_EMBED_TYPE) &&
      it.properties.commentId === id &&
      running < pos.offset
    ) {
      stripped += 1;
    }
    running += it.kind === "text" ? it.text.length : 1;
  }
  return stripped;
}

/**
 * `ADD_REPLY` handler — appends a reply to the thread record's `replies` array
 * (a tracked side-table write; undoable). Identity no-op (returns the editor
 * UNCHANGED) when the comment is absent. The selection is unaffected.
 */
export function handleAddReply(
  editor: EditorState,
  commentId: CommentId,
  replyId: string,
  author: string,
  body: string,
  createdAt: number,
  config: EditorConfig,
): EditorState {
  const result = addReply(editor.state, commentId, {
    replyId,
    author,
    body,
    createdAt,
  });
  return commitFlagChange(editor, result, config);
}

/**
 * Shared commit path for the comment side-table ops (resolve / reopen / reply)
 * that change NO inline content and leave the selection untouched. Identity
 * no-op short-circuit per the T7 contract, then commit + rebuild with the same
 * selection.
 */
function commitFlagChange(
  editor: EditorState,
  result: OperationResult,
  config: EditorConfig,
): EditorState {
  if (result.state === editor.state) return editor;
  editor.history.commit(
    { state: result.state, dirtyIds: result.dirtyIds },
    { before: editor.selection, after: editor.selection },
  );
  return rebuildTrees(
    { ...editor, state: result.state },
    editor,
    config,
    result.dirtyIds,
  );
}
