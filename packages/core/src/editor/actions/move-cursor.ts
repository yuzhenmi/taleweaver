import type { EditorState } from "../editor-state";
import {
  createCursor,
  isCollapsed,
  selectionStart,
  selectionEnd,
} from "../../cursor/selection";
import { moveByCharacter } from "../../cursor/cursor-ops";
import { getNodeByPath } from "../../state/operations";
import { getTextContentLength } from "../../state/text-utils";

export function handleMoveCursor(
  editor: EditorState,
  direction: "forward" | "backward",
): EditorState {
  // If selection is expanded, collapse to start/end without moving
  if (!isCollapsed(editor.selection)) {
    const pos =
      direction === "forward"
        ? selectionEnd(editor.selection)
        : selectionStart(editor.selection);
    // Clamp virtual EOL offset to textLength
    const node = getNodeByPath(editor.state, pos.path);
    const maxOffset = node ? getTextContentLength(node) : pos.offset;
    const offset = Math.min(pos.offset, maxOffset);
    return { ...editor, selection: createCursor(pos.path, offset) };
  }

  const newSelection = moveByCharacter(
    editor.state,
    editor.selection.focus,
    direction,
  );
  return { ...editor, selection: newSelection };
}
