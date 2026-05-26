import type { EditorState, EditorConfig } from "../editor-state";
import { insertText, replaceRange, createPosition, createSpan, spanStart, selectionContextOf } from "../../state";
import type { OperationResult } from "../../state";
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
    // C.2c §6: cross-CONTEXT selection refusal. A header/footer body is an
    // isolated editing context; a span whose anchor and focus resolve to
    // different roots (e.g. main body → header body, constructable via a drag)
    // is unsupported by the span ops (replaceRange's spanStart would throw "no
    // common ancestor"). No-op rather than attempt a cross-tree replace.
    if (
      selectionContextOf(editor.state, selectionBefore.anchor.blockId) !==
      selectionContextOf(editor.state, selectionBefore.focus.blockId)
    ) {
      return editor;
    }
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
    result.dirtyIds,
  );
}
