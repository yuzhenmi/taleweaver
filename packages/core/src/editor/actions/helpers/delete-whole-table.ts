import type { EditorState } from "../../editor-state";
import type { Edit } from "../../edit";
import type { BlockId } from "../../../state";
import { deleteTable, getBlock, createPosition, createSpan } from "../../../state";

/**
 * Shared "delete the whole table" path used by `DELETE_TABLE` and the last-row /
 * last-column collapse, via `deleteTable`: the caret lands at the
 * start of the table's next sibling (a paragraph always follows a table —
 * invariant I), or the previous one. Span-agnostic (deleting a whole table is always safe). One
 * undo entry. No-op (same `editor` ref) only when the table block is missing.
 */
export function deleteWholeTable(
  editor: EditorState,
  tableId: BlockId,
): Edit | null {
  const table = getBlock(editor.document, tableId);
  if (table === null) return null; // defensive
  const siblingId = table.nextSiblingId ?? table.prevSiblingId; // pre-op; survives the delete

  const result = deleteTable(editor.document, tableId);
  if (result.document === editor.document) return null;

  const caretBlockId = siblingId;
  if (caretBlockId === null) return null; // unreachable: a paragraph follows every table (invariant I)

  const cursor = createPosition(caretBlockId, 0);
  const after = createSpan(cursor, cursor);
  return { change: { document: result.document, dirtyIds: result.dirtyIds }, selection: after };
}
