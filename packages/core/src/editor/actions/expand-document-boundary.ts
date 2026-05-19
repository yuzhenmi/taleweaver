import type { EditorState } from "../editor-state";
import { getBlock } from "../../state/state";
import { createPosition, createSpan } from "../../state/block-position";
import { inlineContentLength } from "../../state/inline-content";
import { findFirstContentBlock, findLastContentBlock } from "./helpers";

export function handleExpandDocumentBoundary(
  editor: EditorState,
  boundary: "start" | "end",
): EditorState {
  if (boundary === "start") {
    const firstId = findFirstContentBlock(editor.state);
    if (firstId === null) return editor;
    const focus = createPosition(firstId, 0);
    return {
      ...editor,
      selection: createSpan(editor.selection.anchor, focus),
    };
  }
  const lastId = findLastContentBlock(editor.state);
  if (lastId === null) return editor;
  const lastBlock = getBlock(editor.state, lastId);
  if (lastBlock === null) return editor;
  const offset =
    lastBlock.inlineContent === null
      ? 0
      : inlineContentLength(lastBlock.inlineContent);
  const focus = createPosition(lastId, offset);
  return {
    ...editor,
    selection: createSpan(editor.selection.anchor, focus),
  };
}
