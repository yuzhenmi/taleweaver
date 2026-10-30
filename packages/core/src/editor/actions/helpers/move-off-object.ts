import type { EditorState } from "../../editor-state";
import type { Edit } from "../../edit";
import type { BlockId } from "../../../state";
import { objectMoveSelection } from "./object-move-selection";

/**
 * Move the caret OFF the selected object (Arrow keys on a selected image place
 * the caret beside it, Google Docs). PURE selection move — a selection-only `Edit`,
 * no block mutation:
 *  - `"forward"` → caret at the START of the next inline-bearing block;
 *  - `"backward"` → caret at the END of the previous inline-bearing block.
 *
 * When there is no neighbour in that direction (document edge), the caret stays
 * on the object (returns `null`) rather than crashing.
 */
export function moveOffObject(
  editor: EditorState,
  objId: BlockId,
  direction: "forward" | "backward",
): Edit | null {
  const selection = objectMoveSelection(editor.state, objId, direction);
  return selection === null ? null : { selection };
}
