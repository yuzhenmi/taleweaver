import type { EditorState, EditorConfig } from "../editor-state";
import { getBlock, mergeBlockAttrs, iterateBlocksInSpan, positionsEqual } from "../../state";
import type { State, BlockId } from "../../state";
import { rebuildTrees } from "./helpers";
import { listLevelOf } from "./list-edits";

/** Google-Docs list nesting depth is 0–8 (level 0 = top of the list). */
export const MAX_LIST_LEVEL = 8;

/**
 * LIST_INDENT / LIST_OUTDENT — change the `listLevel` of the target list-item(s)
 * by `delta` (+1 to indent, −1 to outdent), clamped to [0, MAX_LIST_LEVEL].
 *
 * The FLAT list model (D4): nesting is a per-item attribute, NOT tree surgery —
 * indent is a cheap `listLevel` edit. Mirrors `handleIndent`'s shape (multi-block
 * span, per-item no-op short-circuit, single `history.commit`) but targets only
 * `list-item` leaves and edits `listLevel` instead of `marginInlineStart`. A
 * non-list-item in the selection is skipped — plain-paragraph indent uses the
 * INDENT/OUTDENT action instead. (Routing Tab / Shift+Tab on a list-item to
 * this action, vs INDENT on a plain paragraph, is wired up in a later task.)
 *
 * No-op (return the input `editor` unchanged, never calling `history.commit`):
 * collapsed caret not in a list-item; a range covering no list-items; or every
 * target already at the clamp boundary.
 */
export function handleListIndent(
  editor: EditorState,
  delta: number,
  config: EditorConfig,
): EditorState {
  const targetIds = targetListItemIds(editor);

  let state: State = editor.state;
  const dirtyIds = new Set<BlockId>();
  for (const blockId of targetIds) {
    const block = getBlock(state, blockId);
    if (block === null) continue;
    const current = listLevelOf(block);
    const next = Math.max(0, Math.min(MAX_LIST_LEVEL, current + delta));
    if (next === current) continue;
    // Level 0 clears the attr (undefined → mergeAttrs removes the key), so a
    // top-level item carries no redundant listLevel:0.
    const nextValue = next > 0 ? next : undefined;
    const result = mergeBlockAttrs(
      state,
      blockId,
      { listLevel: nextValue },
      config.attrRegistry,
    );
    if (result.state === state) continue;
    state = result.state;
    for (const id of result.dirtyIds) dirtyIds.add(id);
  }

  if (state === editor.state) return editor;

  editor.history.commit(
    { state, dirtyIds },
    { before: editor.selection, after: editor.selection },
  );
  return rebuildTrees({ ...editor, state }, editor, config, dirtyIds);
}

/**
 * The `list-item` block ids the level change applies to:
 *  - collapsed selection → the focus block (if it's a list-item);
 *  - range selection → every list-item the span covers.
 */
function targetListItemIds(editor: EditorState): BlockId[] {
  const { state, selection } = editor;

  if (positionsEqual(selection.anchor, selection.focus)) {
    const focus = getBlock(state, selection.focus.blockId);
    if (focus === null || focus.type !== "list-item") return [];
    return [focus.id];
  }

  const ids: BlockId[] = [];
  for (const block of iterateBlocksInSpan(state, selection)) {
    if (block.type === "list-item") ids.push(block.id);
  }
  return ids;
}
