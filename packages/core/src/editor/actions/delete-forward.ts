import type { EditorState, EditorConfig } from "../editor-state";
import { resolveBlock, createPosition, createSpan, spanEnd, mergeAdjacentBlocks, mergeSectionWithPrevious, inlineContentLength } from "../../state";
import { moveByCharacter } from "../../cursor/cursor-ops";
import { isCollapsed } from "../../cursor/selection";
import { rebuildTrees } from "./helpers";
import { isCrossContextSelection, expandedSpanCollapsePoint } from "./selection-guards";
import { deleteAdjacentAtomicLeaf } from "./atomic-edits";
import { deleteRangeOrSuggest } from "./suggestion-mode";

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
    const result = deleteRangeOrSuggest(editor.state, selection, config);
    if (result.state === editor.state) return editor;
    // Forward soft-delete leaves the struck text in place, so the caret must
    // land PAST it (span END); a direct delete removes the text, so the caret
    // stays at the span start. (Backward soft-delete uses the span start.)
    const suggesting = (config.suggestingAuthor ?? null) !== null;
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
    const suggesting = (config.suggestingAuthor ?? null) !== null;
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

  // Suggesting mode: a forward-delete at the END of a block would MERGE the next
  // block in (or delete an adjacent atomic leaf / remove a section break) —
  // structural changes not yet representable as tracked suggestions (the suggested
  // block-join break-embed is a later change-tracking slice, 4e). Until then it is
  // a safe NO-OP: never really-merge (that would silently bypass tracking).
  if ((config.suggestingAuthor ?? null) !== null) return editor;

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
