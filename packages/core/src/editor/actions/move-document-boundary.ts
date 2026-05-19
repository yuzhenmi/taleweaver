import type { EditorState } from "../editor-state";
import { createCursor } from "../../cursor/selection";
import { getTextContentLength } from "../../state/text-utils-legacy";
import { findFirstTextDescendant, findLastTextDescendant } from "./helpers";

export function handleMoveDocumentBoundary(
  editor: EditorState,
  boundary: "start" | "end",
): EditorState {
  if (boundary === "start") {
    const first = findFirstTextDescendant(editor.stateLegacy, []);
    if (!first) return editor;
    return { ...editor, selection: createCursor(first.path, 0) };
  } else {
    const last = findLastTextDescendant(editor.stateLegacy, []);
    if (!last) return editor;
    return {
      ...editor,
      selection: createCursor(last.path, getTextContentLength(last.node)),
    };
  }
}
