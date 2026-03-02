import type { EditorState, EditorConfig } from "../editor-state";
import { pushEditorChange } from "../editor-state";
import { createCursor, isCollapsed } from "../../cursor/selection";
import { splitNode } from "../../state/transformations";
import { createNode } from "../../state/create-node";
import { rebuildTrees, deleteSelectionRange, findFirstTextDescendant } from "./helpers";

export function handleInsertBlock(
  editor: EditorState,
  blockType: string,
  properties: Record<string, unknown>,
  config: EditorConfig,
): EditorState {
  // If selection is expanded, delete selection first
  let current = editor;
  if (!isCollapsed(editor.selection)) {
    current = deleteSelectionRange(editor, config);
  }

  const pos = current.selection.focus;
  const paraIdx = pos.path[0];

  // Split the current paragraph at cursor
  const nodeId = `node-${current.nextId}`;
  const change = splitNode(current.state, pos, nodeId, 0);

  // Insert the void block between the two halves
  const docChildren = [...change.newState.children];
  const voidBlock = createNode(
    `node-${current.nextId + 1}`,
    blockType,
    properties,
    [],
  );
  docChildren.splice(paraIdx + 1, 0, voidBlock);

  const newDoc = createNode(
    change.newState.id,
    change.newState.type,
    { ...change.newState.properties },
    docChildren,
  );

  // Cursor → first text node of the paragraph after the void block (paraIdx + 2)
  const afterBlock = newDoc.children[paraIdx + 2];
  const firstText = afterBlock ? findFirstTextDescendant(afterBlock, [paraIdx + 2]) : null;
  const newSelection = firstText
    ? createCursor(firstText.path, 0)
    : createCursor([paraIdx + 2, 0], 0);

  return rebuildTrees(
    {
      ...current,
      state: newDoc,
      selection: newSelection,
      history: pushEditorChange(current.history, {
        change: { oldState: current.state, newState: newDoc, timestamp: 0 },
        selectionBefore: editor.selection,
        selectionAfter: newSelection,
      }),
      nextId: current.nextId + 2,
    },
    current,
    config,
  );
}
