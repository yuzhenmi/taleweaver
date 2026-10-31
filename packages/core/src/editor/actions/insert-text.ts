import type { EditorState } from "../editor-state";
import {
  insertText,
  mintInsertion,
  replaceRange,
  replaceWithSuggestion,
  createPosition,
  createSpan,
  spanStart,
} from "../../state";
import type { OperationResult, Position } from "../../state";
import { isCollapsed } from "../../cursor/selection";
import { isObjectSelection } from "../../cursor/object-selection";
import type { Edit } from "../edit";
import { isCrossContextSelection } from "./helpers/is-cross-context-selection";
import { expandedSpanCollapsePoint } from "./helpers/expanded-span-collapse-point";
import { suggestionInputForBlock } from "./helpers/suggestion-input-for-block";
import { replaceSuggestionInputForBlock } from "./helpers/replace-suggestion-input-for-block";
import { replaceObjectWithText } from "./helpers/replace-object-with-text";
import { getTypingAttrs } from "../typing-attrs";
import type { ActionOf } from "../editor-action";

export function handleInsertText(editor: EditorState, { text }: ActionOf<"INSERT_TEXT">): Edit | null {
  const { config } = editor;
  // Object selection: typing over a selected atomic-leaf (image) replaces
  // the object with the typed text (Google Docs). Routes BEFORE the collapsed
  // path, which would otherwise throw — `insertText` rejects an atomic block
  // (`inlineContent === null`).
  const objId = isObjectSelection(editor.document, editor.selection, config.componentRegistry);
  if (objId !== null) return replaceObjectWithText(editor, objId, text);

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
    // span.
    if (isCrossContextSelection(editor.document, selectionBefore)) return null;
    const start = spanStart(editor.document, selectionBefore);
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
    const replaceInput = replaceSuggestionInputForBlock(editor, start.blockId);
    let end: Position;
    if (replaceInput === null) {
      // The seam the direct delete leaves (the surviving block — see
      // expandedSpanCollapsePoint); null = an undeletable (cross-parent) span.
      const seam = expandedSpanCollapsePoint(editor.document, selectionBefore);
      if (seam === null) return null;
      result = replaceRange(editor.document, selectionBefore, text, typingAttrs());
      end = createPosition(seam.blockId, seam.offset + text.length);
    } else {
      const suggested = replaceWithSuggestion(editor.document, selectionBefore, text, typingAttrs(), replaceInput);
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
    // normal tracked/undoable op, so the edit below is unchanged.
    // Gate on the caret block's context: a caret in ANY editing context (main
    // body OR a footnote/header/footer body) is TRACKED; `suggestionInputForBlock`
    // returns null only when not suggesting or the block resolves to no context,
    // → direct `insertText`.
    const sugInput = suggestionInputForBlock(editor, focus.blockId);
    result =
      sugInput === null
        ? insertText(editor.document, focus, text, typingAttrs())
        : mintInsertion(editor.document, focus, text, typingAttrs(), sugInput);
    newCursorBlockId = focus.blockId;
    newCursorOffset = focus.offset + text.length;
  }

  // the identity-no-op contract: a no-op op returns the same state reference, so
  // nothing is edited.
  if (result.state === editor.document) return null;

  const newCursor = createPosition(newCursorBlockId, newCursorOffset);
  const newSelection = createSpan(newCursor, newCursor);

  return { change: result, selection: newSelection };
}
