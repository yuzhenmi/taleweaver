import type { EditorState, EditorConfig } from "../editor-state";
import { insertAtomicBlockAfterFocus } from "./atomic-edits";

/**
 * INSERT_HORIZONTAL_LINE — insert a horizontal rule (Google Docs Insert ▸
 * Horizontal line) as a block-level atomic leaf immediately AFTER the caret's
 * block, followed by a fresh empty paragraph so the caret has an editable
 * landing spot below the rule. One undo entry. See `insertAtomicBlockAfterFocus`
 * for the shared insert + caret + no-op semantics.
 */
export function handleInsertHorizontalLine(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  return insertAtomicBlockAfterFocus(editor, config, { type: "horizontal-line" });
}
