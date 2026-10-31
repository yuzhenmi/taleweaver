import type { EditorState } from "../../editor-state";
import type { Edit } from "../../edit";
import { getBlock, insertBlocksAfter, productionAllocator, createPosition, createSpan } from "../../../state";
import type { SiblingBlockInit } from "../../../state";

/**
 * Insert an atomic-leaf block (image / horizontal-line) immediately AFTER the
 * caret's focus block, followed by a fresh empty paragraph so the caret has an
 * editable landing spot below it (Google Docs leaves you on a new line after an
 * inserted rule/image); the caret lands at the start of that paragraph. One
 * undo entry. Shared by `handleInsertHorizontalLine` / `handleInsertImage` —
 * only the atomic block's init differs.
 *
 * No-op (`null`) when the focus block is
 * missing, is the root, or is not in the MAIN tree — `insertBlocksAfter` /
 * `getBlock` are main-tree-only, so a caret inside a header/footer/footnote
 * body is out of scope.
 */
export function insertAtomicBlockAfterFocus(
  editor: EditorState,
  atomicInit: SiblingBlockInit,
): Edit | null {
  const focus = getBlock(editor.document, editor.selection.focus.blockId);
  if (focus === null || focus.parentId === null) return null;

  const result = insertBlocksAfter(
    editor.document,
    focus.id,
    [atomicInit, { type: "paragraph", inlineContent: { items: [] } }],
    productionAllocator,
  );
  if (result.document === editor.document) return null;

  // newBlockIds = [atomic, paragraph]; caret lands in the paragraph.
  const paragraphId = result.newBlockIds[1];
  if (paragraphId === undefined) return null; // defensive: both always inserted

  const caret = createPosition(paragraphId, 0);
  return { change: result, selection: createSpan(caret, caret) };
}
