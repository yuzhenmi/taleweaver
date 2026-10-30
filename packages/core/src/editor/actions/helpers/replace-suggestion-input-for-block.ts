import type { EditorConfig } from "../../editor-config";
import { selectionContextOf, type ReplaceSuggestionInput, type State, type BlockId } from "../../../state";
import { newReplaceSuggestionInput } from "./new-replace-suggestion-input";

/**
 * The replace (two-id) create-op `input` for a type-over edit at `blockId`, or
 * `null` when NOT suggesting OR `blockId` resolves to no editing context (same
 * rule as `suggestionInputForBlock`).
 */
export function replaceSuggestionInputForBlock(
  state: State,
  blockId: BlockId,
  config: EditorConfig,
): ReplaceSuggestionInput | null {
  if (selectionContextOf(state, blockId) === null) return null;
  return newReplaceSuggestionInput(config);
}
