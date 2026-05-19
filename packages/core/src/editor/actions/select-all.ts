import type { EditorState } from "../editor-state";
import { getBlock } from "../../state/state";
import { createPosition, createSpan } from "../../state/block-position";
import { inlineContentLength } from "../../state/inline-content";
import { findFirstContentBlock, findLastContentBlock } from "./helpers";

export function handleSelectAll(editor: EditorState): EditorState {
  const firstId = findFirstContentBlock(editor.state);
  const lastId = findLastContentBlock(editor.state);
  if (firstId === null || lastId === null) return editor;
  const lastBlock = getBlock(editor.state, lastId);
  if (lastBlock === null) return editor;
  const endOffset =
    lastBlock.inlineContent === null
      ? 0
      : inlineContentLength(lastBlock.inlineContent);
  const anchor = createPosition(firstId, 0);
  const focus = createPosition(lastId, endOffset);
  return { ...editor, selection: createSpan(anchor, focus) };
}
