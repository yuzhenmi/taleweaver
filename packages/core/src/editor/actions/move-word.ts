import type { EditorState } from "../editor-state";
import { createSpan } from "../../state";
import { moveByWord } from "../../cursor/cursor-ops";
import { isObjectSelection } from "../../cursor/object-selection";
import { moveOffObject } from "./helpers/move-off-object";
import type { ActionOf } from "../editor-action";
import type { Edit } from "../edit";

export function handleMoveWord(editor: EditorState, { direction }: ActionOf<"MOVE_WORD">): Edit | null {
  const { config } = editor;
  // Object selection: Ctrl+Arrow on a selected atomic-leaf (image) places
  // the caret immediately BESIDE the object (before/after it), not past it. A
  // raw `moveByWord` from offset 0 of the atomic block would skip the image and
  // land inside the adjacent paragraph.
  const objId = isObjectSelection(editor.document, editor.selection, config.componentRegistry);
  if (objId !== null) return moveOffObject(editor, objId, direction);

  const newFocus = moveByWord(editor.document, editor.selection.focus, direction);
  return { selection: createSpan(newFocus, newFocus) };
}
