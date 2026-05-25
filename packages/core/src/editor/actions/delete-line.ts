import type { EditorState, EditorConfig } from "../editor-state";
import { getBlock } from "../../state/state";
import { createPosition, createSpan } from "../../state/block-position";
import { spanStart } from "../../state/block-compare";
import { deleteRange } from "../../state/delete-range";
import { moveToLineBoundary } from "../../cursor/line-navigation";
import { isCollapsed } from "../../cursor/selection";
import { resolvePositionedTree } from "../../layout/positioned-tree";
import { rebuildTrees } from "./helpers";

export function handleDeleteLine(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  const { selection } = editor;

  if (!isCollapsed(selection)) {
    const anchorBlock = getBlock(editor.state, selection.anchor.blockId);
    const focusBlock = getBlock(editor.state, selection.focus.blockId);
    if (anchorBlock === null || focusBlock === null) return editor;
    if (
      selection.anchor.blockId !== selection.focus.blockId &&
      anchorBlock.parentId !== focusBlock.parentId
    ) {
      return editor;
    }
    const start = spanStart(editor.state, selection);
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
    resolvePositionedTree(editor.layoutTree),
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
