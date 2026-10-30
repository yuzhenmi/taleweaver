import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { getBlock, productionAllocator, createPosition, createSpan, applySectionBreak, applySectionBreakAsSuggestion } from "../../state";
import { suggestionInputForBlock } from "./helpers/suggestion-input-for-block";

/**
 * `SECTION_BREAK` handler — wires the Layer-3 `applySectionBreak` op into the
 * editor (Word): a split of the caret's paragraph whose head
 * carries the new section end, in one transaction. The caret stays at the start
 * of the tail (the caret's block). A caret inside a top-level object breaks
 * before that block.
 */
export function handleSectionBreak(editor: EditorState): Edit | null {
  const { config } = editor;
  const focus = editor.selection.focus;
  if (getBlock(editor.state, focus.blockId) === null) return null;

  // Suggesting mode: a tracked section-break insertion (tag on the new section mark).
  const input = suggestionInputForBlock(editor.state, focus.blockId, config);
  const result =
    input !== null
      ? applySectionBreakAsSuggestion(editor.state, focus, productionAllocator, input)
      : applySectionBreak(editor.state, focus, productionAllocator);

  const cursor = createPosition(result.newCursorBlockId, 0);
  const selectionAfter = createSpan(cursor, cursor);

  return { change: { state: result.state, dirtyIds: result.dirtyIds }, selection: selectionAfter };
}
