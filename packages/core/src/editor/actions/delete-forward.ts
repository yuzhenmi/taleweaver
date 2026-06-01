import type { EditorState, EditorConfig } from "../editor-state";
import { resolveBlock, createPosition, createSpan, deleteRange, mergeAdjacentBlocks, mergeSectionWithPrevious, inlineContentLength } from "../../state";
import { moveByCharacter } from "../../cursor/cursor-ops";
import { isCollapsed } from "../../cursor/selection";
import { rebuildTrees } from "./helpers";
import { isCrossContextSelection, expandedSpanCollapsePoint } from "./selection-guards";

export function handleDeleteForward(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  const { selection } = editor;

  // Non-collapsed: delete range. Cursor goes to spanStart.
  if (!isCollapsed(selection)) {
    // C.2c §6: cross-CONTEXT selection refusal (see isCrossContextSelection).
    if (isCrossContextSelection(editor.state, selection)) return editor;
    // Deletable-span guard + collapse point (see expandedSpanCollapsePoint):
    // refuses an unresolvable or cross-parent span.
    const start = expandedSpanCollapsePoint(editor.state, selection);
    if (start === null) return editor;
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
  const currentBlock = resolveBlock(editor.state, pos.blockId)?.block ?? null;
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
  const nextBlock = resolveBlock(editor.state, nextPos.blockId)?.block ?? null;
  if (nextBlock === null) return editor;

  // Section-boundary forward delete: the cursor is at the END of a flat
  // doc-root `section` P's LAST child, and P has a next section sibling X.
  // Remove the break by merging X into P (X's blocks reparent onto the end of
  // P; X is dropped). The cursor stays at the end of P's last block, which
  // keeps its id. The boundary paragraphs are NOT merged (Word / Google Docs
  // behavior: a second Delete then merges them via the same-parent path
  // below).
  if (currentBlock.parentId !== null) {
    // resolveBlock so a header/footer caret's parent (body root, in
    // templateContents) resolves — but the section-merge is gated to doc-root
    // `section`s (`section.parentId === editor.state.rootId`), so a header body
    // root cannot satisfy the guard and the branch SKIPS (header forward-delete
    // falls through to the normal same-parent merge). Main-tree byte-identical.
    const section = resolveBlock(editor.state, currentBlock.parentId)?.block ?? null;
    if (
      section !== null &&
      section.type === "section" &&
      section.parentId === editor.state.rootId &&
      section.lastChildId === currentBlock.id &&
      section.nextSiblingId !== null
    ) {
      const nextSection = resolveBlock(editor.state, section.nextSiblingId)?.block ?? null;
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
