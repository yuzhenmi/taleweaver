import type { EditorState, EditorConfig } from "../editor-state";
import {
  createTable,
  productionAllocator,
  selectionContextOf,
  createSpan,
} from "../../state";
import type { BlockId } from "../../state";
import { rebuildTrees } from "./helpers";
import { prepareEmbedInsertPoint } from "./selection-guards";

/**
 * `INSERT_TABLE` handler — the keystone create-entry-point for the tables
 * subsystem (Google Docs Insert ▸ Table). Inserts a fresh `rows × cols` table at
 * the caret's block boundary and lands the caret in cell (0,0) so the user can
 * type immediately. One undo entry.
 *
 * Insertion semantics live in the `createTable` Layer-3 op (caret at block START
 * → table before; END → after; MID → split the block, table between halves).
 *
 * **Body context (v1: main document body only).** Tables are refused while the
 * caret is inside a header / footer / footnote body — those resolve to a
 * non-`rootId` context (mirrors INSERT_FOOTNOTE). Nested tables (caret in a cell)
 * and tables in template/embed bodies are a deliberate v2; v1 refuses, it does
 * not half-insert.
 *
 * **Non-collapsed selection** is REPLACED, not preserved: `prepareEmbedInsertPoint`
 * deletes the selected range first (folding its dirtyIds into the single commit
 * so delete+insert is one undo step) and returns the collapse point where the
 * table is created — matching INSERT_TEXT / INSERT_FOOTNOTE / Google Docs. A
 * cross-context / cross-parent span is un-deletable → no-op.
 *
 * A degenerate `rows < 1` / `cols < 1` request is a no-op (the op treats it as a
 * precondition violation; the UI never sends it).
 */
export function handleInsertTable(
  editor: EditorState,
  rows: number,
  cols: number,
  config: EditorConfig,
): EditorState {
  if (rows < 1 || cols < 1) return editor;

  // Refuse a table inside a footnote / header / footer body — only main document
  // body text (which resolves to `state.rootId`) may host a table in v1. Read
  // `focus` (the active end), matching INSERT_FOOTNOTE.
  if (selectionContextOf(editor.state, editor.selection.focus.blockId) !== editor.state.rootId) {
    return editor;
  }

  // Delete a non-collapsed selection first, then create the table at the collapse
  // point. A cross-context / cross-parent expanded selection is un-deletable → no-op.
  const prep = prepareEmbedInsertPoint(editor.state, editor.selection);
  if (!prep.ok) return editor;

  // `createTable` always inserts (never a no-op), so the commit always fires.
  const result = createTable(prep.state, prep.position, rows, cols, productionAllocator);

  const dirtyIds = new Set<BlockId>(prep.dirtyIds);
  for (const id of result.dirtyIds) dirtyIds.add(id);

  const selectionAfter = createSpan(result.caretInto, result.caretInto);
  editor.history.commit(
    { state: result.state, dirtyIds },
    { before: editor.selection, after: selectionAfter },
  );
  return rebuildTrees(
    { ...editor, state: result.state, selection: selectionAfter },
    editor,
    config,
    dirtyIds,
  );
}
