import type { EditorState } from "../../editor-state";
import { deleteRange, markDeletion, spanStart, type Span, type OperationResult } from "../../../state";
import { suggestionInputForBlock } from "./suggestion-input-for-block";

/**
 * Delete the `span` — really (direct editing) or as a tracked SUGGESTION
 * (suggesting mode). In suggesting mode the text is kept and stamped with a
 * `deletionSuggestionId` (struck-through) via `markDeletion`; in direct mode it
 * is removed via `deleteRange`. Both return an `OperationResult`; the caller's
 * cursor/commit/rebuild is identical (for BACKWARD deletes the caret = span
 * start, which is correct for a soft delete too). `markDeletion` is a normal
 * undoable op, so the caller `history.commit`s exactly as for `deleteRange`.
 * It falls back to the direct `deleteRange` branch only when the span's start
 * block resolves to no editing context (see `suggestionInputForBlock`).
 */
export function deleteRangeOrSuggest(
  editor: EditorState,
  span: Span,
): OperationResult {
  const { document: state } = editor;
  const input = suggestionInputForBlock(editor, spanStart(state, span).blockId);
  return input === null
    ? deleteRange(state, span)
    : markDeletion(state, span, input);
}
