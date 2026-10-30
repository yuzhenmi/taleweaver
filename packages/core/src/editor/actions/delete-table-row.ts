import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { resolveTableContext, deleteTableRow, deleteTableRowSpanAware, getBlock, createPosition, createSpan } from "../../state";
import { deleteWholeTable } from "./helpers/delete-whole-table";

/**
 * `DELETE_TABLE_ROW` handler. Removes the caret's row.
 *
 * No-op (same `editor` ref) when the caret is not inside an editable table OR the
 * table is `ragged` (the degenerate carve-out). When the caret's row is the LAST
 * remaining row, deleting it would empty the table, so this collapses to deleting
 * the whole table (Google Docs) via `deleteWholeTable`. Otherwise a WELL-FORMED
 * SPANNED table routes to `deleteTableRowSpanAware` (covering spans shrink,
 * an originating span re-homes one row down), a plain no-span table to
 * `deleteTableRow` (removes the row + re-derives `headerRowCount` in one tx).
 *
 * Caret-after (`rowCount > 1`): the cell in the caret's column that takes the
 * deleted row's place — the next row, or the previous row when the deleted row was
 * last. For the span-aware path this is resolved from the PRE-op occupancy grid;
 * for the no-span path from `ctx.cellIdsByRow`. The target cell id survives the
 * delete; its first paragraph is read from the POST-op state. One undo (`"command"`).
 */
export function handleDeleteTableRow(editor: EditorState): Edit | null {
  const ctx = resolveTableContext(editor.state, editor.selection.focus.blockId);
  if (ctx === null || ctx.ragged) return null;

  // Last remaining row → deleting it collapses the whole table.
  if (ctx.rowIds.length <= 1) {
    return deleteWholeTable(editor, ctx.tableId);
  }

  if (ctx.spanned) {
    // Span-aware: resolve the caret target from the PRE-op occupancy grid —
    // the cell in the caret's column at the row that takes the deleted row's place.
    // `ctx.grid` is the grid `resolveTableContext` already built (for `ragged`); reuse
    // it rather than re-scanning the tree with a second `buildTableGrid`.
    const grid = ctx.grid;
    const caretCell = grid === null ? undefined : grid.cells.find((c) => c.cellId === ctx.cellId);
    if (grid === null || caretCell === undefined) return null;

    const result = deleteTableRowSpanAware(editor.state, ctx);
    if (result.state === editor.state) return null;

    const rowCount = grid.occupancy.length;
    const targetGridRow = caretCell.gridRow < rowCount - 1 ? caretCell.gridRow + 1 : caretCell.gridRow - 1;
    const targetCellId = grid.occupancy[targetGridRow]?.[caretCell.gridCol] ?? null;
    const caretBlockId = targetCellId !== null ? getBlock(result.state, targetCellId)?.firstChildId ?? null : null;
    // Defensive POST-op guard: for a non-ragged spanned table the target cell always
    // survives the delete, so this is unreachable; if it ever fired we'd discard the
    // already-computed `result` rather than commit a caret-less state.
    if (caretBlockId === null) return null;

    const cursor = createPosition(caretBlockId, 0);
    const after = createSpan(cursor, cursor);
    return { change: { state: result.state, dirtyIds: result.dirtyIds }, selection: after };
  }

  // No-span path. Caret target: same column in the next row, else
  // the previous (pre-op ctx).
  const targetRow = ctx.cellIdsByRow[ctx.rowIndex + 1] ?? ctx.cellIdsByRow[ctx.rowIndex - 1];
  const targetCellId = targetRow?.[ctx.colIndex] ?? null;

  // The plain delete composes `removeBlock` + a `headerRowCount` re-derive in
  // ONE transaction, so deleting a header row keeps the count valid (one undo entry).
  const result = deleteTableRow(editor.state, ctx);
  if (result.state === editor.state) return null;

  // Read the target cell's first paragraph from the POST-op state.
  const targetCell = targetCellId !== null ? getBlock(result.state, targetCellId) : null;
  const caretBlockId = targetCell?.firstChildId ?? null;
  if (caretBlockId === null) return null; // defensive: non-ragged rowCount>1 always has a target

  const cursor = createPosition(caretBlockId, 0);
  const after = createSpan(cursor, cursor);
  return { change: { state: result.state, dirtyIds: result.dirtyIds }, selection: after };
}
