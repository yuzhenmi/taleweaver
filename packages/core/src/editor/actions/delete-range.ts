import type { EditorState } from "../editor-state";
import { expandSpanOverAtomicMarks } from "../atomic-marks";
import { createPosition, createSpan, spanStart, bookmarkDeletionSpan } from "../../state";
import { deleteRangeOrSuggest, isSuggestingInBlock } from "./suggestion-mode";
import { rebuildTrees } from "./helpers";
import { expandedSpanCollapsePoint } from "./selection-guards";
import type { ActionOf } from "../editor-action";

/**
 * Delete a geometry-free `Span` in a SINGLE history commit, collapsing the caret
 * to the document-order START of the span. The print backend computes the span
 * (e.g. for line-deletion / Cmd+Backspace — the geometry lives in the backend
 * NavIntent) and dispatches `DELETE_RANGE`; core owns the deletion. Mirrors the
 * lifted `DELETE_LINE` collapsed-tail (`before: original-selection`,
 * `after: collapsed-to-start`) byte-for-byte.
 *
 * DELETE_RANGE is PUBLIC (any caller may dispatch an arbitrary span), so it NORMALIZES
 * the span first: the caret always collapses to the document-order start
 * regardless of the caller's anchor/focus direction (a backward span — anchor
 * AFTER focus — deletes the same text and collapses to the document-order start,
 * NOT the anchor). In suggesting mode this SOFT-deletes (markDeletion stamps the
 * runs, struck text stays).
 */
export function handleDeleteRange(editor: EditorState, { span }: ActionOf<"DELETE_RANGE">): EditorState {
  const { config } = editor;
  // Normalized, and grown over any atomic mark it only partly covers.
  const norm = expandSpanOverAtomicMarks(editor.state, span);
  const result = deleteRangeOrSuggest(editor.state, norm, config);
  if (result.state === editor.state) return editor;
  // Direct mode: the seam in the survivor R, as Backspace over a selection.
  const start = isSuggestingInBlock(editor.state, spanStart(editor.state, norm).blockId, config)
    ? spanStart(editor.state, norm)
    : expandedSpanCollapsePoint(editor.state, norm) ?? bookmarkDeletionSpan(editor.state, norm).span.anchor;
  const newCursor = createPosition(start.blockId, start.offset);
  const newSelection = createSpan(newCursor, newCursor);
  editor.history.commit(result, { before: editor.selection, after: newSelection });
  return rebuildTrees(
    { ...editor, state: result.state, selection: newSelection },
    editor,
    config,
    result.dirtyIds,
  );
}
