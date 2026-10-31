import type { Editor } from "../editor";
import type { Edit } from "../edit";
import { createSpan } from "../../state";
import { moveByWord } from "../../cursor/cursor-ops";
import type { ActionOf } from "../editor-action";

export function handleExpandWord(editor: Editor, { direction }: ActionOf<"EXPAND_WORD">): Edit | null {
  const newFocus = moveByWord(
    editor.document,
    editor.selection.focus,
    direction,
  );
  return { selection: createSpan(editor.selection.anchor, newFocus) };
}
