import type { EditorState, EditorConfig } from "../editor-state";
import { createPosition, createSpan, deleteRange } from "../../state";
import { moveToLineBoundary } from "../../cursor/line-navigation";
import { isCollapsed } from "../../cursor/selection";
import { rebuildTrees } from "./helpers";
import { isCrossContextSelection, expandedSpanCollapsePoint } from "./selection-guards";

export function handleDeleteLine(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  const { selection } = editor;

  if (!isCollapsed(selection)) {
    // A non-collapsed selection delete just removes the selection (the
    // line-extension below only applies to a collapsed caret). Mirror the
    // canonical delete-backward path so a range inside a footnote/header/footer
    // body (embedContents / templateContents) is actually deleted: the
    // cross-CONTEXT refusal + the tree-aware (resolveBlock) deletable-span
    // guard. Using getBlock here (main-tree only) would early-return a no-op for
    // a body-context range (#430).
    if (isCrossContextSelection(editor.state, selection)) return editor;
    const start = expandedSpanCollapsePoint(editor.state, selection);
    if (start === null) return editor;
    const result = deleteRange(editor.state, selection);
    if (result.state === editor.state) return editor;
    const newCursor = createPosition(start.blockId, start.offset);
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
  const lineStart = moveToLineBoundary(
    editor.state,
    pos,
    editor.layoutTree,
    config.measurer,
    "start",
  );
  if (lineStart === null) return editor;
  if (lineStart.blockId === pos.blockId && lineStart.offset === pos.offset) {
    return editor;
  }
  // Only support within-block line deletion (line boundaries always stay
  // inside one block in our model).
  if (lineStart.blockId !== pos.blockId) return editor;

  const span = createSpan(lineStart, pos);
  const result = deleteRange(editor.state, span);
  if (result.state === editor.state) return editor;
  const newCursor = createPosition(lineStart.blockId, lineStart.offset);
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
