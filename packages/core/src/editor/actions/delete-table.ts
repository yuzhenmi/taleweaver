import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { resolveTableContext } from "../../state";
import { deleteWholeTable } from "./helpers/delete-whole-table";

/**
 * `DELETE_TABLE` handler. Removes the whole table the caret is in.
 *
 * No-op (same `editor` ref) when the caret is not inside a main-tree table.
 * Unlike the row/column ops this is SPAN-AGNOSTIC — deleting an entire table is
 * always safe (Google Docs allows it on merged-cell tables), so it is NOT gated
 * on `ctx.hasSpans`. Caret-after semantics: see `deleteWholeTable`.
 */
export function handleDeleteTable(editor: EditorState): Edit | null {
  const ctx = resolveTableContext(editor.document, editor.selection.focus.blockId);
  if (ctx === null) return null;
  return deleteWholeTable(editor, ctx.tableId);
}
