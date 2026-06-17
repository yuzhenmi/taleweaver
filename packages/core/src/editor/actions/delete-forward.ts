import type { EditorState, EditorConfig } from "../editor-state";
import { resolveBlock, createPosition, createSpan, spanStart, spanEnd, mergeAdjacentBlocks, markBlockJoinSuggestion, mergeSectionWithPrevious, inlineContentLength } from "../../state";
import { moveByCharacter } from "../../cursor/cursor-ops";
import { isCollapsed } from "../../cursor/selection";
import { rebuildTrees } from "./helpers";
import { isCrossContextSelection, expandedSpanCollapsePoint } from "./selection-guards";
import { deleteAdjacentAtomicLeaf } from "./atomic-edits";
import { deleteObjectSelection } from "./object-edits";
import { isObjectSelection } from "../../cursor/object-selection";
import { deleteRangeOrSuggest, suggestionInputForBlock, isSuggestingInBlock } from "./suggestion-mode";

export function handleDeleteForward(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  const { selection } = editor;

  // Object selection: remove the selected image as a unit — a hard `removeBlock`
  // in BOTH direct and suggesting mode (matching deleteAdjacentAtomicLeaf, which
  // has no suggesting branch — whole-block deletion-as-suggestion does not exist
  // for any atomic block; a pre-existing change-tracking gap, NOT this slice's
  // concern).
  const objId = isObjectSelection(editor.state, selection, config.componentRegistry);
  if (objId !== null) return deleteObjectSelection(editor, config, objId);

  // Non-collapsed: delete range. Cursor goes to spanStart.
  if (!isCollapsed(selection)) {
    // C.2c §6: cross-CONTEXT selection refusal (see isCrossContextSelection).
    if (isCrossContextSelection(editor.state, selection)) return editor;
    // Deletable-span guard + collapse point (see expandedSpanCollapsePoint):
    // refuses an unresolvable or cross-parent span.
    const start = expandedSpanCollapsePoint(editor.state, selection);
    if (start === null) return editor;
    const result = deleteRangeOrSuggest(editor.state, selection, config);
    if (result.state === editor.state) return editor;
    // Forward soft-delete leaves the struck text in place, so the caret must
    // land PAST it (span END); a direct delete removes the text, so the caret
    // stays at the span start. (Backward soft-delete uses the span start.)
    // `suggesting` reflects the ACTUAL outcome — a soft-delete in ANY editing
    // context (main body OR a footnote/header/footer body) leaves the struck text,
    // so the caret advances to span END; only when there is no valid context does
    // it become a direct delete with the caret at span start.
    const suggesting = isSuggestingInBlock(
      editor.state,
      spanStart(editor.state, selection).blockId,
      config,
    );
    const collapseTo = suggesting ? spanEnd(editor.state, selection) : start;
    const newCursor = createPosition(collapseTo.blockId, collapseTo.offset);
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
    const result = deleteRangeOrSuggest(editor.state, span, config);
    if (result.state === editor.state) return editor;
    // Forward soft-delete strikes the char in place, so the caret must ADVANCE
    // past it (to `next`, the span end) — else the next Delete would re-target
    // the already-struck char (markDeletion coalesces → no-op). A direct delete
    // removes the char, so the caret stays at `pos` (content shrank).
    // `suggesting` reflects the ACTUAL outcome — a soft-delete in ANY editing
    // context (main body OR a footnote/header/footer body) leaves the struck char,
    // so the caret advances to `next`; only with no valid context is it a direct
    // delete with the caret at `pos`.
    const suggesting = isSuggestingInBlock(
      editor.state,
      spanStart(editor.state, span).blockId,
      config,
    );
    const newCursor = suggesting
      ? createPosition(next.blockId, next.offset)
      : createPosition(pos.blockId, pos.offset);
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

  // Delete at the end of a block whose immediately-following sibling is an
  // atomic-leaf (image / horizontal-line): delete that atomic object as a unit
  // (Google Docs). moveByCharacter skips atomic blocks (no inlineContent), so
  // without this the merge path no-ops and the object can't be removed.
  const atomicDeleted = deleteAdjacentAtomicLeaf(
    editor,
    config,
    currentBlock,
    "forward",
    pos,
  );
  if (atomicDeleted !== null) return atomicDeleted;

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

  // Suggesting mode: mark the paragraph break AFTER currentBlock (before
  // nextBlock) for deletion (a suggested JOIN) instead of really merging.
  // `markBlockJoinSuggestion`'s `secondBlockId` = nextBlock.id → the embed lands
  // at currentBlock's end (nextBlock's prev sibling = currentBlock). Blocks stay
  // separate; the caret stays at currentBlock:currentLen (= pos; no merge). One
  // undoable op.
  // Gate on the join-target block's context: a paragraph-boundary forward-delete
  // in ANY editing context (main body OR a footnote/header/footer body) marks a
  // tracked JOIN; `suggestionInputForBlock` returns null only when not suggesting
  // or the block resolves to no context, → the DIRECT real-merge path below. A
  // body IS a container of paragraphs, so para↔para joins are reachable there.
  const joinInput = suggestionInputForBlock(editor.state, nextBlock.id, config);
  if (joinInput !== null) {
    const result = markBlockJoinSuggestion(editor.state, nextBlock.id, joinInput);
    if (result.state === editor.state) return editor;
    const newCursor = createPosition(currentBlock.id, currentLen);
    const newSelection = createSpan(newCursor, newCursor);
    editor.history.commit(result, { before: selection, after: newSelection });
    return rebuildTrees(
      { ...editor, state: result.state, selection: newSelection },
      editor,
      config,
      result.dirtyIds,
    );
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
