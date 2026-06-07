import type { EditorState, EditorConfig } from "../editor-state";
import { resolveTableContext, insertTableRow, productionAllocator } from "../../state";
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
