import type { EditorState, EditorConfig } from "../editor-state";
import { createSpan } from "../../state";
import { moveToLineBoundary } from "../../cursor/line-navigation";

export function handleExpandLineBoundary(
  editor: EditorState,
  boundary: "start" | "end",
  config: EditorConfig,
): EditorState {
  const pos = moveToLineBoundary(
    editor.state,
    editor.selection.focus,
    editor.layoutTree,
    config.measurer,
    boundary,
    // #323/C1: shift+Home/End on a header/footer resolves on the editing page.
    editor.caretPageHint,
  );
  if (pos === null) return editor;
  return {
    ...editor,
    selection: createSpan(editor.selection.anchor, pos),
  };
}
