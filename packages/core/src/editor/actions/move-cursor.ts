import type { EditorState } from "../editor-state";
import { createSpan } from "../../state/block-position";
import { spanStart, spanEnd } from "../../state/block-compare";
import { moveByCharacter } from "../../cursor/cursor-ops";

export function handleMoveCursor(
  editor: EditorState,
  direction: "forward" | "backward",
): EditorState {
  const { selection } = editor;
  const collapsed =
    selection.anchor.blockId === selection.focus.blockId &&
    selection.anchor.offset === selection.focus.offset;

  // If selection is expanded, collapse to start/end without moving.
  if (!collapsed) {
    const pos =
      direction === "forward"
        ? spanEnd(editor.state, selection)
        : spanStart(editor.state, selection);
    return { ...editor, selection: createSpan(pos, pos) };
  }

  const newFocus = moveByCharacter(editor.state, selection.focus, direction);
  return { ...editor, selection: createSpan(newFocus, newFocus) };
}
