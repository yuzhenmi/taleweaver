import type { EditorState } from "../editor-state";
import { createCursor } from "../../cursor/selection";
import { getTextContentLength } from "../../state/text-utils";
import { findFirstTextDescendant, findLastTextDescendant } from "./helpers";

export function handleMoveDocumentBoundary(
  editor: EditorState,
  boundary: "start" | "end",
): EditorState {
  if (boundary === "start") {
    const first = findFirstTextDescendant(editor.state, []);
    if (!first) return editor;
    return { ...editor, selection: createCursor(first.path, 0) };
  } else {
    const last = findLastTextDescendant(editor.state, []);
    if (!last) return editor;
    return {
      ...editor,
      selection: createCursor(last.path, getTextContentLength(last.node)),
    };
  }
}
