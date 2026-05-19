import type { EditorState, EditorConfig } from "../editor-state";
import { createSpan } from "../../state/block-position";
import { spanStart, spanEnd } from "../../state/block-compare";
import { moveToLine } from "../../cursor/line-navigation";

export function handleMoveLine(
  editor: EditorState,
  direction: "up" | "down",
  config: EditorConfig,
): EditorState {
  const { selection } = editor;
  const collapsed =
    selection.anchor.blockId === selection.focus.blockId &&
    selection.anchor.offset === selection.focus.offset;

  // If selection is expanded, collapse to appropriate end then move to adjacent line.
  const moveFocus = collapsed
    ? selection.focus
    : direction === "up"
      ? spanStart(editor.state, selection)
      : spanEnd(editor.state, selection);

  const result = moveToLine(
    editor.state,
    moveFocus,
    editor.layoutTree,
    config.measurer,
    direction,
    editor.targetX,
  );
  if (result === null) return editor;
  return {
    ...editor,
    selection: createSpan(result.position, result.position),
    targetX: result.targetX,
  };
}
