import type { EditorState, EditorConfig } from "../editor-state";
import { createPosition, createSpan, deleteRange } from "../../state";
import { moveByWord } from "../../cursor/cursor-ops";
import { isCollapsed } from "../../cursor/selection";
import { rebuildTrees } from "./helpers";
import { isCrossContextSelection, expandedSpanCollapsePoint } from "./selection-guards";

export function handleDeleteWord(
  editor: EditorState,
  direction: "forward" | "backward",
  config: EditorConfig,
): EditorState {
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
  const result = deleteRange(editor.state, span);
  if (result.state === editor.state) return editor;
  const newCursor = direction === "backward" ? target : pos;
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
