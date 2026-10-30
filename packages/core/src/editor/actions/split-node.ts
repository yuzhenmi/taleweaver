import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { resolveBlock, productionAllocator, createPosition, createSpan, deleteRange, splitBlockAtPosition, splitWithSuggestion, splitWithSuggestionOverSelection, markDeletion, spanStart, clipSpanToText, inlineContentLength } from "../../state";
import type { BlockId } from "../../state";
import { isCollapsed } from "../../cursor/selection";
import { isObjectSelection } from "../../cursor/object-selection";
import { isCrossContextSelection } from "./helpers/is-cross-context-selection";
import { expandedSpanCollapsePoint } from "./helpers/expanded-span-collapse-point";
import { shiftListLevel } from "./helpers/shift-list-level";
import { listLevelOf } from "./helpers/list-level-of";
import { unlistBlock } from "./helpers/unlist-block";
import { suggestionInputForBlock } from "./helpers/suggestion-input-for-block";
import { replaceSuggestionInputForBlock } from "./helpers/replace-suggestion-input-for-block";

export function handleSplitNode(editor: EditorState): Edit | null {
  const { config } = editor;
  // Object selection: Enter on a selected atomic-leaf (image) does
  // nothing — an atomic block has no text content to split. No-op (Google Docs).
  if (isObjectSelection(editor.state, editor.selection, config.componentRegistry) !== null) {
    return null;
  }

  let current = editor;
  const { selection } = editor;

  // Accumulate dirtyIds across the optional delete + the required split.
  const accumulatedDirtyIds = new Set<BlockId>();

  if (!isCollapsed(selection)) {
    // Cross-CONTEXT selection refusal (see isCrossContextSelection).
    // Both the suggesting composite and the direct deleteRange would otherwise
    // operate on a cross-tree span (deleteRange throws "no common ancestor"), so
    // refuse here ONCE for both modes.
    if (isCrossContextSelection(editor.state, selection)) return null;
    // Deletable-span guard + collapse point (see expandedSpanCollapsePoint):
    // refuses an unresolvable or cross-parent span.
    const start = expandedSpanCollapsePoint(editor.state, selection);
    if (start === null) return null;

    // Gate on the selection-start block's context: in suggesting mode a non-collapsed
    // Enter SOFT-DELETES the selection then inserts a suggested split — in the main body
    // OR any footnote/header/footer body (`replaceSuggestionInputForBlock` returns null
    // only when not suggesting or the block resolves to no context).
    const replaceInput = replaceSuggestionInputForBlock(editor.state, spanStart(editor.state, selection).blockId, config);
    if (replaceInput !== null) {
      // Suggesting mode: a non-collapsed Enter
      // SOFT-DELETES the selection (text stays, struck) THEN inserts a suggested
      // paragraph split, in ONE undoable transaction. The split lands in the span's
      // text (`clipSpanToText`): a covered object stays in place (its cell text is struck).
      const { anchor: sStart, focus: sEnd } = clipSpanToText(editor.state, selection);
      const splitBlock = resolveBlock(editor.state, sStart.blockId)?.block ?? null;
      const endBlock = resolveBlock(editor.state, sEnd.blockId)?.block ?? null;
      if (
        splitBlock === null ||
        splitBlock.inlineContent === null ||
        splitBlock.parentId === null ||
        endBlock === null ||
        endBlock.inlineContent === null
      ) {
        return null;
      }
      // "Style for the following paragraph": the split lands at the selection END,
      // so the follow-on (heading→paragraph) gate is END-only — the new block is the
      // empty suffix ONLY when the selection ends at the END of its block (else it
      // carries that block's tail and must keep the merged type). Computed against the
      // SELECTION-END block (E) so a cross-block span uses E's length, not B's.
      const atEnd = sEnd.offset === inlineContentLength(endBlock.inlineContent);
      const def = config.componentRegistry.get(splitBlock.type);
      const followOnType =
        atEnd && def !== undefined && def.kind === "leaf" ? def.splitFollowOnType : undefined;

      if (sStart.blockId === sEnd.blockId) {
        // SINGLE-BLOCK: the dedicated soft-delete-then-split composite (struck text
        // stays in the new head BEFORE the break; the block keeps the clean suffix and
        // the caret (B, 0)).
        const newBlockInit =
          followOnType !== undefined ? { type: followOnType, attrs: {} } : undefined;
        const result = splitWithSuggestionOverSelection(
          editor.state,
          selection,
          productionAllocator,
          replaceInput,
          newBlockInit,
        );
        if (result.state === editor.state) return null;
        const newCursor = createPosition(sStart.blockId, 0);
        const newSelection = createSpan(newCursor, newCursor);
        return { change: result, selection: newSelection };
      }

      // CROSS-BLOCK: the selection is soft-deleted (struck, its ¶s keyed), then
      // a suggested ¶ is inserted at the selection END — as the single-block composite
      // (Word / GDocs put the insertion after the struck text). The split at E's
      // post-strike end is the direct split rule: at k = len the tail B takes
      // `followOnType`, so accepting gives exactly the direct delete-then-split result.
      // E keeps its id (a removed own ¶ leaves the survivor R) and the strike never
      // touches its tail, so the post-strike split offset is E's length minus the tail.
      const mint = { author: replaceInput.author, createdAt: replaceInput.createdAt, order: replaceInput.order, noCoalesce: replaceInput.noCoalesce };
      const del = markDeletion(editor.state, selection, { ...mint, id: replaceInput.deletionId });
      const postEnd = resolveBlock(del.state, sEnd.blockId)?.block ?? null;
      if (postEnd === null || postEnd.inlineContent === null) return null;
      const tailLen = inlineContentLength(endBlock.inlineContent) - sEnd.offset;
      const splitPos = createPosition(sEnd.blockId, inlineContentLength(postEnd.inlineContent) - tailLen);
      const newBlockInit = followOnType !== undefined ? { type: followOnType, attrs: {} } : undefined;
      const split = splitWithSuggestion(del.state, splitPos, productionAllocator, { ...mint, id: replaceInput.insertionId }, newBlockInit);
      for (const id of del.dirtyIds) accumulatedDirtyIds.add(id);
      for (const id of split.dirtyIds) accumulatedDirtyIds.add(id);
      const newCursor = createPosition(sEnd.blockId, 0);
      const newSelection = createSpan(newCursor, newCursor);
      return { change: { state: split.state, dirtyIds: accumulatedDirtyIds }, selection: newSelection };
    }

    // Direct mode: delete the span, then fall through to the shared collapsed split.
    const deleteResult = deleteRange(editor.state, selection);
    for (const id of deleteResult.dirtyIds) accumulatedDirtyIds.add(id);
    const collapsedCursor = createPosition(start.blockId, start.offset);
    current = {
      ...editor,
      state: deleteResult.state,
      selection: createSpan(collapsedCursor, collapsedCursor),
    };
  }

  const pos = current.selection.focus;
  const block = resolveBlock(current.state, pos.blockId)?.block ?? null;
  // The range delete is committed even when the split itself cannot happen.
  const deleteEdit = (): Edit | null =>
    current === editor
      ? null
      : { change: { state: current.state, dirtyIds: accumulatedDirtyIds }, selection: current.selection };
  if (block === null) return deleteEdit();

  // Split is only meaningful on leaf blocks under a non-null parent.
  if (block.inlineContent === null || block.parentId === null) return deleteEdit();

  // Enter on an EMPTY list-item exits the list rather than creating another
  // empty item (Google Docs): a nested item (level>0) outdents one level; a
  // top-level item (level 0) becomes a plain paragraph. Gated to a plain
  // collapsed Enter (no preceding range-delete, `current === editor`) so the
  // rare delete-then-empty case falls through to a normal split.
  if (
    current === editor &&
    block.type === "list-item" &&
    inlineContentLength(block.inlineContent) === 0
  ) {
    return listLevelOf(block) > 0
      ? shiftListLevel(editor, -1)
      : unlistBlock(editor, block, config);
  }

  // "Style for the following paragraph" (Word / Google Docs): pressing Enter at
  // the END of a block whose component declares a `splitFollowOnType` (e.g. a
  // heading) makes the NEW (empty) block that type — a heading is followed by a
  // Normal paragraph. The gate is END-only: at the end the new block is the
  // empty suffix, so overriding ITS type is exactly right; a mid/start split's
  // suffix carries content, so overriding would wrongly demote it — both halves
  // keep the original type there. Fresh attrs `{}` so the new paragraph does not
  // inherit heading attrs (e.g. `level`).
  const atEnd = pos.offset === inlineContentLength(block.inlineContent);
  const def = config.componentRegistry.get(block.type);
  const followOnType =
    atEnd && def !== undefined && def.kind === "leaf" ? def.splitFollowOnType : undefined;
  const newBlockInit =
    followOnType !== undefined ? { type: followOnType, attrs: {} } : undefined;

  // Suggesting mode: route the split through `splitWithSuggestion` (a tracked
  // INSERTION of a paragraph break — a REAL structural split PLUS the boundary tag
  // on the new block + an `insertion` record, ONE undoable op). Everything downstream (cursor → (B, 0),
  // `applyEdit`) is
  // IDENTICAL to the direct path because the split is real; `newBlockInit` is
  // threaded through unchanged.
  // Gate on the split block's context: a split in ANY editing context (main body
  // OR a footnote/header/footer body) is TRACKED via `splitWithSuggestion`;
  // `suggestionInputForBlock` returns null only when not suggesting or the block
  // resolves to no context, → the direct `splitBlockAtPosition` path.
  const suggestInput = suggestionInputForBlock(current.state, pos.blockId, config);
  const splitResult =
    suggestInput === null
      ? splitBlockAtPosition(current.state, pos, productionAllocator, newBlockInit)
      : splitWithSuggestion(current.state, pos, productionAllocator, suggestInput, newBlockInit);
  for (const id of splitResult.dirtyIds) accumulatedDirtyIds.add(id);

  // Chained ops accumulate dirtyIds manually. Use the
  // identity-no-op contract — splitResult.state === editor.state iff every
  // chained primitive was a no-op:
  //   - collapsed branch: splitResult is built from editor.state, so
  //     splitResult.state === editor.state iff split itself was no-op.
  //   - !collapsed branch with non-no-op delete: deleteResult.state
  //     !== editor.state, so splitResult.state (built from it) is
  //     also !== editor.state regardless of split.
  //   - !collapsed branch with no-op delete (pathological — e.g.
  //     equal-position selection that slipped past isCollapsed for
  //     some structural reason): current.state === editor.state, and
  //     splitResult.state === editor.state iff split is also no-op.
  // In every subcase, splitResult.state === editor.state ⇔ both
  // primitives were no-ops, so returning editor is correct.
  if (splitResult.state === editor.state) return null;

  // The caret goes to the start of the block AFTER the break: the caret's own block,
  // which keeps the tail + its ¶ (the head [0, k) is the new block).
  const newCursor = createPosition(pos.blockId, 0);
  const newSelection = createSpan(newCursor, newCursor);

  return { change: { state: splitResult.state, dirtyIds: accumulatedDirtyIds }, selection: newSelection };
}
