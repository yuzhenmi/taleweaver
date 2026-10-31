import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { resolveTableContext, insertTableRow, insertTableRowSpanAware, productionAllocator } from "../../state";
import type { ActionOf } from "../editor-action";

/**
 * `INSERT_TABLE_ROW` handler. Inserts a row above/below the caret's row.
 *
 * No-ops (returns the same `editor` reference) when the caret is not inside an
 * editable table — `resolveTableContext` returns null — OR the table is `ragged`
 * (the degenerate carve-out). A WELL-FORMED SPANNED table routes to the span-aware
 * op (`insertTableRowSpanAware`); a plain no-span table uses the byte-
 * identical plain `insertTableRow`.
 *
 * Selection is UNCHANGED: Google Docs keeps the cursor in its current cell on
 * insert-row, and the caret's paragraph still exists after the edit. One undo
 * entry (the op is a single transaction; classified `"command"`).
 */
export function handleInsertTableRow(
  editor: EditorState,
  { position }: ActionOf<"INSERT_TABLE_ROW">,
): Edit | null {
  const ctx = resolveTableContext(editor.document, editor.selection.focus.blockId);
  if (ctx === null || ctx.ragged) return null;

  const result = ctx.spanned
    ? insertTableRowSpanAware(editor.document, ctx, position, productionAllocator)
    : insertTableRow(editor.document, ctx, position, productionAllocator);
  if (result.document === editor.document) return null; // defensive no-op short-circuit

  return { change: { document: result.document, dirtyIds: result.dirtyIds } };
}
