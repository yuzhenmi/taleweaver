import type { EditorState, EditorConfig } from "../editor-state";
import type { OperationResult } from "../../state/state";
import { insertText } from "../../state/insert-text";
import { replaceRange } from "../../state/replace-range";
import { createPosition, createSpan } from "../../state/block-position";
import { spanStart } from "../../state/block-compare";
import { isCollapsed } from "../../cursor/selection";
import { rebuildTrees } from "./helpers";

export function handleInsertText(
  editor: EditorState,
  text: string,
  config: EditorConfig,
): EditorState {
  const selectionBefore = editor.selection;

  let result: OperationResult;
  let newCursorBlockId;
  let newCursorOffset;
  if (!isCollapsed(selectionBefore)) {
    const start = spanStart(editor.state, selectionBefore);
    result = replaceRange(editor.state, selectionBefore, text, {});
    newCursorBlockId = start.blockId;
    newCursorOffset = start.offset + text.length;
  } else {
    const focus = selectionBefore.focus;
    result = insertText(editor.state, focus, text, {});
    newCursorBlockId = focus.blockId;
    newCursorOffset = focus.offset + text.length;
  }

  // No-op short-circuit: Yjs skips no-op groups, so committing here
  // would break the History stack-alignment invariant. Use the T7
  // result.state === editor.state identity contract (cheaper than
  // dirtyIds.size === 0 and semantically aligned with state-module).
  if (result.state === editor.state) return editor;

  const newCursor = createPosition(newCursorBlockId, newCursorOffset);
  const newSelection = createSpan(newCursor, newCursor);

  editor.history.commit(result, {
    before: selectionBefore,
    after: newSelection,
  });

  return rebuildTrees(
    { ...editor, state: result.state, selection: newSelection },
    editor,
    config,
  );
}
