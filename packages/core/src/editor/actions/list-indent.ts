import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { shiftListLevel } from "./helpers/shift-list-level";

/** `LIST_INDENT` — one list level deeper. */
export function handleListIndent(editor: EditorState): Edit | null {
  return shiftListLevel(editor, 1);
}
