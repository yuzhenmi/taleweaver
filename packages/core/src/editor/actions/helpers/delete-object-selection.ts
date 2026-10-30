import type { EditorState } from "../../editor-state";
import type { Edit } from "../../edit";
import { getBlock, createPosition, createSpan, deleteTable } from "../../../state";
import type { BlockId, Position } from "../../../state";
import { contentLengthForState } from "./content-length-for-state";

/**
 * Delete the selected object as a unit (Google Docs: Backspace/Delete on a
 * selected image removes it). Caret placement after removal:
 *  - the START of the FOLLOWING block (invariant I: a paragraph always follows
 *    a block object);
 *  - else the END of the PRECEDING block.
 *
 * One undo entry. Undo restores the image AND the object selection (the commit's
 * `before` selection IS the object selection `{ objId, 0 }`). No-op (same
 * edit) when the block is missing.
 */
export function deleteObjectSelection(
  editor: EditorState,
  objId: BlockId,
): Edit | null {
  const obj = getBlock(editor.state, objId);
  if (obj === null) return null;

  // Capture neighbours from the PRE-mutation snapshot — they survive the removal
  // (their sibling pointers are relinked, ids unchanged) and drive caret choice.
  const nextSiblingId = obj.nextSiblingId;
  const prevSiblingId = obj.prevSiblingId;

  const result = deleteTable(editor.state, objId);
  if (result.state === editor.state) return null;

  const caret = caretAfterObjectDelete(
    editor,
    nextSiblingId,
    prevSiblingId,
  );
  if (caret === null) return null; // unreachable: a paragraph follows every object (invariant I)

  return { change: result, selection: createSpan(caret, caret) };
}

/**
 * Resolve the post-delete caret: following-block start, else preceding-block end. The preceding block's content length is read
 * from the ORIGINAL `editor` state — removing a sibling does not touch the
 * preceding block's `inlineContent`, so its length is identical pre/post-delete.
 */
function caretAfterObjectDelete(
  editor: EditorState,
  nextSiblingId: BlockId | null,
  prevSiblingId: BlockId | null,
): Position | null {
  if (nextSiblingId !== null) {
    return createPosition(nextSiblingId, 0);
  }
  if (prevSiblingId !== null) {
    return createPosition(prevSiblingId, contentLengthForState(editor.state, prevSiblingId));
  }
  return null;
}
