import type { EditorState, EditorConfig } from "../editor-state";
import { resolveBlock, productionAllocator, createPosition, createSpan, deleteRange, splitBlockAtPosition, splitWithSuggestion, splitWithSuggestionOverSelection, replaceWithSuggestedFragment, spanStart, spanEnd, inlineContentLength } from "../../state";
import type { BlockId } from "../../state";
import { isCollapsed } from "../../cursor/selection";
import { isObjectSelection } from "../../cursor/object-selection";
import { rebuildTrees } from "./helpers";
import { isCrossContextSelection, expandedSpanCollapsePoint } from "./selection-guards";
import { handleListIndent } from "./list-indent";
import { listLevelOf, unlistBlock } from "./list-edits";
import { suggestionInputForBlock, replaceSuggestionInputForBlock } from "./suggestion-mode";

export function handleSplitNode(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  // Object selection (#525): Enter on a selected atomic-leaf (image) does
  // nothing — an atomic block has no text content to split. No-op (Google Docs).
  if (isObjectSelection(editor.state, editor.selection, config.componentRegistry) !== null) {
    return editor;
  }

  let current = editor;
  const { selection } = editor;

  // Accumulate dirtyIds across the optional delete + the required split.
  const accumulatedDirtyIds = new Set<BlockId>();

  if (!isCollapsed(selection)) {
    // C.2c §6: cross-CONTEXT selection refusal (see isCrossContextSelection).
    // Both the suggesting composite and the direct deleteRange would otherwise
    // operate on a cross-tree span (deleteRange throws "no common ancestor"), so
    // refuse here ONCE for both modes.
    if (isCrossContextSelection(editor.state, selection)) return editor;
    // Deletable-span guard + collapse point (see expandedSpanCollapsePoint):
    // refuses an unresolvable or cross-parent span.
    const start = expandedSpanCollapsePoint(editor.state, selection);
    if (start === null) return editor;

    // Gate on the selection-start block's context: in suggesting mode a non-collapsed
    // Enter SOFT-DELETES the selection then inserts a suggested split — in the main body
    // OR any footnote/header/footer body (`replaceSuggestionInputForBlock` returns null
    // only when not suggesting or the block resolves to no context).
    const sStart = spanStart(editor.state, selection);
    const replaceInput = replaceSuggestionInputForBlock(editor.state, sStart.blockId, config);
    if (replaceInput !== null) {
      // Suggesting mode (4e-editor-composite + PF-4): a non-collapsed Enter
      // SOFT-DELETES the selection (text stays, struck) THEN inserts a suggested
      // paragraph split, in ONE undoable transaction.
      const sEnd = spanEnd(editor.state, selection);
      const splitBlock = resolveBlock(editor.state, sStart.blockId)?.block ?? null;
      const endBlock = resolveBlock(editor.state, sEnd.blockId)?.block ?? null;
      if (
        splitBlock === null ||
        splitBlock.inlineContent === null ||
        splitBlock.parentId === null ||
        endBlock === null ||
        endBlock.inlineContent === null
      ) {
        return editor;
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
        // stays in block N BEFORE the break; caret → the clean suffix block N+1).
        const newBlockInit =
          followOnType !== undefined ? { type: followOnType, attrs: {} } : undefined;
        const result = splitWithSuggestionOverSelection(
          editor.state,
          selection,
          productionAllocator,
          replaceInput,
          newBlockInit,
        );
        if (result.state === editor.state) return editor;
        // Caret → start of the new (suffix) block.
        const updated = resolveBlock(result.state, sStart.blockId)?.block ?? null;
        const newBlockId = updated?.nextSiblingId ?? null;
        if (newBlockId === null) return editor;
        const newCursor = createPosition(newBlockId, 0);
        const newSelection = createSpan(newCursor, newCursor);
        editor.history.commit(result, { before: selection, after: newSelection });
        return rebuildTrees(
          { ...editor, state: result.state, selection: newSelection },
          editor,
          config,
          result.dirtyIds,
        );
      }

      // CROSS-BLOCK (PF-4): "insert a paragraph break" over a multi-block selection.
      // Model it as replacing the selection with an EMPTY two-line fragment via the
      // fragment composite — the selection is soft-deleted (struck, with a block-join
      // suggestion per crossed boundary) and a suggested split is inserted; accept
      // removes the selection + leaves ONE break, reject restores the original blocks.
      // The break's NEW block inherits the start block's type/attrs (matching the
      // direct path's delete-then-split merge), overridden by `followOnType` (fresh
      // attrs) when the selection ends at end-of-E (the new block is then empty).
      const breakType = followOnType ?? splitBlock.type;
      const breakAttrs = followOnType !== undefined ? {} : splitBlock.attrs;
      const fragment = [
        { type: splitBlock.type, attrs: splitBlock.attrs, inlineContent: { items: [] } },
        { type: breakType, attrs: breakAttrs, inlineContent: { items: [] } },
      ];
      const result = replaceWithSuggestedFragment(
        editor.state,
        selection,
        fragment,
        replaceInput,
        productionAllocator,
      );
      if (result.state === editor.state) return editor;
      const newCursor = result.endPosition;
      const newSelection = createSpan(newCursor, newCursor);
      editor.history.commit(
        { state: result.state, dirtyIds: result.dirtyIds },
        { before: selection, after: newSelection },
      );
      return rebuildTrees(
        { ...editor, state: result.state, selection: newSelection },
        editor,
        config,
        result.dirtyIds,
      );
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
  if (block === null) return editor;

  // Split is only meaningful on leaf blocks under a non-null parent.
  if (block.inlineContent === null || block.parentId === null) {
    return current === editor ? editor : current;
  }

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
      ? handleListIndent(editor, -1, config)
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
  // INSERTION of a paragraph break — a REAL structural split PLUS a zero-width
  // `block-split-suggestion` embed on block N + an `insertion` record, ONE
  // undoable op). Everything downstream (cursor → newBlockId:0 via
  // `updatedOriginal.nextSiblingId`, `history.commit`, `rebuildTrees`) is
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

  // E-B / #141: chained ops accumulate dirtyIds manually. Use the T7
  // identity contract — splitResult.state === editor.state iff every
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
  if (splitResult.state === editor.state) return editor;

  const updatedOriginal = resolveBlock(splitResult.state, pos.blockId)?.block ?? null;
  if (updatedOriginal === null) return editor;
  const newBlockId = updatedOriginal.nextSiblingId;
  if (newBlockId === null) return editor;
  const newCursor = createPosition(newBlockId, 0);
  const newSelection = createSpan(newCursor, newCursor);

  editor.history.commit(
    { state: splitResult.state, dirtyIds: accumulatedDirtyIds },
    { before: selection, after: newSelection },
  );
  return rebuildTrees(
    { ...current, state: splitResult.state, selection: newSelection },
    editor,
    config,
    accumulatedDirtyIds,
  );
}
