import type { EditorState } from "../../editor-state";
import { selectionContextOf, type ReplaceSuggestionInput, type BlockId } from "../../../state";
import { newReplaceSuggestionInput } from "./new-replace-suggestion-input";

/**
 * The replace (two-id) create-op `input` for a type-over edit at `blockId`, or
 * `null` when NOT suggesting OR `blockId` resolves to no editing context (same
 * rule as `suggestionInputForBlock`).
 */
export function replaceSuggestionInputForBlock(
  editor: EditorState,
  blockId: BlockId,
): ReplaceSuggestionInput | null {
  if (selectionContextOf(editor.document, blockId) === null) return null;
  return newReplaceSuggestionInput(editor);
}
