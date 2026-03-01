import type { EditorState, EditorConfig } from "../editor-state";
import { pushEditorChange } from "../editor-state";
import { createCursor, isCollapsed } from "../../cursor/selection";
import { createPosition, normalizeSpan } from "../../state/position";
import { insertText, replaceRange } from "../../state/transformations";
import { rebuildTrees } from "./helpers";

export function handleInsertText(
  editor: EditorState,
  text: string,
  config: EditorConfig,
): EditorState {
  // If selection is expanded, replace the selected range
  if (!isCollapsed(editor.selection)) {
    const normalized = normalizeSpan(editor.selection);
    const change = replaceRange(editor.state, normalized, text);
    const newPos = createPosition(
      normalized.anchor.path,
      normalized.anchor.offset + text.length,
    );
    const newSelection = createCursor(newPos.path, newPos.offset);

    return rebuildTrees(
      {
        ...editor,
        state: change.newState,
        selection: newSelection,
        history: pushEditorChange(editor.history, {
          change,
          selectionBefore: editor.selection,
          selectionAfter: newSelection,
        }),
      },
      editor,
      config,
    );
  }

  const pos = editor.selection.focus;
  const change = insertText(editor.state, pos, text);
  const newPos = createPosition(pos.path, pos.offset + text.length);
  const newSelection = createCursor(newPos.path, newPos.offset);

  return rebuildTrees(
    {
      ...editor,
      state: change.newState,
      selection: newSelection,
      history: pushEditorChange(editor.history, {
        change,
        selectionBefore: editor.selection,
        selectionAfter: newSelection,
      }, "insert"),
    },
    editor,
    config,
  );
}
