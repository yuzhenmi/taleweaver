import type { EditorState, EditorConfig } from "../editor-state";
import { getBlock, createPosition, createSpan, spanStart, deleteRange, mergeAdjacentBlocks, mergeSectionWithPrevious, inlineContentLength } from "../../state";
import { moveByCharacter } from "../../cursor/cursor-ops";
import { isCollapsed } from "../../cursor/selection";
import { rebuildTrees } from "./helpers";

export function handleDeleteForward(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  const { selection } = editor;

  // Non-collapsed: delete range. Cursor goes to spanStart.
  if (!isCollapsed(selection)) {
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
    if (result.state === editor.state) return editor;
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
      result.dirtyIds,
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
    if (result.state === editor.state) return editor;
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
      result.dirtyIds,
    );
  }

  // pos.offset === end of block: cross-block forward delete (merge next into current).
  const nextPos = moveByCharacter(editor.state, pos, "forward");
  if (nextPos.blockId === pos.blockId) {
    return editor;
  }
  const nextBlock = getBlock(editor.state, nextPos.blockId);
  if (nextBlock === null) return editor;

  // Section-boundary forward delete: the cursor is at the END of a flat
  // doc-root `section` P's LAST child, and P has a next section sibling X.
  // Remove the break by merging X into P (X's blocks reparent onto the end of
  // P; X is dropped). The cursor stays at the end of P's last block, which
  // keeps its id. The boundary paragraphs are NOT merged (Word / Google Docs
  // behavior: a second Delete then merges them via the same-parent path
  // below).
  if (currentBlock.parentId !== null) {
    const section = getBlock(editor.state, currentBlock.parentId);
    if (
      section !== null &&
      section.type === "section" &&
      section.parentId === editor.state.rootId &&
      section.lastChildId === currentBlock.id &&
      section.nextSiblingId !== null
    ) {
      const nextSection = getBlock(editor.state, section.nextSiblingId);
      if (nextSection !== null && nextSection.type === "section") {
        const result = mergeSectionWithPrevious(editor.state, nextSection.id);
        if (result.state === editor.state) return editor;
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
          result.dirtyIds,
        );
      }
    }
  }

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
  if (result.state === editor.state) return editor;
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
    result.dirtyIds,
  );
}
