import type { EditorState, EditorConfig } from "../editor-state";
import { insertAtomicBlockAfterFocus } from "./atomic-edits";
import { DEFAULT_TOC_ATTRS } from "../../components/table-of-contents-attrs";

/**
 * INSERT_TABLE_OF_CONTENTS — insert a live Table of Contents (Google Docs Insert ▸
 * Table of contents). A `table-of-contents` atomic-leaf block carrying the TOC
 * options is inserted immediately AFTER the caret's block, followed by a fresh
 * empty paragraph so the caret has an editable landing spot below it (mirrors
 * INSERT_HORIZONTAL_LINE / INSERT_IMAGE). The caret lands at the start of that
 * paragraph; one undo entry. See `insertAtomicBlockAfterFocus` for the shared
 * insert + caret + no-op semantics.
 */
export function handleInsertTableOfContents(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  return insertAtomicBlockAfterFocus(editor, config, {
    type: "table-of-contents",
    attrs: { ...DEFAULT_TOC_ATTRS },
  });
}
