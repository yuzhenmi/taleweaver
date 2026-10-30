import type { EditorConfig } from "../../editor-config";
import { selectionContextOf, type State, type BlockId } from "../../../state";

/** True iff an edit at `blockId` is in suggesting mode AND resolves to a valid
 *  editing context — i.e. it will be tracked as a suggestion. Use this for
 *  caret-placement decisions that depend on whether a delete was a soft-delete
 *  (text kept, caret skips it) vs a direct delete (text removed).
 *  (See `suggestionInputForBlock` for the all-context tracking rule.) */
export function isSuggestingInBlock(state: State, blockId: BlockId, config: EditorConfig): boolean {
  if ((config.suggestingAuthor ?? null) === null) return false;
  return selectionContextOf(state, blockId) !== null;
}
