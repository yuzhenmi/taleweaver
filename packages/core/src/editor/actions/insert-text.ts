import type { EditorState } from "../editor-state";
import {
  insertText,
  mintInsertion,
  replaceRange,
  replaceWithSuggestion,
  createPosition,
  createSpan,
  spanStart,
  bookmarkDeletionSpan,
} from "../../state";
import type { OperationResult, Position } from "../../state";
import { isCollapsed } from "../../cursor/selection";
import { isObjectSelection } from "../../cursor/object-selection";
import { rebuildTrees } from "./helpers";
import { isCrossContextSelection } from "./selection-guards";
import { suggestionInputForBlock, replaceSuggestionInputForBlock } from "./suggestion-mode";
import { replaceObjectWithText } from "./object-edits";
import { getTypingAttrs } from "../typing-attrs";
import type { ActionOf } from "../editor-action";

export function handleInsertText(editor: EditorState, { text }: ActionOf<"INSERT_TEXT">): EditorState {
  const { config } = editor;
  // Object selection: typing over a selected atomic-leaf (image) replaces
  // the object with the typed text (Google Docs). Routes BEFORE the collapsed
  // path, which would otherwise throw — `insertText` rejects an atomic block
  // (`inlineContent === null`).
  const objId = isObjectSelection(editor.state, editor.selection, config.componentRegistry);
  if (objId !== null) return replaceObjectWithText(editor, config, objId, text);

  const selectionBefore = editor.selection;
  // Typing attributes: pending storedAttrs, else inherited at the caret (or the
  // first selected character for a type-over) — see `getTypingAttrs`. Read after
  // the cross-context guard (a cross-context span has no start).
  const typingAttrs = () => getTypingAttrs(editor);

  let result: OperationResult;
  let newCursorBlockId;
  let newCursorOffset;
  if (!isCollapsed(selectionBefore)) {
    // Cross-CONTEXT selection refusal (see isCrossContextSelection).
    // replaceRange's spanStart would throw "no common ancestor" on a cross-tree
    // span. NOTE: insert-text intentionally has ONLY this guard — not the
    // deletable-span (resolveBlock/parentId) guard the delete/split handlers
    // add — so its guard SET is unchanged.
    if (isCrossContextSelection(editor.state, selectionBefore)) return editor;
    const start = spanStart(editor.state, selectionBefore);
    // Suggesting mode: type-over-a-selection is the tracked composite — soft-delete
    // the selection + insert `text` as a suggestion at its seam, in ONE undoable op
    // (replaceWithSuggestion, the suggestion analog of replaceRange). Direct mode uses
    // the destructive replaceRange. The caret goes right after the new text, at the
    // deletion's seam (where a removed bookmark's start marker just before the
    // selection was) — in suggesting mode the struck old text follows the caret.
    // Gate on the selection-start block's context: a type-over in ANY editing
    // context (main body OR a footnote/header/footer body) is TRACKED;
    // `replaceSuggestionInputForBlock` returns null only when not suggesting or
    // the block resolves to no context, → direct `replaceRange`.
    const replaceInput = replaceSuggestionInputForBlock(editor.state, start.blockId, config);
    let end: Position;
    if (replaceInput === null) {
      result = replaceRange(editor.state, selectionBefore, text, typingAttrs());
      const seam = bookmarkDeletionSpan(editor.state, selectionBefore).span.anchor;
      end = createPosition(seam.blockId, seam.offset + text.length);
    } else {
      const suggested = replaceWithSuggestion(editor.state, selectionBefore, text, typingAttrs(), replaceInput);
      result = suggested;
      end = suggested.endPosition;
    }
    newCursorBlockId = end.blockId;
    newCursorOffset = end.offset;
  } else {
    // The reducer already moved the caret past adjacent markers (`reduceEditor`).
    const focus = selectionBefore.focus;
    // Suggesting mode: insert `text` as a tracked SUGGESTION (mintInsertion
    // stamps the insertion-provenance id + writes/coalesces an `insertion`
    // record) instead of plain text. mintInsertion advances `text.length`
    // offsets exactly as insertText, so the cursor lands identically; it is a
    // normal tracked/undoable op, so the commit + rebuild below are unchanged.
    // Gate on the caret block's context: a caret in ANY editing context (main
    // body OR a footnote/header/footer body) is TRACKED; `suggestionInputForBlock`
    // returns null only when not suggesting or the block resolves to no context,
    // → direct `insertText`.
    const sugInput = suggestionInputForBlock(editor.state, focus.blockId, config);
    result =
      sugInput === null
        ? insertText(editor.state, focus, text, typingAttrs())
        : mintInsertion(editor.state, focus, text, typingAttrs(), sugInput);
    newCursorBlockId = focus.blockId;
    newCursorOffset = focus.offset + text.length;
  }

  // the identity-no-op contract: a no-op op returns the same state reference,
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
