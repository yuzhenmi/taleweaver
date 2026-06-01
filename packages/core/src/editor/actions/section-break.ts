import type { EditorState, EditorConfig } from "../editor-state";
import { getBlock, productionAllocator, createPosition, createSpan, applySectionBreak } from "../../state";
import { rebuildTrees } from "./helpers";

/**
 * `SECTION_BREAK` handler — wires the Layer-3 `applySectionBreak` op into
 * the editor. The break splits the document root's children into FLAT
 * `section` blocks at the cursor's boundary block (the doc-root child
 * at/under which the focus sits), all in one transaction. The cursor
 * collapses to the first leaf of the boundary subtree.
 *
 * No-op contract (Decision 5 / T7): breaking at the container's first
 * child would create an empty leading section. `applySectionBreak` returns
 * the input `state` reference unchanged in that case; this handler relies on
 * the T7 identity check (`result.state === editor.state`) to return the
 * SAME editor reference (the editor module's no-op invariant). Commit is
 * itself no-op-safe; the T7 check is about identity preservation, not
 * commit safety.
 */
export function handleSectionBreak(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  const focus = editor.selection.focus;
  if (getBlock(editor.state, focus.blockId) === null) return editor;

  const result = applySectionBreak(editor.state, focus, productionAllocator);

  // T7 identity contract: a no-op op returns the same state reference.
  if (result.state === editor.state) return editor;

  const cursor = createPosition(result.newCursorBlockId, 0);
  const selectionAfter = createSpan(cursor, cursor);

  editor.history.commit(
    { state: result.state, dirtyIds: result.dirtyIds },
    { before: editor.selection, after: selectionAfter },
  );
  return rebuildTrees(
    { ...editor, state: result.state, selection: selectionAfter },
    editor,
    config,
    result.dirtyIds,
  );
}
