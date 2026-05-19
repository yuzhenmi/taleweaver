import type { EditorState, EditorConfig } from "../editor-state";
import { getBlock } from "../../state/state";
import { createPosition, createSpan } from "../../state/block-position";
import { spanStart } from "../../state/block-compare";
import { deleteRange } from "../../state/delete-range";
import { mergeAdjacentBlocks } from "../../state/merge-blocks";
import { moveByCharacter } from "../../cursor/cursor-ops";
import { inlineContentLength } from "../../state/inline-content";
import { rebuildTrees } from "./helpers";

export function handleDeleteBackward(
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
    // deleteRange throws on cross-parent — skip with no-op if so.
    if (
      selection.anchor.blockId !== selection.focus.blockId &&
      anchorBlock.parentId !== focusBlock.parentId
    ) {
      return editor;
    }
    const start = spanStart(editor.state, selection);
    const result = deleteRange(editor.state, selection);
    const newCursor = createPosition(start.blockId, start.offset);
    const newSelection = createSpan(newCursor, newCursor);
    editor.history.setState(result.state);
    editor.history.push({ selection: newSelection });
    return rebuildTrees(
      { ...editor, state: result.state, selection: newSelection },
      editor,
      config,
    );
  }

  const pos = selection.focus;

  // Mid-block: delete one grapheme cluster going backward.
  if (pos.offset > 0) {
    const prev = moveByCharacter(editor.state, pos, "backward");
    if (prev.blockId !== pos.blockId) return editor;
    if (prev.offset === pos.offset) return editor;
    const span = createSpan(prev, pos);
    const result = deleteRange(editor.state, span);
    const newCursor = createPosition(prev.blockId, prev.offset);
    const newSelection = createSpan(newCursor, newCursor);
    editor.history.setState(result.state);
    editor.history.push({ selection: newSelection });
    return rebuildTrees(
      { ...editor, state: result.state, selection: newSelection },
      editor,
      config,
    );
  }

  // pos.offset === 0: cross-block backspace.
  const currentBlock = getBlock(editor.state, pos.blockId);
  if (currentBlock === null) return editor;
  const prevPos = moveByCharacter(editor.state, pos, "backward");
  if (prevPos.blockId === pos.blockId) {
    // moveByCharacter returned same position (at start of doc, or no
    // prev content block) — no-op.
    return editor;
  }
  const prevBlock = getBlock(editor.state, prevPos.blockId);
  if (prevBlock === null) return editor;

  // Only merge if same parent + adjacent siblings.
  if (
    prevBlock.parentId !== currentBlock.parentId ||
    prevBlock.nextSiblingId !== currentBlock.id ||
    currentBlock.prevSiblingId !== prevBlock.id
  ) {
    return editor;
  }

  const prevEndOffset =
    prevBlock.inlineContent === null
      ? 0
      : inlineContentLength(prevBlock.inlineContent);

  const result = mergeAdjacentBlocks(
    editor.state,
    prevBlock.id,
    currentBlock.id,
  );
  const newCursor = createPosition(prevBlock.id, prevEndOffset);
  const newSelection = createSpan(newCursor, newCursor);
  editor.history.setState(result.state);
  editor.history.push({ selection: newSelection });
  return rebuildTrees(
    { ...editor, state: result.state, selection: newSelection },
    editor,
    config,
  );
}
