import type { EditorState, EditorConfig } from "../editor-state";
import { getBlock } from "../../state/state";
import { createPosition, createSpan } from "../../state/block-position";
import { spanStart } from "../../state/block-compare";
import { deleteRange } from "../../state/delete-range";
import { mergeAdjacentBlocks } from "../../state/merge-blocks";
import { moveByCharacter } from "../../cursor/cursor-ops";
import { inlineContentLength } from "../../state/inline-content";
import { rebuildTrees } from "./helpers";

export function handleDeleteForward(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  const { selection } = editor;
  const collapsed =
    selection.anchor.blockId === selection.focus.blockId &&
    selection.anchor.offset === selection.focus.offset;

  // Non-collapsed: delete range. Cursor goes to spanStart.
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
    const result = deleteRange(editor.state, selection);
    if (result.dirtyIds.size === 0) return editor;
    const newCursor = createPosition(start.blockId, start.offset);
    const newSelection = createSpan(newCursor, newCursor);
    editor.history.commit(result, {
      before: selection,
      after: newSelection,
    });
    return rebuildTrees(
      { ...editor, state: result.state, selection: newSelection },
      editor,
      config,
    );
  }

  const pos = selection.focus;
  const currentBlock = getBlock(editor.state, pos.blockId);
  if (currentBlock === null) return editor;
  const currentLen =
    currentBlock.inlineContent === null
      ? 0
      : inlineContentLength(currentBlock.inlineContent);

  // Mid-block: delete one grapheme cluster going forward.
  if (pos.offset < currentLen) {
    const next = moveByCharacter(editor.state, pos, "forward");
    if (next.blockId !== pos.blockId) return editor;
    if (next.offset === pos.offset) return editor;
    const span = createSpan(pos, next);
    const result = deleteRange(editor.state, span);
    if (result.dirtyIds.size === 0) return editor;
    const newCursor = createPosition(pos.blockId, pos.offset);
    const newSelection = createSpan(newCursor, newCursor);
    editor.history.commit(result, {
      before: selection,
      after: newSelection,
    });
    return rebuildTrees(
      { ...editor, state: result.state, selection: newSelection },
      editor,
      config,
    );
  }

  // pos.offset === end of block: cross-block forward delete (merge next into current).
  const nextPos = moveByCharacter(editor.state, pos, "forward");
  if (nextPos.blockId === pos.blockId) {
    return editor;
  }
  const nextBlock = getBlock(editor.state, nextPos.blockId);
  if (nextBlock === null) return editor;

  if (
    currentBlock.parentId !== nextBlock.parentId ||
    currentBlock.nextSiblingId !== nextBlock.id ||
    nextBlock.prevSiblingId !== currentBlock.id
  ) {
    return editor;
  }

  const result = mergeAdjacentBlocks(
    editor.state,
    currentBlock.id,
    nextBlock.id,
  );
  if (result.dirtyIds.size === 0) return editor;
  // After merge, cursor stays at the same spot in the (now-merged) current block.
  const newCursor = createPosition(currentBlock.id, currentLen);
  const newSelection = createSpan(newCursor, newCursor);
  editor.history.commit(result, {
    before: selection,
    after: newSelection,
  });
  return rebuildTrees(
    { ...editor, state: result.state, selection: newSelection },
    editor,
    config,
  );
}
