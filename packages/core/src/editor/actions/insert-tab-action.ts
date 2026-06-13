import type { EditorState, EditorConfig } from "../editor-state";
import {
  insertTab,
  createPosition,
  createSpan,
  type BlockId,
} from "../../state";
import { rebuildTrees } from "./helpers";
import { prepareEmbedInsertPoint } from "./selection-guards";

/**
 * `INSERT_TAB` handler — splices the existing atomic `"tab"` embed at the caret.
 * Pressing Tab outside a list-item maps here (the keymap routes list-item Tab to
 * LIST_INDENT). A tab is a bodyless atomic inline embed; its position-dependent
 * advance is resolved by the IFC at layout time, not in state.
 *
 * **Non-collapsed selection** is REPLACED, not preserved: `prepareEmbedInsertPoint`
 * deletes the selected range first (folding its dirtyIds into the single commit so
 * delete+insert is one undo step) and returns the collapse point — matching
 * INSERT_TEXT / PASTE / INSERT_CROSS_REFERENCE / Google Docs. A cross-context /
 * cross-parent span is un-deletable → no-op. On success the tab occupies exactly
 * ONE position-offset unit, so the caret lands just AFTER it (`offset + 1`), ready
 * for continued typing.
 *
 * Unlike a text insert, each Tab is its OWN discrete undo step (`"command"`
 * coalescing in `coalesceKeyOf`) — Google Docs treats each tab as one undo unit.
 */
export function handleInsertTab(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  // Delete a non-collapsed selection first (Google Docs replaces the selection),
  // then splice the tab at the collapse point. A cross-context / cross-parent
  // expanded selection is un-deletable → no-op.
  const prep = prepareEmbedInsertPoint(editor.state, editor.selection);
  if (!prep.ok) return editor;

  const result = insertTab(prep.state, prep.position);
  // Identity invariant: nothing changed (no delete AND a no-op insert) → return
  // the editor unchanged so the "no change → same reference" contract holds.
  if (result.state === prep.state && prep.dirtyIds.size === 0) return editor;
  const dirtyIds = new Set<BlockId>(prep.dirtyIds);
  for (const id of result.dirtyIds) dirtyIds.add(id);

  // The tab is one offset unit; place a collapsed caret just after it.
  const cursor = createPosition(prep.position.blockId, prep.position.offset + 1);
  const selectionAfter = createSpan(cursor, cursor);

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
