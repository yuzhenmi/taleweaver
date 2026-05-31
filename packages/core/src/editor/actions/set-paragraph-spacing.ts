import type { EditorState, EditorConfig } from "../editor-state";
import { getBlock, mergeBlockAttrs, iterateBlocksInSpan, positionsEqual } from "../../state";
import type { State, BlockId } from "../../state";
import { rebuildTrees } from "./helpers";

/**
 * `SET_PARAGRAPH_SPACING` handler — sets the per-block vertical-margin attr
 * (Google Docs "Add space before / after paragraph") on the target LEAF
 * block(s). The `edge` selects which margin:
 *  - `"before"` → `marginBlockStart` (space ABOVE the paragraph);
 *  - `"after"`  → `marginBlockEnd`  (space BELOW the paragraph).
 *
 * The attr flows render → cascade → BFC: the component synthesizes the margin
 * onto its ElementBox style (see `leaf-style-attrs.ts`), and the BFC applies
 * in-flow blocks' `marginBlockStart`/`End` WITH CSS margin collapsing
 * (`bfc.ts`), so the page reflows. Because adjacent block margins COLLAPSE, the
 * realized gap between two paragraphs is `max(prevAfter, nextBefore)`, not their
 * sum (the integration geometry test proves this).
 *
 * Target selection (the exact `handleSetLineSpacing` / `handleIndent` model —
 * paragraph spacing is a paragraph property, like alignment / line spacing /
 * indent):
 *  - Collapsed selection → the single focus block.
 *  - Range selection → every LEAF block the span covers, in document order.
 *    `iterateBlocksInSpan` yields ALL covered blocks INCLUDING containers
 *    (sections, lists); we FILTER to leaves (`block.inlineContent !== null`).
 *    Containers are never spaced — Google Docs spaces paragraphs only; a
 *    section/list has no text of its own.
 *
 * Value mapping (per target):
 *  - `value` a finite `>= 0` number → set the edge's margin to that px value.
 *    `0` is VALID and explicit — a user may set "0 space" to OVERRIDE the
 *    component's default em margin (e.g. paragraph's 0.5em `marginBlockEnd`).
 *  - `value === null` (or a negative number) → CLEAR: merge `undefined`, which
 *    (per `mergeAttrs`) removes the key, reverting to the component default.
 *
 * Each merge is no-op-safe (`mergeBlockAttrs` returns the SAME state ref when
 * the value is unchanged), so we accumulate the running state and dirty ids only
 * when a write actually occurred.
 *
 * No-op (return the input `editor` unchanged, never calling `history.commit`):
 *  - No target leaf changed (the running state is still `editor.state`) — the
 *    T7 identity guard.
 *
 * Selection is UNCHANGED: paragraph spacing is a block-geometry change, not a
 * caret move.
 */
export function handleSetParagraphSpacing(
  editor: EditorState,
  edge: "before" | "after",
  value: number | null,
  config: EditorConfig,
): EditorState {
  const attrKey = edge === "before" ? "marginBlockStart" : "marginBlockEnd";
  // null OR a negative value clears (reverts to the component default); a finite
  // `>= 0` (including 0, an explicit override) is set.
  const nextValue = value !== null && value >= 0 ? value : undefined;

  const targetIds = targetLeafBlockIds(editor);

  let state: State = editor.state;
  const dirtyIds = new Set<BlockId>();
  for (const blockId of targetIds) {
    // Defensive: skip a block that resolved into the target list but is now
    // missing (never expected — the ids come from the live state).
    if (getBlock(state, blockId) === null) continue;
    const result = mergeBlockAttrs(
      state,
      blockId,
      { [attrKey]: nextValue },
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
 * The LEAF block ids the spacing applies to:
 *  - collapsed selection → the focus block (if it's a leaf);
 *  - range selection → every leaf the span covers (containers filtered out).
 *
 * A leaf is a block with `inlineContent !== null` (containers — sections,
 * lists, the document root — have `inlineContent === null`). Spacing a
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
