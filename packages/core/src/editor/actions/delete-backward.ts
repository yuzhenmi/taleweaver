import type { EditorState, EditorConfig } from "../editor-state";
import { resolveBlock, createPosition, createSpan, mergeAdjacentBlocks, markBlockJoinSuggestion, mergeSectionWithPrevious, inlineContentLength } from "../../state";
import { moveByCharacter } from "../../cursor/cursor-ops";
import { isCollapsed } from "../../cursor/selection";
import { rebuildTrees } from "./helpers";
import { isCrossContextSelection, expandedSpanCollapsePoint } from "./selection-guards";
import { handleListIndent } from "./list-indent";
import { listLevelOf, unlistBlock } from "./list-edits";
import { deleteAdjacentAtomicLeaf } from "./atomic-edits";
import { deleteObjectSelection } from "./object-edits";
import { isObjectSelection } from "../../cursor/object-selection";
import { deleteRangeOrSuggest, suggestionInputForBlock } from "./suggestion-mode";

export function handleDeleteBackward(
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

  // Mid-block: delete one grapheme cluster going backward.
  if (pos.offset > 0) {
    const prev = moveByCharacter(editor.state, pos, "backward");
    if (prev.blockId !== pos.blockId) return editor;
    if (prev.offset === pos.offset) return editor;
    const span = createSpan(prev, pos);
    const result = deleteRangeOrSuggest(editor.state, span, config);
    if (result.state === editor.state) return editor;
    const newCursor = createPosition(prev.blockId, prev.offset);
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

  // pos.offset === 0: cross-block backspace.
  const currentBlock = resolveBlock(editor.state, pos.blockId)?.block ?? null;
  if (currentBlock === null) return editor;

  // Backspace at the START of a list-item (Google Docs): a nested item (level>0)
  // outdents one level; a top-level item (level 0) drops its list formatting and
  // becomes a plain paragraph — rather than merging into the previous block.
  if (currentBlock.type === "list-item") {
    return listLevelOf(currentBlock) > 0
      ? handleListIndent(editor, -1, config)
      : unlistBlock(editor, currentBlock, config);
  }

  // Backspace at the start of a block whose immediately-preceding sibling is an
  // atomic-leaf (image / horizontal-line): delete that atomic object as a unit
  // (Google Docs). moveByCharacter skips atomic blocks (no inlineContent), so
  // without this the merge path no-ops and the object can't be removed.
  const atomicDeleted = deleteAdjacentAtomicLeaf(
    editor,
    config,
    currentBlock,
    "backward",
    pos,
  );
  if (atomicDeleted !== null) return atomicDeleted;

  const prevPos = moveByCharacter(editor.state, pos, "backward");
  if (prevPos.blockId === pos.blockId) {
    // moveByCharacter returned same position (at start of doc, or no
    // prev content block) — no-op.
    return editor;
  }
  const prevBlock = resolveBlock(editor.state, prevPos.blockId)?.block ?? null;
  if (prevBlock === null) return editor;

  // Section-boundary backspace: the cursor is at the START of a flat doc-root
  // `section`'s FIRST child, and that section has a previous section sibling.
  // Remove the break by merging this section into its predecessor (the block
  // keeps its id — it just reparents onto the end of the previous section —
  // so the cursor stays put). The boundary paragraphs are NOT merged (Word /
  // Google Docs behavior: a second Backspace then merges them via the
  // same-parent path below).
  if (currentBlock.parentId !== null) {
    // resolveBlock so a header/footer caret's parent (the body root, in
    // templateContents) resolves — but the section-merge below is gated to
    // doc-root `section`s (`section.parentId === editor.state.rootId`), so a
    // header body root (whose parent is null / not the doc root) cannot
    // satisfy the guard and the branch SKIPS: a header backspace falls through
    // to the normal same-parent merge path. Main-tree behavior byte-identical
    // (resolveBlock's first arm is getBlock).
    const section = resolveBlock(editor.state, currentBlock.parentId)?.block ?? null;
    if (
      section !== null &&
      section.type === "section" &&
      section.parentId === editor.state.rootId &&
      section.firstChildId === currentBlock.id &&
      section.prevSiblingId !== null
    ) {
      const result = mergeSectionWithPrevious(editor.state, section.id);
      if (result.state === editor.state) return editor;
      const newCursor = createPosition(pos.blockId, 0);
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

  // Only merge if same parent + adjacent siblings.
  if (
    prevBlock.parentId !== currentBlock.parentId ||
    prevBlock.nextSiblingId !== currentBlock.id ||
    currentBlock.prevSiblingId !== prevBlock.id
  ) {
    return editor;
  }

  // Suggesting mode: mark the paragraph break BEFORE currentBlock for deletion
  // (a suggested JOIN) instead of really merging. `markBlockJoinSuggestion`'s
  // `secondBlockId` = currentBlock.id (N+1); it appends the zero-width
  // `block-join-suggestion` embed to currentBlock's prev sibling = prevBlock (N).
  // Blocks stay separate; the caret stays at currentBlock:0 (= pos; no merge
  // happened, so the selection is unchanged). One undoable op.
  // Gate on the join-target block's context: a paragraph-boundary backspace in
  // ANY editing context (main body OR a footnote/header/footer body) marks a
  // tracked JOIN; `suggestionInputForBlock` returns null only when not suggesting
  // or the block resolves to no context, → the DIRECT real-merge path below. A
  // body IS a container of paragraphs, so para↔para joins are reachable there.
  const joinInput = suggestionInputForBlock(editor.state, currentBlock.id, config);
  if (joinInput !== null) {
    const result = markBlockJoinSuggestion(editor.state, currentBlock.id, joinInput);
    if (result.state === editor.state) return editor;
    editor.history.commit(result, { before: selection, after: selection });
    return rebuildTrees(
      { ...editor, state: result.state, selection },
      editor,
      config,
      result.dirtyIds,
    );
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
  if (result.state === editor.state) return editor;
  const newCursor = createPosition(prevBlock.id, prevEndOffset);
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
