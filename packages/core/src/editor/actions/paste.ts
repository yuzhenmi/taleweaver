import type { EditorState, EditorConfig } from "../editor-state";
import type { State } from "../../state/state";
import type { BlockId } from "../../state/block-id";
import { getBlock } from "../../state/state";
import { productionAllocator } from "../../state/block-id";
import { createPosition, createSpan, type Position } from "../../state/block-position";
import { spanStart } from "../../state/block-compare";
import { deleteRange } from "../../state/delete-range";
import { insertText } from "../../state/insert-text";
import { splitBlockAtPosition } from "../../state/split-block";
import { insertBlocksAfter, type SiblingBlockInit } from "../../state/insert-blocks-after";
import type { InlineContent } from "../../state/inline-content";
import { isCollapsed } from "../../cursor/selection";
import { rebuildTrees } from "./helpers";

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

  // Collapse selection (delete the existing range first).
  let state: State = editor.state;
  let pos: Position = editor.selection.focus;
  const { selection } = editor;

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

  // Insert the first line as text at the current position. (If L0 is empty,
  // skip; pos stays put — matching the legacy path.)
  if (lines[0].length > 0) {
    const r = insertText(state, pos, lines[0], {});
    state = r.state;
    for (const id of r.dirtyIds) accumulatedDirtyIds.add(id);
    pos = createPosition(pos.blockId, pos.offset + lines[0].length);
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
      const lastLine = lines[k - 1];

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
          middleInits.push({
            type: sourceType,
            attrs: sourceAttrs,
            inlineContent: lineToInlineContent(lines[i]),
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
