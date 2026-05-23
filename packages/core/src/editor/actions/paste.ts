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
import { isCollapsed } from "../../cursor/selection";
import { rebuildTrees } from "./helpers";

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

  // Insert first line as text at the current position.
  if (lines[0].length > 0) {
    const r = insertText(state, pos, lines[0], {});
    state = r.state;
    for (const id of r.dirtyIds) accumulatedDirtyIds.add(id);
    pos = createPosition(pos.blockId, pos.offset + lines[0].length);
  }

  // Subsequent lines: split block, then insert text into the new block.
  for (let i = 1; i < lines.length; i++) {
    const block = getBlock(state, pos.blockId);
    if (block === null || block.inlineContent === null || block.parentId === null) {
      break;
    }
    const splitResult = splitBlockAtPosition(state, pos, productionAllocator);
    state = splitResult.state;
    for (const id of splitResult.dirtyIds) accumulatedDirtyIds.add(id);
    const updatedOriginal = getBlock(state, pos.blockId);
    if (updatedOriginal === null) break;
    const newBlockId = updatedOriginal.nextSiblingId;
    if (newBlockId === null) break;
    pos = createPosition(newBlockId, 0);

    if (lines[i].length > 0) {
      const r = insertText(state, pos, lines[i], {});
      state = r.state;
      for (const id of r.dirtyIds) accumulatedDirtyIds.add(id);
      pos = createPosition(pos.blockId, pos.offset + lines[i].length);
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
