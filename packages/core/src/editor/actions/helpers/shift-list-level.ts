import type { EditorState } from "../../editor-state";
import { getBlock, mergeBlockAttrs, iterateBlocksInSpan, positionsEqual } from "../../../state";
import type { State, BlockId } from "../../../state";
import type { Edit } from "../../edit";
import { listLevelOf } from "./list-level-of";

/** Google-Docs list nesting depth is 0–8 (level 0 = top of the list). */
export const MAX_LIST_LEVEL = 8;

/**
 * Change the `listLevel` of the target list-item(s) by `delta` (+1 for LIST_INDENT,
 * −1 for LIST_OUTDENT), clamped to [0, MAX_LIST_LEVEL].
 *
 * The FLAT list model: nesting is a per-item attribute, NOT tree surgery —
 * indent is a cheap `listLevel` edit. Mirrors `handleIndent`'s shape (multi-block
 * span, per-item no-op short-circuit, one change) but targets only
 * `list-item` leaves and edits `listLevel` instead of `marginInlineStart`. A
 * non-list-item in the selection is skipped — plain-paragraph indent uses the
 * INDENT/OUTDENT action instead. (Both backends' key maps route Tab / Shift+Tab
 * on a list-item to this action; outside a list Tab inserts a tab (`INSERT_TAB`)
 * and Shift+Tab is a no-op.)
 *
 * No-op (`null`):
 * collapsed caret not in a list-item; a range covering no list-items; or every
 * target already at the clamp boundary.
 */
export function shiftListLevel(editor: EditorState, delta: 1 | -1): Edit | null {
  const targetIds = targetListItemIds(editor);

  let state: State = editor.document;
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
    );
    if (result.state === state) continue;
    state = result.state;
    for (const id of result.dirtyIds) dirtyIds.add(id);
  }

  return state === editor.document ? null : { change: { state, dirtyIds } };
}

/**
 * The `list-item` block ids the level change applies to:
 *  - collapsed selection → the focus block (if it's a list-item);
 *  - range selection → every list-item the span covers.
 */
function targetListItemIds(editor: EditorState): BlockId[] {
  const { document: state, selection } = editor;

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
