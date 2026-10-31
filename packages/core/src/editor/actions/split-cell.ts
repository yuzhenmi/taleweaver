import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { resolveTableContext, splitCell, productionAllocator } from "../../state";

/**
 * `SPLIT_CELL` handler. Unmerges the caret's merged cell into 1×1 cells.
 *
 * No-op (same `editor` ref) when the caret is not inside a main-tree table
 * (`resolveTableContext` null) OR the table is `ragged` (a degenerate shape the
 * span-aware ops leave gated — the ragged carve-out wins even over a span).
 * Unlike the no-span row/column ops this is NOT gated on `ctx.hasSpans`: split only
 * makes sense ON a spanned table, and `splitCell` itself no-ops (same `Document` ref)
 * when the caret cell is a plain 1×1, so a spanned-table-but-caret-on-a-1×1-cell
 * is a clean no-op too.
 *
 * Selection is UNCHANGED (Google Docs keeps the caret in the surviving top-left
 * cell, whose paragraph still exists after the unmerge). One undo entry (the op
 * is a single transaction; classified `"command"`).
 */
export function handleSplitCell(editor: EditorState): Edit | null {
  const ctx = resolveTableContext(editor.document, editor.selection.focus.blockId);
  if (ctx === null || ctx.ragged) return null;

  const result = splitCell(editor.document, ctx, productionAllocator);
  if (result.document === editor.document) return null; // caret cell is not a real span

  return { change: { document: result.document, dirtyIds: result.dirtyIds } };
}
