import type { EditorState } from "../editor-state";
import { getBlock, productionAllocator, createPosition, createSpan, applySectionBreak, applySectionBreakAsSuggestion } from "../../state";
import { rebuildTrees } from "./helpers";
import { suggestionInputForBlock } from "./suggestion-mode";

/**
 * `SECTION_BREAK` handler — wires the Layer-3 `applySectionBreak` op into the
 * editor (Word): a split of the caret's paragraph whose head
 * carries the new section end, in one transaction. The caret stays at the start
 * of the tail (the caret's block). A caret inside a top-level object breaks
 * before that block.
 */
export function handleSectionBreak(editor: EditorState): EditorState {
  const { config } = editor;
  const focus = editor.selection.focus;
  if (getBlock(editor.state, focus.blockId) === null) return editor;

  // Suggesting mode: a tracked section-break insertion (tag on the new section mark).
  const input = suggestionInputForBlock(editor.state, focus.blockId, config);
  const result =
    input !== null
      ? applySectionBreakAsSuggestion(editor.state, focus, productionAllocator, input)
      : applySectionBreak(editor.state, focus, productionAllocator);

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
