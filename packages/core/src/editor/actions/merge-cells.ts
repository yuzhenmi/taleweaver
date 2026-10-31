import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { resolveTableContext, mergeCells, resolveCellRange, buildTableGrid, getBlock, createPosition, createSpan } from "../../state";

/**
 * `MERGE_CELLS` handler. Merges the cells spanned by the selection into one
 * spanned cell (the survivor at the range's top-left), via `resolveCellRange` →
 * `mergeCells`.
 *
 * No-op (same `editor` ref) when the caret is not inside a main-tree table, the
 * table is `ragged` (the degenerate carve-out, like `SPLIT_CELL`), or the selection
 * resolves to no cross-cell range / a single cell (`resolveCellRange` null, or
 * `mergeCells`'s own same-`Document` short-circuit).
 *
 * Caret-after: COLLAPSED at offset 0 of the survivor's first paragraph. The
 * survivor is the cell originating at `(minRow, minCol)`; its id survives the merge,
 * so its first paragraph is read from the POST-op state. One undo (`"command"`).
 */
export function handleMergeCells(editor: EditorState): Edit | null {
  const ctx = resolveTableContext(editor.document, editor.selection.focus.blockId);
  if (ctx === null || ctx.ragged) return null;

  const range = resolveCellRange(editor.document, editor.selection);
  if (range === null) return null;

  const result = mergeCells(editor.document, range);
  if (result.document === editor.document) return null; // single-cell range → nothing merged

  // Survivor = the cell originating at the range's top-left (pre-op grid); its id
  // is stable across the merge, so read its first paragraph from the post-op state.
  const grid = buildTableGrid(editor.document, range.tableId);
  const survivor = grid?.cells.find((c) => c.gridRow === range.minRow && c.gridCol === range.minCol) ?? null;
  const caretBlockId = survivor !== null ? getBlock(result.document, survivor.cellId)?.firstChildId ?? null : null;
  if (caretBlockId === null) return null; // defensive: a survivor always has a first paragraph

  const cursor = createPosition(caretBlockId, 0);
  const after = createSpan(cursor, cursor);
  return { change: { document: result.document, dirtyIds: result.dirtyIds }, selection: after };
}
