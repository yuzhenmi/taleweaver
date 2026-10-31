import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { resolveTableContext, insertTableColumn, insertTableColumnSpanAware, productionAllocator } from "../../state";
import type { ActionOf } from "../editor-action";

/**
 * `INSERT_TABLE_COLUMN` handler. Inserts a column left/right of the caret's column.
 *
 * No-ops (same `editor` ref) when the caret is not inside an editable table OR the
 * table is `ragged` (the degenerate carve-out). A WELL-FORMED SPANNED table routes
 * to the span-aware `insertTableColumnSpanAware` (a crossing colSpan grows,
 * new cells only in uncovered rows); a plain no-span table uses the byte-identical
 * plain `insertTableColumn`. Both rewrite `columnWidths` (when present) in the same
 * transaction → one undo reverts cells + widths. Selection is UNCHANGED (Google
 * Docs keeps the cursor in its current cell on insert-column).
 */
export function handleInsertTableColumn(
  editor: EditorState,
  { position }: ActionOf<"INSERT_TABLE_COLUMN">,
): Edit | null {
  const ctx = resolveTableContext(editor.document, editor.selection.focus.blockId);
  if (ctx === null || ctx.ragged) return null;

  const result = ctx.spanned
    ? insertTableColumnSpanAware(editor.document, ctx, position, productionAllocator)
    : insertTableColumn(editor.document, ctx, position, productionAllocator);
  if (result.document === editor.document) return null; // defensive no-op short-circuit

  return { change: { document: result.document, dirtyIds: result.dirtyIds } };
}
