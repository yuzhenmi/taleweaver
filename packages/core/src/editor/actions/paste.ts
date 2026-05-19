import type { EditorState, EditorConfig } from "../editor-state";
import type { State } from "../../state/state";
import { getBlock } from "../../state/state";
import { productionAllocator } from "../../state/block-id";
import { createPosition, createSpan, type Position } from "../../state/block-position";
import { spanStart } from "../../state/block-compare";
import { deleteRange } from "../../state/delete-range";
import { insertText } from "../../state/insert-text";
import { splitBlockAtPosition } from "../../state/split-block";
import { rebuildTrees } from "./helpers";

export function handlePaste(
  editor: EditorState,
  rawText: string,
  config: EditorConfig,
): EditorState {
  if (rawText.length === 0) return editor;

  // Normalize line endings: strip \r so \r\n becomes \n.
  const text = rawText.replace(/\r/g, "");

  // Collapse selection (delete the existing range first).
  let state: State = editor.state;
  let pos: Position = editor.selection.focus;
  const { selection } = editor;
  const collapsed =
    selection.anchor.blockId === selection.focus.blockId &&
    selection.anchor.offset === selection.focus.offset;

  if (!collapsed) {
    const anchorBlock = getBlock(state, selection.anchor.blockId);
    const focusBlock = getBlock(state, selection.focus.blockId);
    if (anchorBlock === null || focusBlock === null) return editor;
    if (
      selection.anchor.blockId !== selection.focus.blockId &&
      anchorBlock.parentId !== focusBlock.parentId
    ) {
      return editor;
    }
    const start = spanStart(state, selection);
    const deleteResult = deleteRange(state, selection);
    state = deleteResult.state;
    pos = createPosition(start.blockId, start.offset);
  }

  const lines = text.split("\n");

  // Insert first line as text at the current position.
  if (lines[0].length > 0) {
    const r = insertText(state, pos, lines[0], {});
    state = r.state;
    pos = createPosition(pos.blockId, pos.offset + lines[0].length);
  }

  // Subsequent lines: split block, then insert text into the new block.
  for (let i = 1; i < lines.length; i++) {
    const block = getBlock(state, pos.blockId);
    if (block === null || block.inlineContent === null || block.parentId === null) {
      break;
    }
    const splitResult = splitBlockAtPosition(state, pos, productionAllocator);
    state = splitResult.state;
    const updatedOriginal = getBlock(state, pos.blockId);
    if (updatedOriginal === null) break;
    const newBlockId = updatedOriginal.nextSiblingId;
    if (newBlockId === null) break;
    pos = createPosition(newBlockId, 0);

    if (lines[i].length > 0) {
      const r = insertText(state, pos, lines[i], {});
      state = r.state;
      pos = createPosition(pos.blockId, pos.offset + lines[i].length);
    }
  }

  const newSelection = createSpan(pos, pos);
  editor.history.setState(state);
  editor.history.push({ selection: newSelection });
  return rebuildTrees(
    { ...editor, state, selection: newSelection },
    editor,
    config,
  );
}
