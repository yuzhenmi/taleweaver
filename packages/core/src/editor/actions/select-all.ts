import type { EditorState } from "../editor-state";
import { createSelection } from "../../cursor/selection";
import { createPosition } from "../../state/position";
import { getTextContentLength } from "../../state/text-utils";
import { findFirstTextDescendant, findLastTextDescendant } from "./helpers";

export function handleSelectAll(editor: EditorState): EditorState {
  const first = findFirstTextDescendant(editor.state, []);
  const last = findLastTextDescendant(editor.state, []);
  if (!first || !last) return editor;
  return {
    ...editor,
    selection: createSelection(
      createPosition(first.path, 0),
      createPosition(last.path, getTextContentLength(last.node) + 1),
    ),
  };
}
