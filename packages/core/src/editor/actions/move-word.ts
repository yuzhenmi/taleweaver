import type { EditorState, EditorConfig } from "../editor-state";
import { createSpan } from "../../state";
import { moveByWord } from "../../cursor/cursor-ops";
import { isObjectSelection } from "../../cursor/object-selection";
import { moveOffObject } from "./object-edits";

export function handleMoveWord(
  editor: EditorState,
  direction: "forward" | "backward",
  config: EditorConfig,
): EditorState {
  // Object selection (#525): Ctrl+Arrow on a selected atomic-leaf (image) places
  // the caret immediately BESIDE the object (before/after it), not past it. A
  // raw `moveByWord` from offset 0 of the atomic block would skip the image and
  // land inside the adjacent paragraph.
  const objId = isObjectSelection(editor.state, editor.selection, config.componentRegistry);
  if (objId !== null) return moveOffObject(editor, objId, direction);

  const newFocus = moveByWord(editor.state, editor.selection.focus, direction);
  return { ...editor, selection: createSpan(newFocus, newFocus) };
}
