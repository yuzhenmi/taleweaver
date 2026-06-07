import type { EditorState, EditorConfig } from "../editor-state";
import type { BlockId } from "../../state";
import {
  resolveTableContext,
  insertTableRow,
  insertTableColumn,
  deleteTableWithReplacement,
  removeBlock,
  getBlock,
  createPosition,
  createSpan,
  productionAllocator,
} from "../../state";
import type { RowPosition, ColumnPosition } from "../../state";
import { rebuildTrees } from "./helpers";

/**
 * `INSERT_TABLE_ROW` handler (P15a). Inserts a row above/below the caret's row.
 *
 * No-ops (returns the same `editor` reference) when the caret is not inside an
 * editable table — `resolveTableContext` returns null — OR the table has any
 * span / ragged rows (`ctx.hasSpans`, the P15a → P15b boundary).
 *
 * Selection is UNCHANGED: Google Docs keeps the cursor in its current cell on
 * insert-row, and the caret's paragraph still exists after the edit. One undo
 * entry (the op is a single transaction; classified `"command"`).
 */
export function handleInsertTableRow(
  editor: EditorState,
  position: RowPosition,
  config: EditorConfig,
): EditorState {
  const ctx = resolveTableContext(editor.state, editor.selection.focus.blockId);
  if (ctx === null || ctx.hasSpans) return editor;

  const result = insertTableRow(editor.state, ctx, position, productionAllocator);
  if (result.state === editor.state) return editor; // defensive no-op short-circuit

  editor.history.commit(
    { state: result.state, dirtyIds: result.dirtyIds },
    { before: editor.selection, after: editor.selection },
  );
  return rebuildTrees(
    { ...editor, state: result.state },
    editor,
    config,
    result.dirtyIds,
  );
}

/**
 * `INSERT_TABLE_COLUMN` handler (P15a). Inserts a column (one empty cell per row)
 * left/right of the caret's column, via `resolveTableContext` → `insertTableColumn`.
 *
 * No-ops (same `editor` ref) when the caret is not inside an editable table OR
 * the table `hasSpans` (the P15a → P15b boundary). Selection is UNCHANGED:
 * Google Docs keeps the cursor in its current cell on insert-column, and the
 * caret's paragraph still exists after the edit. The op rewrites `columnWidths`
 * (when present) in the same transaction → one undo entry reverts both.
 */
export function handleInsertTableColumn(
  editor: EditorState,
  position: ColumnPosition,
  config: EditorConfig,
): EditorState {
  const ctx = resolveTableContext(editor.state, editor.selection.focus.blockId);
  if (ctx === null || ctx.hasSpans) return editor;

  const result = insertTableColumn(editor.state, ctx, position, productionAllocator);
  if (result.state === editor.state) return editor; // defensive no-op short-circuit

  editor.history.commit(
    { state: result.state, dirtyIds: result.dirtyIds },
    { before: editor.selection, after: editor.selection },
  );
  return rebuildTrees(
    { ...editor, state: result.state },
    editor,
    config,
    result.dirtyIds,
  );
}

/**
 * Shared "delete the whole table" path used by `DELETE_TABLE` and the last-row /
 * last-column collapse. Via `deleteTableWithReplacement`: when the table is the
 * body's sole child, a fresh empty paragraph replaces it → caret at its start;
 * otherwise caret lands at the start of the table's next sibling (or previous,
 * if it was last). Span-agnostic (deleting a whole table is always safe). One
 * undo entry. No-op (same `editor` ref) only when the table block is missing.
 */
function deleteWholeTable(
  editor: EditorState,
  tableId: BlockId,
  config: EditorConfig,
): EditorState {
  const table = getBlock(editor.state, tableId);
  if (table === null) return editor; // defensive
  const siblingId = table.nextSiblingId ?? table.prevSiblingId; // pre-op; survives the delete

  const result = deleteTableWithReplacement(editor.state, tableId, productionAllocator);
  if (result.state === editor.state) return editor;

  const caretBlockId = result.newParagraphId ?? siblingId;
  if (caretBlockId === null) return editor; // unreachable: sole-child → paragraph; else a sibling exists

  const cursor = createPosition(caretBlockId, 0);
  const after = createSpan(cursor, cursor);
  editor.history.commit(
    { state: result.state, dirtyIds: result.dirtyIds },
    { before: editor.selection, after },
  );
  return rebuildTrees({ ...editor, state: result.state, selection: after }, editor, config, result.dirtyIds);
}

/**
 * `DELETE_TABLE` handler (P15a). Removes the whole table the caret is in.
 *
 * No-op (same `editor` ref) when the caret is not inside a main-tree table.
 * Unlike the row/column ops this is SPAN-AGNOSTIC — deleting an entire table is
 * always safe (Google Docs allows it on merged-cell tables), so it is NOT gated
 * on `ctx.hasSpans`. Caret-after semantics: see `deleteWholeTable`.
 */
export function handleDeleteTable(editor: EditorState, config: EditorConfig): EditorState {
  const ctx = resolveTableContext(editor.state, editor.selection.focus.blockId);
  if (ctx === null) return editor;
  return deleteWholeTable(editor, ctx.tableId, config);
}

/**
 * `DELETE_TABLE_ROW` handler (P15a). Removes the caret's row.
 *
 * No-op (same `editor` ref) when the caret is not inside an editable table
 * (`resolveTableContext` null) OR the table `hasSpans` (the P15a → P15b
 * boundary). When the caret's row is the LAST remaining row, deleting it would
 * empty the table, so this collapses to deleting the whole table (Google Docs)
 * via `deleteWholeTable`.
 *
 * Caret-after (`rowCount > 1`): same column in the next row, else the previous
 * row (when the deleted row was last). The target cell id is resolved from the
 * PRE-op `ctx` (surviving cell ids stay valid post-op); its first paragraph is
 * read from the POST-op `result.state` (I4). One undo entry (`"command"`).
 */
export function handleDeleteTableRow(editor: EditorState, config: EditorConfig): EditorState {
  const ctx = resolveTableContext(editor.state, editor.selection.focus.blockId);
  if (ctx === null || ctx.hasSpans) return editor;

  // Last remaining row → deleting it collapses the whole table.
  if (ctx.rowIds.length <= 1) {
    return deleteWholeTable(editor, ctx.tableId, config);
  }

  // Caret target: same column in the next row, else the previous (pre-op ctx).
  const targetRow = ctx.cellIdsByRow[ctx.rowIndex + 1] ?? ctx.cellIdsByRow[ctx.rowIndex - 1];
  const targetCellId = targetRow?.[ctx.colIndex] ?? null;

  const result = removeBlock(editor.state, ctx.rowId);
  if (result.state === editor.state) return editor;

  // Read the target cell's first paragraph from the POST-op state (I4).
  const targetCell = targetCellId !== null ? getBlock(result.state, targetCellId) : null;
  const caretBlockId = targetCell?.firstChildId ?? null;
  if (caretBlockId === null) return editor; // defensive: non-ragged rowCount>1 always has a target

  const cursor = createPosition(caretBlockId, 0);
  const after = createSpan(cursor, cursor);
  editor.history.commit(
    { state: result.state, dirtyIds: result.dirtyIds },
    { before: editor.selection, after },
  );
  return rebuildTrees({ ...editor, state: result.state, selection: after }, editor, config, result.dirtyIds);
}
