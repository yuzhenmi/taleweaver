import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { INDENT_STEP, shiftIndent } from "./helpers/shift-indent";

/** `OUTDENT` — one step less indent (see `shiftIndent`). */
export function handleOutdent(editor: EditorState): Edit | null {
  return shiftIndent(editor, -INDENT_STEP);
}
