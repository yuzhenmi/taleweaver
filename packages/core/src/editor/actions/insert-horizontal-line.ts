import type { EditorState, EditorConfig } from "../editor-state";
import {
  getBlock,
  insertBlocksAfter,
  productionAllocator,
  createPosition,
  createSpan,
} from "../../state";
import { rebuildTrees } from "./helpers";

/**
 * INSERT_HORIZONTAL_LINE — insert a horizontal rule (Google Docs Insert ▸
 * Horizontal line) as a block-level atomic leaf immediately AFTER the caret's
 * block, followed by a fresh empty paragraph so the caret has an editable
 * landing spot below the rule (Google Docs leaves you on a new line after it).
 * One undo entry.
 *
 * No-op (same `editor` reference, no `history.commit`) when the focus block is
 * missing, is the root, or is not in the MAIN tree — `insertBlocksAfter` is
 * main-tree-only, so a caret inside a header/footer/footnote body is out of
 * scope for this action (`getBlock` returns null there).
 */
export function handleInsertHorizontalLine(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  const focus = getBlock(editor.state, editor.selection.focus.blockId);
  if (focus === null || focus.parentId === null) return editor;

  const result = insertBlocksAfter(
    editor.state,
    focus.id,
    [
      { type: "horizontal-line" },
      { type: "paragraph", inlineContent: { items: [] } },
    ],
    productionAllocator,
  );
  if (result.state === editor.state) return editor;

  // newBlockIds = [horizontal-line, paragraph]; caret lands in the paragraph.
  const paragraphId = result.newBlockIds[1];
  if (paragraphId === undefined) return editor; // defensive: both always inserted

  const caret = createPosition(paragraphId, 0);
  const after = createSpan(caret, caret);
  editor.history.commit(
    { state: result.state, dirtyIds: result.dirtyIds },
    { before: editor.selection, after },
  );
  return rebuildTrees(
    { ...editor, state: result.state, selection: after },
    editor,
    config,
    result.dirtyIds,
  );
}
