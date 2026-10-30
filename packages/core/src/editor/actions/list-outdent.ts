import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { shiftListLevel } from "./helpers/shift-list-level";

/** `LIST_OUTDENT` — one list level shallower. */
export function handleListOutdent(editor: EditorState): Edit | null {
  return shiftListLevel(editor, -1);
}
