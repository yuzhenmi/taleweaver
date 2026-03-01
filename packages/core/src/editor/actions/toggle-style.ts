import type { NodeStyles } from "../../state/state-node";
import type { EditorState, EditorConfig } from "../editor-state";
import { pushEditorChange } from "../editor-state";
import { createSelection, isCollapsed } from "../../cursor/selection";
import {
  applyInlineStyle,
  getStyleInRange,
  remapPosition,
} from "../../state/formatting";
import { rebuildTrees } from "./helpers";

const STYLE_VALUES: Record<string, { property: keyof NodeStyles; value: string }> = {
  bold: { property: "fontWeight", value: "bold" },
  italic: { property: "fontStyle", value: "italic" },
  underline: { property: "textDecoration", value: "underline" },
};

export function handleToggleStyle(
  editor: EditorState,
  style: "bold" | "italic" | "underline",
  config: EditorConfig,
): EditorState {
  if (isCollapsed(editor.selection)) return editor;

  const { property, value } = STYLE_VALUES[style];
  const idBase = `style-${editor.nextId}`;
  const current = getStyleInRange(editor.state, editor.selection, property);

  const change = current !== undefined
    ? applyInlineStyle(editor.state, editor.selection, { [property]: undefined }, idBase)
    : applyInlineStyle(editor.state, editor.selection, { [property]: value }, idBase);

  if (change.newState === editor.state) return editor;

  // Remap selection through the tree restructuring (paths change but text content doesn't)
  const newSelection = createSelection(
    remapPosition(editor.state, change.newState, editor.selection.anchor),
    remapPosition(editor.state, change.newState, editor.selection.focus),
  );

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
      nextId: editor.nextId + 1,
    },
    editor,
    config,
  );
}
