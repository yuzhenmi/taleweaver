import type { EditorState, EditorConfig, EditorHistoryEntry } from "../editor-state";
import { pushEditorChange } from "../editor-state";
import { createCursor, isCollapsed } from "../../cursor/selection";
import { createPosition, type Position } from "../../state/position";
import { insertText, splitNode } from "../../state/transformations";
import { createNode } from "../../state/create-node";
import { updateAtPath } from "../../state/operations";
import type { StateNode } from "../../state/state-node";
import { deleteSelectionRange, rebuildTrees, findFirstTextDescendant } from "./helpers";

export function handlePaste(
  editor: EditorState,
  text: string,
  config: EditorConfig,
): EditorState {
  if (text.length === 0) return editor;

  // Normalize line endings: strip \r so \r\n becomes \n
  text = text.replace(/\r/g, "");

  // If selection expanded, delete it first
  let current = editor;
  if (!isCollapsed(editor.selection)) {
    current = deleteSelectionRange(editor, config);
  }

  // Save the original state for a single undo entry (before any deletion)
  const stateBeforePaste = editor.state;
  const selectionBeforePaste = editor.selection;

  const lines = text.split("\n");
  let state = current.state;
  let pos: Position = current.selection.focus;
  let nextId = current.nextId;

  // Insert first line as text
  if (lines[0].length > 0) {
    const change = insertText(state, pos, lines[0]);
    state = change.newState;
    pos = createPosition(pos.path, pos.offset + lines[0].length);
  }

  // For subsequent lines, split then insert
  for (let i = 1; i < lines.length; i++) {
    const nodeId = `node-${nextId}`;
    const change = splitNode(state, pos, nodeId);
    state = change.newState;
    nextId++;

    // After split, find the new block and place cursor there
    const paraIdx = pos.path[0];
    const newBlockIdx = paraIdx + 1;

    // Convert heading blocks to paragraphs (Enter on heading creates paragraph)
    const newBlock = state.children[newBlockIdx];
    if (newBlock.type === "heading") {
      const converted = createNode(
        newBlock.id,
        "paragraph",
        {},
        newBlock.children,
      );
      state = updateAtPath(state, [newBlockIdx], converted);
    }

    // Cursor at first text descendant of the new block
    const block = state.children[newBlockIdx];
    const firstText = findFirstTextDescendant(block, [newBlockIdx]);
    pos = firstText
      ? createPosition(firstText.path, 0)
      : createPosition([newBlockIdx, 0], 0);

    if (lines[i].length > 0) {
      const insertChange = insertText(state, pos, lines[i]);
      state = insertChange.newState;
      pos = createPosition(pos.path, pos.offset + lines[i].length);
    }
  }

  const newSelection = createCursor(pos.path, pos.offset);

  const pasteEntry: EditorHistoryEntry = {
    change: { oldState: stateBeforePaste, newState: state, timestamp: 0 },
    selectionBefore: selectionBeforePaste,
    selectionAfter: newSelection,
  };

  // Rebuild render + layout trees only once for the entire paste
  return rebuildTrees(
    {
      ...current,
      state,
      selection: newSelection,
      history: pushEditorChange(editor.history, pasteEntry),
      nextId,
    },
    current,
    config,
  );
}
