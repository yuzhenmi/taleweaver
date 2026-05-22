import type { EditorState, EditorConfig } from "../editor-state";
import { getBlock } from "../../state/state";
import { createPosition, createSpan } from "../../state/block-position";
import { spanStart } from "../../state/block-compare";
import { deleteRange } from "../../state/delete-range";
import { moveByWord } from "../../cursor/cursor-ops";
import { rebuildTrees } from "./helpers";

export function handleDeleteWord(
  editor: EditorState,
  direction: "forward" | "backward",
  config: EditorConfig,
): EditorState {
  const { selection } = editor;
  const collapsed =
    selection.anchor.blockId === selection.focus.blockId &&
    selection.anchor.offset === selection.focus.offset;

  if (!collapsed) {
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
    if (result.dirtyIds.size === 0) return editor;
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
  if (result.dirtyIds.size === 0) return editor;
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
  );
}
