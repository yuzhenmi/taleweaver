import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { resolveTableContext, deleteTableColumn, deleteTableColumnSpanAware, getBlock, createPosition, createSpan } from "../../state";
import { deleteWholeTable } from "./helpers/delete-whole-table";

/**
 * `DELETE_TABLE_COLUMN` handler. Removes the caret's column.
 *
 * Gated on `ctx.ragged` ONLY (no-op outside any table or on a degenerate ragged
 * table); a WELL-FORMED SPANNED table (`ctx.spanned`) routes to the span-aware
 * `deleteTableColumnSpanAware` (a covering/originating colSpan shrinks, a
 * 1×1 in the deleted column is removed), a plain no-span table to the byte-identical
 * plain `deleteTableColumn`. When the caret's column is the LAST remaining column,
 * deleting it would empty the table, so this collapses to deleting the whole table
 * (Google Docs) via `deleteWholeTable`.
 *
 * Caret-after: same row, the adjacent column's cell. The span-aware path resolves
 * the target via the PRE-op occupancy grid (`occupancy[caretGridRow][targetGridCol]`'s
 * owner — the column-axis mirror of the row op's target); the no-span path uses the pre-op
 * `ctx` row. First paragraph read from the POST-op `result.state`. The op
 * rewrites `columnWidths` (when present) in the same transaction → one undo entry
 * (`"command"`).
 */
export function handleDeleteTableColumn(editor: EditorState): Edit | null {
  const ctx = resolveTableContext(editor.document, editor.selection.focus.blockId);
  if (ctx === null || ctx.ragged) return null;

  // The PRE-op occupancy grid — `resolveTableContext` already built it (for `ragged`).
  // A resolved main-tree table always has one; the guard is defensive (unreachable).
  // The column count must come from the grid: a row's cell count ≠ the column count
  // when spans exist (the row-axis analog `ctx.rowIds.length` has no column equivalent).
  const grid = ctx.grid;
  if (grid === null) return null;
  const columnCount = grid.columnCount;
  // Last remaining column → deleting it collapses the whole table.
  if (columnCount <= 1) {
    return deleteWholeTable(editor, ctx.tableId);
  }

  if (ctx.spanned) {
    // Span-aware: resolve the caret target from the PRE-op occupancy grid — the cell
    // in the caret's row at the column that takes the deleted column's place.
    const caretCell = grid.cells.find((c) => c.cellId === ctx.cellId);
    if (caretCell === undefined) return null;

    const result = deleteTableColumnSpanAware(editor.document, ctx);
    if (result.state === editor.document) return null;

    const targetGridCol = caretCell.gridCol < columnCount - 1 ? caretCell.gridCol + 1 : caretCell.gridCol - 1;
    const targetCellId = grid.occupancy[caretCell.gridRow]?.[targetGridCol] ?? null;
    const caretBlockId = targetCellId !== null ? getBlock(result.state, targetCellId)?.firstChildId ?? null : null;
    // Defensive POST-op guard: for a non-ragged spanned table the target cell always
    // survives the delete, so this is unreachable; if it ever fired we'd discard the
    // already-computed `result` rather than commit a caret-less state.
    if (caretBlockId === null) return null;

    const cursor = createPosition(caretBlockId, 0);
    const after = createSpan(cursor, cursor);
    return { change: { state: result.state, dirtyIds: result.dirtyIds }, selection: after };
  }

  // No-span path. Caret target: same row, next column's cell, else the
  // previous (pre-op ctx).
  // ctx.rowIndex is the validated caret row from resolveTableContext, so the row
  // is always present in the per-row cell grid.
  const row = ctx.cellIdsByRow[ctx.rowIndex];
  if (row === undefined) {
    throw new Error(
      `handleDeleteTableColumn: caret row ${ctx.rowIndex} out of range (rows ${ctx.cellIdsByRow.length})`,
    );
  }
  const targetCellId = row[ctx.colIndex + 1] ?? row[ctx.colIndex - 1] ?? null;

  const result = deleteTableColumn(editor.document, ctx);
  if (result.state === editor.document) return null;

  // Read the target cell's first paragraph from the POST-op state.
  const targetCell = targetCellId !== null ? getBlock(result.state, targetCellId) : null;
  const caretBlockId = targetCell?.firstChildId ?? null;
  if (caretBlockId === null) return null; // defensive: non-ragged colCount>1 always has a target

  const cursor = createPosition(caretBlockId, 0);
  const after = createSpan(cursor, cursor);
  return { change: { state: result.state, dirtyIds: result.dirtyIds }, selection: after };
}
