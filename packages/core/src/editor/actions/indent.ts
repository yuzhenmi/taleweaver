import type { EditorState, EditorConfig } from "../editor-state";
import { getBlock, mergeBlockAttrs, iterateBlocksInSpan, positionsEqual } from "../../state";
import type { State, BlockId } from "../../state";
import { rebuildTrees } from "./helpers";

/**
 * One indent step, in px (≈ 0.5in — Google Docs' default increase/decrease-
 * indent increment). Each `INDENT` adds one step to a block's
 * `marginInlineStart`; each `OUTDENT` subtracts one (clamped at 0).
 */
export const INDENT_STEP = 48;

/**
 * `INDENT` / `OUTDENT` handler — steps the per-block `marginInlineStart` attr
 * on the target LEAF block(s) by `delta` (`+INDENT_STEP` to indent,
 * `-INDENT_STEP` to outdent). Mirrors `handleSetLineSpacing` (indent is a
 * paragraph property, like alignment / line spacing): the attr flows render →
 * layout. The component synthesizes `marginInlineStart` onto its ElementBox
 * style (see `leaf-style-attrs.ts`), and the BFC insets the in-flow block by
 * that margin and narrows its content width, so the page reflows.
 *
 * Target selection (the `handleSetLineSpacing` model):
 *  - Collapsed selection → the single focus block.
 *  - Range selection → every LEAF block the span covers, in document order.
 *    `iterateBlocksInSpan` yields ALL covered blocks INCLUDING containers
 *    (sections, lists); we FILTER to leaves (`block.inlineContent !== null`).
 *    Containers are never indented — Google Docs indents paragraphs only.
 *
 * Read-modify-write PER BLOCK: each target's NEW margin is `max(0, current +
 * delta)`, where `current` is the block's existing `marginInlineStart` if it's
 * a finite number else 0. Two blocks at different indents therefore each step
 * by exactly one increment from their OWN start (not snapped to a shared
 * value). Outdenting to 0 merges `undefined`, which (per `mergeAttrs`) REMOVES
 * the key entirely — the block then renders identically to a never-indented
 * one. Each merge is no-op-safe (`mergeBlockAttrs` returns the SAME state ref
 * when the value is unchanged), so we accumulate the running state and dirty
 * ids only when a write actually occurred.
 *
 * No-op (return the input `editor` unchanged, never calling `history.commit`):
 *  - No target leaf changed (the running state is still `editor.state`) — the
 *    T7 identity guard. (Notably: OUTDENT when every target is already at 0.)
 *
 * Selection is UNCHANGED: indent is a block-geometry change, not a caret move.
 */
export function handleIndent(
  editor: EditorState,
  delta: number,
  config: EditorConfig,
): EditorState {
  const targetIds = targetLeafBlockIds(editor);

  let state: State = editor.state;
  const dirtyIds = new Set<BlockId>();
  for (const blockId of targetIds) {
    const block = getBlock(state, blockId);
    // Defensive: skip a block that resolved into the target list but is now
    // missing (never expected — the ids come from the live state).
    if (block === null) continue;
    const current =
      typeof block.attrs.marginInlineStart === "number" &&
      Number.isFinite(block.attrs.marginInlineStart)
        ? block.attrs.marginInlineStart
        : 0;
    const next = Math.max(0, current + delta);
    // Outdent to 0 clears the attr (undefined → mergeAttrs removes the key).
    const nextValue = next > 0 ? next : undefined;
    const result = mergeBlockAttrs(
      state,
      blockId,
      { marginInlineStart: nextValue },
      config.attrRegistry,
    );
    // No-op merge (value unchanged): same state ref → skip.
    if (result.state === state) continue;
    state = result.state;
    for (const id of result.dirtyIds) dirtyIds.add(id);
  }

  // T7 identity contract: nothing changed → return the input editor unchanged.
  // (`history.commit` is itself no-op-safe.)
  if (state === editor.state) return editor;

  editor.history.commit(
    { state, dirtyIds },
    { before: editor.selection, after: editor.selection },
  );
  return rebuildTrees({ ...editor, state }, editor, config, dirtyIds);
}

/**
 * The LEAF block ids the indent applies to:
 *  - collapsed selection → the focus block (if it's a leaf);
 *  - range selection → every leaf the span covers (containers filtered out).
 *
 * A leaf is a block with `inlineContent !== null` (containers — sections,
 * lists, the document root — have `inlineContent === null`). Indenting a
 * container is nonsensical: it owns no text. Mirrors `handleSetLineSpacing`.
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
