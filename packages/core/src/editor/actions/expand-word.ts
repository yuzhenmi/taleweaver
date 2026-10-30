import type { EditorState } from "../editor-state";
import { createSpan } from "../../state";
import { moveByWord } from "../../cursor/cursor-ops";
import type { ActionOf } from "../editor-action";

export function handleExpandWord(editor: EditorState, { direction }: ActionOf<"EXPAND_WORD">): EditorState {
  const newFocus = moveByWord(
    editor.state,
    editor.selection.focus,
    direction,
  );
  return {
    ...editor,
    selection: createSpan(editor.selection.anchor, newFocus),
  };
}
