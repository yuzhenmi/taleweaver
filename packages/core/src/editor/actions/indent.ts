import type { Editor } from "../editor";
import type { Edit } from "../edit";
import { INDENT_STEP, shiftIndent } from "./helpers/shift-indent";

/** `INDENT` — one step more indent (see `shiftIndent`). */
export function handleIndent(editor: Editor): Edit | null {
  return shiftIndent(editor, INDENT_STEP);
}
