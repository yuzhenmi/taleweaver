import type { Editor } from "../editor";
import type { Edit } from "../edit";
import { shiftListLevel } from "./helpers/shift-list-level";

/** `LIST_INDENT` — one list level deeper. */
export function handleListIndent(editor: Editor): Edit | null {
  return shiftListLevel(editor, 1);
}
