import type { EditorState, EditorConfig } from "../editor-state";
import { getBlock, mergeBlockAttrs, iterateBlocksInSpan, positionsEqual } from "../../state";
import type { State, BlockId } from "../../state";
import type { TextAlign } from "../../styles/style";
import { rebuildTrees } from "./helpers";

/**
 * `SET_TEXT_ALIGN` handler — sets the per-block `textAlign` attr on the target
 * LEAF block(s). The attr flows render → cascade → IFC, which honors it when
 * positioning each line, so the page reflows to the new alignment.
 *
 * Target selection:
 *  - Collapsed selection → the single focus block.
 *  - Range selection → every LEAF block the span covers, in document order.
 *    `iterateBlocksInSpan` yields ALL covered blocks INCLUDING containers
 *    (sections, lists); we FILTER to leaves (`block.inlineContent !== null`).
 *    Containers are never aligned (C-3) — Google Docs aligns paragraphs only;
 *    a section/list has no text of its own to align.
 *
 * Each target's attr is merged via `mergeBlockAttrs` (preserves the block's
 * other attrs). `mergeBlockAttrs` is no-op-safe: a block already carrying the
 * target alignment returns the SAME state reference, so we accumulate the
 * running state and dirty ids only when a write actually occurred.
 *
 * No-op (return the input `editor` unchanged, never calling `history.commit`):
 *  - No target leaf changed (the running state is still `editor.state`) — the
 *    T7 identity guard, mirroring `handleToggleSectionLandscape`. (Notably:
 *    every target already has this alignment.)
 *
 * Selection is UNCHANGED: alignment is a block-geometry change, not a caret
 * move.
 */
export function handleSetTextAlign(
  editor: EditorState,
  align: TextAlign,
  config: EditorConfig,
): EditorState {
  const targetIds = targetLeafBlockIds(editor);

  let state: State = editor.state;
  const dirtyIds = new Set<BlockId>();
  for (const blockId of targetIds) {
    // Defensive: skip a block that resolved into the target list but is now
    // missing (never expected — the ids come from the live state).
    if (getBlock(state, blockId) === null) continue;
    const result = mergeBlockAttrs(state, blockId, { textAlign: align }, config.attrRegistry);
    // No-op merge (block already has this alignment): same state ref → skip.
    if (result.state === state) continue;
    state = result.state;
    for (const id of result.dirtyIds) dirtyIds.add(id);
  }

  // T7 identity contract: nothing changed → return the input editor unchanged
  // (the editor module's "no change → same editor reference" invariant).
  // (`history.commit` is itself no-op-safe.)
  if (state === editor.state) return editor;

  editor.history.commit(
    { state, dirtyIds },
    { before: editor.selection, after: editor.selection },
  );
  return rebuildTrees(
    { ...editor, state },
    editor,
    config,
    dirtyIds,
  );
}

/**
 * The LEAF block ids the alignment applies to:
 *  - collapsed selection → the focus block (if it's a leaf);
 *  - range selection → every leaf the span covers (containers filtered out).
 *
 * A leaf is a block with `inlineContent !== null` (containers — sections,
 * lists, the document root — have `inlineContent === null` and route content
 * through `firstChildId`). Aligning a container is nonsensical: it owns no text.
 */
function targetLeafBlockIds(editor: EditorState): BlockId[] {
  const { state, selection } = editor;

  if (positionsEqual(selection.anchor, selection.focus)) {
    const focus = getBlock(state, selection.focus.blockId);
    if (focus === null || focus.inlineContent === null) return [];
    return [focus.id];
  }

  const ids: BlockId[] = [];
  for (const block of iterateBlocksInSpan(state, selection)) {
    if (block.inlineContent !== null) ids.push(block.id);
  }
  return ids;
}
