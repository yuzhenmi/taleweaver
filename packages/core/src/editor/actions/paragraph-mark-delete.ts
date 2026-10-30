import type { EditorState } from "../editor-state";
import { createPosition, createSpan, markParagraphMarkDeletion } from "../../state";
import type { Block, OperationResult, Position, SuggestionMintInput } from "../../state";
import type { Edit } from "../edit";

/** `result` as an edit leaving a collapsed caret at `caret`. */
export function caretEdit(result: OperationResult, caret: Position): Edit {
  return { change: result, selection: createSpan(createPosition(caret.blockId, caret.offset), createPosition(caret.blockId, caret.offset)) };
}

/**
 * Suggesting-mode Backspace / Delete over ¶`owner` (`markParagraphMarkDeletion`):
 * keyed → the caret stays; the author's own pending ¶ removed for real → the caret goes
 * to the seam; nothing written (already deletion-keyed, or a ¶ accepting would keep) →
 * the caret moves to `across` (no history entry).
 */
export function suggestMarkDeletion(editor: EditorState, owner: Block, input: SuggestionMintInput, across: Position): Edit {
  const result = markParagraphMarkDeletion(editor.state, owner.id, input);
  if (result.state === editor.state) return { selection: createSpan(across, across) };
  const removed = result.removedBoundary;
  return caretEdit(result, removed === null ? editor.selection.focus : createPosition(removed.survivorId, removed.offset));
}
