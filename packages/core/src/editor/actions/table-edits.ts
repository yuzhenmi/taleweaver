import type { EditorState, EditorConfig } from "../editor-state";
import {
  resolveTableContext,
  insertTableRow,
  deleteTableWithReplacement,
  getBlock,
  createPosition,
  createSpan,
  productionAllocator,
} from "../../state";
import type { RowPosition } from "../../state";
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
 * `DELETE_TABLE` handler (P15a). Removes the whole table the caret is in.
 *
 * No-op (same `editor` ref) when the caret is not inside a main-tree table.
 * Unlike the row/column ops this is SPAN-AGNOSTIC — deleting an entire table is
 * always safe (Google Docs allows it on merged-cell tables), so it is NOT gated
 * on `ctx.hasSpans`.
 *
 * Caret-after: when the table was the body's sole child, `deleteTableWithReplacement`
 * leaves a fresh empty paragraph → caret at its start. Otherwise the caret lands
 * at the start of the table's next sibling (or previous, if it was last). One undo
 * entry (`"command"`).
 */
export function handleDeleteTable(editor: EditorState, config: EditorConfig): EditorState {
  const ctx = resolveTableContext(editor.state, editor.selection.focus.blockId);
  if (ctx === null) return editor;

  const table = getBlock(editor.state, ctx.tableId);
  if (table === null) return editor; // defensive
  const siblingId = table.nextSiblingId ?? table.prevSiblingId; // pre-op; survives the delete

  const result = deleteTableWithReplacement(editor.state, ctx.tableId, productionAllocator);
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
