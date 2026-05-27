import type { EditorState, EditorConfig } from "../editor-state";
import { resolveBlock, productionAllocator, createPosition, createSpan, deleteRange, splitBlockAtPosition, inlineContentLength } from "../../state";
import type { BlockId } from "../../state";
import { isCollapsed } from "../../cursor/selection";
import { rebuildTrees } from "./helpers";
import { isCrossContextSelection, expandedSpanCollapsePoint } from "./selection-guards";

export function handleSplitNode(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  let current = editor;
  const { selection } = editor;

  // Accumulate dirtyIds across the optional delete + the required split.
  const accumulatedDirtyIds = new Set<BlockId>();

  if (!isCollapsed(selection)) {
    // C.2c §6: cross-CONTEXT selection refusal (see isCrossContextSelection).
    // The expanded-selection branch first deletes the span (deleteRange would
    // throw "no common ancestor" on a cross-tree span), so refuse before that.
    if (isCrossContextSelection(editor.state, selection)) return editor;
    // Deletable-span guard + collapse point (see expandedSpanCollapsePoint):
    // refuses an unresolvable or cross-parent span.
    const start = expandedSpanCollapsePoint(editor.state, selection);
    if (start === null) return editor;
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

  const splitResult = splitBlockAtPosition(
    current.state,
    pos,
    productionAllocator,
    newBlockInit,
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
