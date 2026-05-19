import type { EditorState, EditorConfig } from "../editor-state";
import { insertText } from "../../state/insert-text";
import { replaceRange } from "../../state/replace-range";
import { createPosition, createSpan } from "../../state/block-position";
import { spanStart } from "../../state/block-compare";
import { rebuildTrees } from "./helpers";

export function handleInsertText(
  editor: EditorState,
  text: string,
  config: EditorConfig,
): EditorState {
  const selectionBefore = editor.selection;
  const collapsed =
    selectionBefore.anchor.blockId === selectionBefore.focus.blockId &&
    selectionBefore.anchor.offset === selectionBefore.focus.offset;

  let newState;
  let newCursorBlockId;
  let newCursorOffset;
  if (!collapsed) {
    const start = spanStart(editor.state, selectionBefore);
    const result = replaceRange(editor.state, selectionBefore, text, {});
    newState = result.state;
    newCursorBlockId = start.blockId;
    newCursorOffset = start.offset + text.length;
  } else {
    const focus = selectionBefore.focus;
    const result = insertText(editor.state, focus, text, {});
    newState = result.state;
    newCursorBlockId = focus.blockId;
    newCursorOffset = focus.offset + text.length;
  }

  const newCursor = createPosition(newCursorBlockId, newCursorOffset);
  const newSelection = createSpan(newCursor, newCursor);

  editor.history.setState(newState);
  editor.history.push({ selection: newSelection });

  return rebuildTrees(
    { ...editor, state: newState, selection: newSelection },
    editor,
    config,
  );
}
