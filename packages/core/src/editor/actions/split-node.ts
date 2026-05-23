import type { EditorState, EditorConfig } from "../editor-state";
import type { BlockId } from "../../state/block-id";
import { getBlock } from "../../state/state";
import { productionAllocator } from "../../state/block-id";
import { createPosition, createSpan } from "../../state/block-position";
import { spanStart } from "../../state/block-compare";
import { deleteRange } from "../../state/delete-range";
import { splitBlockAtPosition } from "../../state/split-block";
import { isCollapsed } from "../../cursor/selection";
import { rebuildTrees } from "./helpers";

export function handleSplitNode(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  let current = editor;
  const { selection } = editor;

  // Accumulate dirtyIds across the optional delete + the required split.
  const accumulatedDirtyIds = new Set<BlockId>();

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
  const block = getBlock(current.state, pos.blockId);
  if (block === null) return editor;

  // Split is only meaningful on leaf blocks under a non-null parent.
  if (block.inlineContent === null || block.parentId === null) {
    return current === editor ? editor : current;
  }

  const splitResult = splitBlockAtPosition(
    current.state,
    pos,
    productionAllocator,
  );
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

  const updatedOriginal = getBlock(splitResult.state, pos.blockId);
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
