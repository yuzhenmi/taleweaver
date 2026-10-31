import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { expandSpanOverAtomicMarks } from "../atomic-marks";
import { createPosition, createSpan, spanStart, clipSpanToText } from "../../state";
import { moveByWord } from "../../cursor/cursor-ops";
import { isCollapsed } from "../../cursor/selection";
import { isObjectSelection } from "../../cursor/object-selection";
import { isCrossContextSelection } from "./helpers/is-cross-context-selection";
import { expandedSpanCollapsePoint } from "./helpers/expanded-span-collapse-point";
import { deleteRangeOrSuggest } from "./helpers/delete-range-or-suggest";
import { isSuggestingInBlock } from "./helpers/is-suggesting-in-block";
import { deleteObjectSelection } from "./helpers/delete-object-selection";
import type { ActionOf } from "../editor-action";

export function handleDeleteWord(editor: EditorState, { direction }: ActionOf<"DELETE_WORD">): Edit | null {
  const { config } = editor;
  // Object selection: Ctrl+Delete on a selected atomic-leaf (image)
  // removes the object as a unit. Routes BEFORE the collapsed word-delete path,
  // whose cross-block guard would otherwise silently no-op on the atomic block.
  const objId = isObjectSelection(editor.document, editor.selection, config.componentRegistry);
  if (objId !== null) return deleteObjectSelection(editor, objId);

  const { selection } = editor;

  if (!isCollapsed(selection)) {
    // A non-collapsed selection delete just removes the selection (the
    // word-extension below only applies to a collapsed caret). Mirror the
    // canonical delete-backward path so a range inside a footnote/header/footer
    // body (embedContents / templateContents) is actually deleted: the
    // cross-CONTEXT refusal + the tree-aware (resolveBlock) deletable-span
    // guard. Using getBlock here (main-tree only) would early-return a no-op for
    // a body-context range.
    if (isCrossContextSelection(editor.document, selection)) return null;
    const start = expandedSpanCollapsePoint(editor.document, selection);
    if (start === null) return null;
    const result = deleteRangeOrSuggest(editor, selection);
    if (result.state === editor.document) return null;
    // In suggesting mode a forward word-delete must leave the caret PAST the
    // struck span (its END) so a repeated Delete strikes the NEXT span rather than
    // re-targeting the already-struck text (markDeletion coalesces → no-op);
    // backward keeps the caret at the span START (= `start`). Direct mode always
    // collapses to `start` (content shrank). `suggesting` reflects the ACTUAL
    // outcome — a soft-delete tracks in ANY editing context (main body OR a
    // footnote/header/footer body); only with no valid context is it a direct delete.
    const suggesting = isSuggestingInBlock(
      editor,
      spanStart(editor.document, selection).blockId,
    );
    // (The span's text: a covered object stays — `clipSpanToText`.)
    const text = clipSpanToText(editor.document, selection);
    const collapseTo = suggesting ? (direction === "forward" ? text.focus : text.anchor) : start;
    const newCursor = createPosition(collapseTo.blockId, collapseTo.offset);
    const newSelection = createSpan(newCursor, newCursor);
    return { change: result, selection: newSelection };
  }

  const pos = selection.focus;
  const target = moveByWord(editor.document, pos, direction);
  if (target.blockId !== pos.blockId) {
    // Cross-block word delete not supported by deleteRange's cross-parent
    // guard without additional handling — no-op to match safe semantics.
    return null;
  }
  if (target.offset === pos.offset) return null;

  // A word step that ends inside an atomic mark deletes the whole mark.
  const span = expandSpanOverAtomicMarks(
    editor.document,
    direction === "backward" ? createSpan(target, pos) : createSpan(pos, target),
  );
  const result = deleteRangeOrSuggest(editor, span);
  if (result.state === editor.document) return null;
  // Soft-delete leaves the caret on the FAR edge of the struck span in the
  // deletion direction. For BACKWARD that far edge IS `target` (the word-boundary
  // before the caret = span start) in both modes. For FORWARD the far edge is the
  // span END (`target`, the word-boundary past the caret) so a repeated Delete
  // strikes the NEXT word; direct mode keeps the existing caret at `pos`.
  // `suggesting` reflects the ACTUAL outcome — a forward word soft-delete tracks
  // in ANY editing context (main body OR a footnote/header/footer body), so the
  // caret advances to `target`; only with no valid context is it a direct delete
  // with the caret at `pos`.
  const suggesting = isSuggestingInBlock(
    editor,
    spanStart(editor.document, span).blockId,
  );
  const newCursor = direction === "backward" ? span.anchor : suggesting ? span.focus : span.anchor;
  const newSelection = createSpan(newCursor, newCursor);
  return { change: result, selection: newSelection };
}
