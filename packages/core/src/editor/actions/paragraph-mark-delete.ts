import type { EditorState } from "../editor-state";
import type { EditorConfig } from "../editor-config";
import { createPosition, createSpan, markParagraphMarkDeletion } from "../../state";
import type { Block, OperationResult, Position, SuggestionMintInput } from "../../state";
import { rebuildTrees } from "./helpers";
import { handleSetSelection } from "./set-selection";

/** Commit `result` as one undo entry with a collapsed caret at `caret`, and rebuild. */
export function commitWithCaret(
  editor: EditorState,
  config: EditorConfig,
  result: OperationResult,
  caret: Position,
): EditorState {
  const after = createSpan(createPosition(caret.blockId, caret.offset), createPosition(caret.blockId, caret.offset));
  editor.history.commit(result, { before: editor.selection, after });
  return rebuildTrees({ ...editor, state: result.state, selection: after }, editor, config, result.dirtyIds);
}

/**
 * Suggesting-mode Backspace / Delete over ¶`owner` (`markParagraphMarkDeletion`):
 * keyed → the caret stays; the author's own pending ¶ removed for real → the caret goes
 * to the seam; nothing written (already deletion-keyed, or a ¶ accepting would keep) →
 * the caret moves to `across` (no history entry).
 */
export function suggestMarkDeletion(editor: EditorState, config: EditorConfig, owner: Block, input: SuggestionMintInput, across: Position): EditorState {
  const result = markParagraphMarkDeletion(editor.state, owner.id, input);
  if (result.state === editor.state) return handleSetSelection(editor, createSpan(across, across));
  const removed = result.removedBoundary;
  return commitWithCaret(editor, config, result, removed === null ? editor.selection.focus : createPosition(removed.survivorId, removed.offset));
}
