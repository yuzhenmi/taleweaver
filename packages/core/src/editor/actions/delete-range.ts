import type { EditorState, EditorConfig } from "../editor-state";
import type { Span } from "../../state";
import { createPosition, createSpan, normalizeSpan, spanStart } from "../../state";
import { deleteRangeOrSuggest } from "./suggestion-mode";
import { rebuildTrees } from "./helpers";

/**
 * Delete a geometry-free `Span` in a SINGLE history commit, collapsing the caret
 * to the document-order START of the span. The print backend computes the span
 * (e.g. for line-deletion / Cmd+Backspace — the geometry lives in the backend
 * NavIntent) and dispatches `DELETE_RANGE`; core owns the deletion. Mirrors the
 * lifted `DELETE_LINE` collapsed-tail (`before: original-selection`,
 * `after: collapsed-to-start`) byte-for-byte.
 *
 * DELETE_RANGE is PUBLIC (Phase 2 dispatches arbitrary spans), so it NORMALIZES
 * the span first: the caret always collapses to the document-order start
 * regardless of the caller's anchor/focus direction (a backward span — anchor
 * AFTER focus — deletes the same text and collapses to the document-order start,
 * NOT the anchor). In suggesting mode this SOFT-deletes (markDeletion stamps the
 * runs, struck text stays).
 */
export function handleDeleteRange(
  editor: EditorState,
  span: Span,
  config: EditorConfig,
): EditorState {
  const norm = normalizeSpan(editor.state, span);
  const result = deleteRangeOrSuggest(editor.state, norm, config);
  if (result.state === editor.state) return editor;
  const start = spanStart(editor.state, norm);
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
