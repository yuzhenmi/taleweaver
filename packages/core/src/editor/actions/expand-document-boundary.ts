import type { EditorState } from "../editor-state";
import { createSelection } from "../../cursor/selection";
import { createPosition } from "../../state/position";
import { getTextContentLength } from "../../state/text-utils";
import { findFirstTextDescendant, findLastTextDescendant } from "./helpers";

export function handleExpandDocumentBoundary(
  editor: EditorState,
  boundary: "start" | "end",
): EditorState {
  if (boundary === "start") {
    const first = findFirstTextDescendant(editor.state, []);
    if (!first) return editor;
    return {
      ...editor,
      selection: createSelection(
        editor.selection.anchor,
        createPosition(first.path, 0),
      ),
    };
  } else {
    const last = findLastTextDescendant(editor.state, []);
    if (!last) return editor;
    return {
      ...editor,
      selection: createSelection(
        editor.selection.anchor,
        createPosition(last.path, getTextContentLength(last.node) + 1),
      ),
    };
  }
}
