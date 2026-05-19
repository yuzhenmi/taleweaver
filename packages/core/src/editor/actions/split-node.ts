import type { EditorState, EditorConfig } from "../editor-state";
import { getBlock } from "../../state/state";
import { productionAllocator } from "../../state/block-id";
import { createPosition, createSpan } from "../../state/block-position";
import { spanStart } from "../../state/block-compare";
import { deleteRange } from "../../state/delete-range";
import { splitBlockAtPosition } from "../../state/split-block";
import { rebuildTrees } from "./helpers";

export function handleSplitNode(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  let current = editor;
  const { selection } = editor;
  const collapsed =
    selection.anchor.blockId === selection.focus.blockId &&
    selection.anchor.offset === selection.focus.offset;

  if (!collapsed) {
    const anchorBlock = getBlock(editor.state, selection.anchor.blockId);
    const focusBlock = getBlock(editor.state, selection.focus.blockId);
    if (anchorBlock === null || focusBlock === null) return editor;
    if (
      selection.anchor.blockId !== selection.focus.blockId &&
      anchorBlock.parentId !== focusBlock.parentId
    ) {
      return editor;
    }
    const start = spanStart(editor.state, selection);
    const deleteResult = deleteRange(editor.state, selection);
    const collapsedCursor = createPosition(start.blockId, start.offset);
    current = {
      ...editor,
      state: deleteResult.state,
      selection: createSpan(collapsedCursor, collapsedCursor),
    };
  }

  const pos = current.selection.focus;
  const block = getBlock(current.state, pos.blockId);
  if (block === null) return editor;

  // Split is only meaningful on leaf blocks under a non-null parent.
  if (block.inlineContent === null || block.parentId === null) {
    return current === editor ? editor : current;
  }

  const splitResult = splitBlockAtPosition(
    current.state,
    pos,
    productionAllocator,
  );

  const updatedOriginal = getBlock(splitResult.state, pos.blockId);
  if (updatedOriginal === null) return editor;
  const newBlockId = updatedOriginal.nextSiblingId;
  if (newBlockId === null) return editor;
  const newCursor = createPosition(newBlockId, 0);
  const newSelection = createSpan(newCursor, newCursor);

  editor.history.setState(splitResult.state);
  editor.history.push({ selection: newSelection });
  return rebuildTrees(
    { ...current, state: splitResult.state, selection: newSelection },
    editor,
    config,
  );
}
