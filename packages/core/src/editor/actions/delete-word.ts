import type { EditorState, EditorConfig } from "../editor-state";
import { createPosition, createSpan, spanStart, spanEnd } from "../../state";
import { moveByWord } from "../../cursor/cursor-ops";
import { isCollapsed } from "../../cursor/selection";
import { isObjectSelection } from "../../cursor/object-selection";
import { rebuildTrees } from "./helpers";
import { isCrossContextSelection, expandedSpanCollapsePoint } from "./selection-guards";
import { deleteRangeOrSuggest, isSuggestingInBlock } from "./suggestion-mode";
import { deleteObjectSelection } from "./object-edits";

export function handleDeleteWord(
  editor: EditorState,
  direction: "forward" | "backward",
  config: EditorConfig,
): EditorState {
  // Object selection (#525): Ctrl+Delete on a selected atomic-leaf (image)
  // removes the object as a unit. Routes BEFORE the collapsed word-delete path,
  // whose cross-block guard would otherwise silently no-op on the atomic block.
  const objId = isObjectSelection(editor.state, editor.selection, config.componentRegistry);
  if (objId !== null) return deleteObjectSelection(editor, config, objId);

  const { selection } = editor;

  if (!isCollapsed(selection)) {
    // A non-collapsed selection delete just removes the selection (the
    // word-extension below only applies to a collapsed caret). Mirror the
    // canonical delete-backward path so a range inside a footnote/header/footer
    // body (embedContents / templateContents) is actually deleted: the
    // cross-CONTEXT refusal + the tree-aware (resolveBlock) deletable-span
    // guard. Using getBlock here (main-tree only) would early-return a no-op for
    // a body-context range (#430).
    if (isCrossContextSelection(editor.state, selection)) return editor;
    const start = expandedSpanCollapsePoint(editor.state, selection);
    if (start === null) return editor;
    const result = deleteRangeOrSuggest(editor.state, selection, config);
    if (result.state === editor.state) return editor;
    // In suggesting mode a forward word-delete must leave the caret PAST the
    // struck span (its END) so a repeated Delete strikes the NEXT span rather than
    // re-targeting the already-struck text (markDeletion coalesces → no-op);
    // backward keeps the caret at the span START (= `start`). Direct mode always
    // collapses to `start` (content shrank). `suggesting` reflects the ACTUAL
    // outcome — a soft-delete tracks in ANY editing context (main body OR a
    // footnote/header/footer body); only with no valid context is it a direct delete.
    const suggesting = isSuggestingInBlock(
      editor.state,
      spanStart(editor.state, selection).blockId,
      config,
    );
    const collapseTo =
      suggesting && direction === "forward"
        ? spanEnd(editor.state, selection)
        : start;
    const newCursor = createPosition(collapseTo.blockId, collapseTo.offset);
    const newSelection = createSpan(newCursor, newCursor);
    editor.history.commit(result, {
      before: selection,
      after: newSelection,
    });
    return rebuildTrees(
      { ...editor, state: result.state, selection: newSelection },
      editor,
      config,
      result.dirtyIds,
    );
  }

  const pos = selection.focus;
  const target = moveByWord(editor.state, pos, direction);
  if (target.blockId !== pos.blockId) {
    // Cross-block word delete not supported by deleteRange's cross-parent
    // guard without additional handling — no-op to match safe semantics.
    return editor;
  }
  if (target.offset === pos.offset) return editor;

  const span =
    direction === "backward"
      ? createSpan(target, pos)
      : createSpan(pos, target);
  const result = deleteRangeOrSuggest(editor.state, span, config);
  if (result.state === editor.state) return editor;
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
    editor.state,
    spanStart(editor.state, span).blockId,
    config,
  );
  const newCursor = direction === "backward" ? target : suggesting ? target : pos;
  const newSelection = createSpan(newCursor, newCursor);
  editor.history.commit(result, {
    before: selection,
    after: newSelection,
  });
  return rebuildTrees(
    { ...editor, state: result.state, selection: newSelection },
    editor,
    config,
    result.dirtyIds,
  );
}
