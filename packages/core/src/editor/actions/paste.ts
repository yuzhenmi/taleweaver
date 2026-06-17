import type { EditorState, EditorConfig } from "../editor-state";
import { getBlock, resolveBlock, productionAllocator, createPosition, createSpan, spanStart, deleteRange, insertText, splitBlockAtPosition, insertBlocksAfter, replaceWithSuggestedFragment } from "../../state";
import type { State, BlockId, Position, SiblingBlockInit, InlineContent } from "../../state";
import { isCollapsed } from "../../cursor/selection";
import { rebuildTrees } from "./helpers";
import { replaceSuggestionInputForBlock } from "./suggestion-mode";
import { isCrossContextSelection } from "./selection-guards";

/**
 * Build the inline content for one pasted line: a single empty-attrs text
 * run, or an empty leaf when the line is empty. Pasted runs carry EMPTY
 * attrs `{}` (matching the legacy per-line `insertText(..., {})` path).
 */
function lineToInlineContent(lineText: string): InlineContent {
  return lineText.length > 0
    ? { items: [{ kind: "text", text: lineText, attrs: {} }] }
    : { items: [] };
}

export function handlePaste(
  editor: EditorState,
  rawText: string,
  config: EditorConfig,
): EditorState {
  if (rawText.length === 0) return editor;

  // Normalize line endings: strip \r so \r\n becomes \n.
  const text = rawText.replace(/\r/g, "");

  const { selection } = editor;

  // A cross-CONTEXT span (anchor/focus in different trees) has no single-tree op, so
  // refuse it (no-op) BEFORE any `spanStart` / normalization — which throws "no common
  // ancestor" on such a span. This mirrors the INSERT_TEXT / SPLIT_NODE guard order
  // (SET_SELECTION already rejects cross-context spans, so this is defense-in-depth)
  // and is mode-independent: a cross-context span is equally a no-op on the direct path.
  if (isCrossContextSelection(editor.state, selection)) return editor;

  // Suggesting mode: insert the paste as ONE tracked suggestion instead of mutating
  // destructively. The fragment is a tracked INSERTION (inter-line breaks are
  // block-split-suggestion embeds); a paste OVER a selection ALSO soft-deletes it
  // (cross-block: a block-join-suggestion per crossed boundary) — accept lands the
  // paste, reject restores the document. Tracking is ALL-CONTEXT (main + footnote /
  // header / footer bodies) via `replaceSuggestionInputForBlock`. When NOT suggesting
  // / no editing context, `replaceInput` is null → fall through to the direct path.
  const startBlockId = spanStart(editor.state, selection).blockId;
  const replaceInput = replaceSuggestionInputForBlock(editor.state, startBlockId, config);
  if (replaceInput !== null) {
    // New blocks inherit the caret block's TYPE + ATTRS (resolveBlock → all-tree, so a
    // footnote-body paste resolves too), matching the direct path's `sourceType` /
    // `sourceAttrs` clone — so accepting a multi-line paste into a heading keeps the
    // heading type AND level. (Only fragment[1..] are materialized as new blocks; the
    // first line merges into the existing block, which keeps its own type/attrs.)
    const sourceBlock = resolveBlock(editor.state, startBlockId)?.block ?? null;
    const sourceType = sourceBlock?.type ?? "paragraph";
    const sourceAttrs = sourceBlock?.attrs ?? {};
    const fragment: SiblingBlockInit[] = text
      .split("\n")
      .map((line) => ({ type: sourceType, attrs: sourceAttrs, inlineContent: lineToInlineContent(line) }));
    const result = replaceWithSuggestedFragment(
      editor.state,
      selection,
      fragment,
      replaceInput,
      productionAllocator,
    );
    if (result.state === editor.state) return editor;
    const newSelection = createSpan(result.endPosition, result.endPosition);
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

  // Collapse selection (delete the existing range first).
  let state: State = editor.state;
  let pos: Position = editor.selection.focus;

  // Accumulate dirtyIds across every chained op so commit reflects the
  // full set of touched blocks for downstream consumers.
  const accumulatedDirtyIds = new Set<BlockId>();

  if (!isCollapsed(selection)) {
    const anchorBlock = getBlock(state, selection.anchor.blockId);
    const focusBlock = getBlock(state, selection.focus.blockId);
    if (anchorBlock === null || focusBlock === null) return editor;
    if (
      selection.anchor.blockId !== selection.focus.blockId &&
      anchorBlock.parentId !== focusBlock.parentId
    ) {
      return editor;
    }
    const start = spanStart(state, selection);
    const deleteResult = deleteRange(state, selection);
    state = deleteResult.state;
    for (const id of deleteResult.dirtyIds) accumulatedDirtyIds.add(id);
    pos = createPosition(start.blockId, start.offset);
  }

  const lines = text.split("\n");
  const k = lines.length;
  // `String.prototype.split` always returns a non-empty array, so the first line
  // is always present (k >= 1).
  const firstLine = lines[0];
  if (firstLine === undefined) {
    throw new Error("handlePaste: text.split produced an empty array (invariant violation)");
  }

  // Insert the first line as text at the current position. (If L0 is empty,
  // skip; pos stays put — matching the legacy path.)
  if (firstLine.length > 0) {
    const r = insertText(state, pos, firstLine, {});
    state = r.state;
    for (const id of r.dirtyIds) accumulatedDirtyIds.add(id);
    pos = createPosition(pos.blockId, pos.offset + firstLine.length);
  }

  // Multi-line paste: split the boundary block ONCE, prepend the last line
  // to the freshly created suffix block, and bulk-insert any MIDDLE lines as
  // sibling blocks between the two — a CONSTANT number of `applyOperation`
  // calls regardless of line count (replacing the legacy O(k) per-line
  // split+insert chain — Smell B / #291).
  if (k > 1) {
    const block = getBlock(state, pos.blockId);
    // Match the legacy guard: a null-parent / null-inlineContent / missing
    // boundary block STOPS the multi-line path (cursor stays after L0).
    if (block !== null && block.inlineContent !== null && block.parentId !== null) {
      const sourceType = block.type;
      const sourceAttrs = block.attrs;
      const sourceId = block.id;

      // (a) Split B at pos: B keeps `prefix⊕L0`; a new next sibling N_last
      //     holds `suffix`. New block inherits B's type/attrs (split clones).
      const splitResult = splitBlockAtPosition(state, pos, productionAllocator);
      state = splitResult.state;
      for (const id of splitResult.dirtyIds) accumulatedDirtyIds.add(id);

      // N_last is the suffix block split created. Both arms below are
      // contractually IMPOSSIBLE — split never deletes the source block and
      // always rewires its nextSiblingId to the new block — so we throw rather
      // than silently dropping lines 1..k-1 (which would make a multi-line
      // paste appear to succeed while losing content).
      const afterSplit = getBlock(state, sourceId);
      if (afterSplit === null) {
        throw new Error(
          `handlePaste: source block "${sourceId}" disappeared after split (invariant violation)`,
        );
      }
      const lastNewBlockId = afterSplit.nextSiblingId;
      if (lastNewBlockId === null) {
        throw new Error(
          `handlePaste: split of "${sourceId}" produced no next sibling (invariant violation)`,
        );
      }
      // k > 1 here, so index k-1 is in [1, length-1] and the last line exists.
      const lastLine = lines[k - 1];
      if (lastLine === undefined) {
        throw new Error(
          `handlePaste: last line index ${k - 1} out of range (length ${lines.length})`,
        );
      }

      // (b) Prepend the last line to N_last (offset 0).
      if (lastLine.length > 0) {
        const r = insertText(
          state,
          createPosition(lastNewBlockId, 0),
          lastLine,
          {},
        );
        state = r.state;
        for (const id of r.dirtyIds) accumulatedDirtyIds.add(id);
      }

      // (c) Bulk-insert the MIDDLE lines L1…L_{k-2} between B and N_last in
      //     ONE transaction.
      if (k > 2) {
        const middleInits: SiblingBlockInit[] = [];
        for (let i = 1; i < k - 1; i++) {
          // i ranges over [1, k-2], all valid indices of `lines` (length k).
          const middleLine = lines[i];
          if (middleLine === undefined) {
            throw new Error(
              `handlePaste: middle line index ${i} out of range (length ${lines.length})`,
            );
          }
          middleInits.push({
            type: sourceType,
            attrs: sourceAttrs,
            inlineContent: lineToInlineContent(middleLine),
          });
        }
        const bulkResult = insertBlocksAfter(
          state,
          sourceId,
          middleInits,
          productionAllocator,
        );
        state = bulkResult.state;
        for (const id of bulkResult.dirtyIds) accumulatedDirtyIds.add(id);
      }

      // (d) Cursor: end of the last pasted line in N_last.
      pos = createPosition(lastNewBlockId, lastLine.length);
    }
  }

  // E-B / #141: chained ops accumulate dirtyIds manually. Use
  // state-equality check (T7 identity contract) for consistency with
  // other handlers — `state` remains === editor.state iff every chained
  // op was a no-op.
  if (state === editor.state) return editor;

  const newSelection = createSpan(pos, pos);
  editor.history.commit(
    { state, dirtyIds: accumulatedDirtyIds },
    { before: selection, after: newSelection },
  );
  return rebuildTrees(
    { ...editor, state, selection: newSelection },
    editor,
    config,
    accumulatedDirtyIds,
  );
}
