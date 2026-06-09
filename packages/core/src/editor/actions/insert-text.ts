import type { EditorState, EditorConfig } from "../editor-state";
import {
  insertText,
  mintInsertion,
  replaceRange,
  createPosition,
  createSpan,
  spanStart,
} from "../../state";
import type { OperationResult } from "../../state";
import { isCollapsed } from "../../cursor/selection";
import { rebuildTrees } from "./helpers";
import { isCrossContextSelection } from "./selection-guards";
import { newSuggestionInput } from "./suggestion-mode";

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
    // C.2c §6: cross-CONTEXT selection refusal (see isCrossContextSelection).
    // replaceRange's spanStart would throw "no common ancestor" on a cross-tree
    // span. NOTE: insert-text intentionally has ONLY this guard — not the
    // deletable-span (resolveBlock/parentId) guard the delete/split handlers
    // add — so its guard SET is unchanged.
    if (isCrossContextSelection(editor.state, selectionBefore)) return editor;
    // Suggesting mode: type-over-an-EXPANDED-selection is a tracked interim
    // NO-OP. The correct behavior is a soft-delete (markDeletion) of the
    // selection + a suggested insertion (mintInsertion) of `text` as ONE
    // composite — that lands in a later change-tracking slice (the deletes /
    // composite slice). Until then we refuse the edit rather than do a plain
    // destructive replaceRange (which would discard the selected text untracked).
    if ((config.suggestingAuthor ?? null) !== null) return editor;
    const start = spanStart(editor.state, selectionBefore);
    result = replaceRange(editor.state, selectionBefore, text, {});
    newCursorBlockId = start.blockId;
    newCursorOffset = start.offset + text.length;
  } else {
    const focus = selectionBefore.focus;
    // Suggesting mode: insert `text` as a tracked SUGGESTION (mintInsertion
    // stamps the insertion-provenance id + writes/coalesces an `insertion`
    // record) instead of plain text. mintInsertion advances `text.length`
    // offsets exactly as insertText, so the cursor lands identically; it is a
    // normal tracked/undoable op, so the commit + rebuild below are unchanged.
    const sugInput = newSuggestionInput(config);
    result =
      sugInput === null
        ? insertText(editor.state, focus, text, {})
        : mintInsertion(editor.state, focus, text, {}, sugInput);
    newCursorBlockId = focus.blockId;
    newCursorOffset = focus.offset + text.length;
  }

  // T7 identity contract: a no-op op returns the same state reference,
  // so the editor module's "no change → same editor reference" invariant
  // requires the early return here. `history.commit` is itself no-op-safe
  // (it silently drops empty `dirtyIds`), so this short-circuit is about
  // the identity invariant, not commit safety.
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
