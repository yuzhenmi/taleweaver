import type { EditorState, EditorConfig } from "../editor-state";
import type { NewNode } from "../../state/new-node";
import type { Position } from "../../state/position";
import type { StateNode } from "../../state/state-node";
import { createNode } from "../../state/create-node";
import { rebuildTrees } from "./helpers";

/**
 * Walk a NewNode subtree and assign sequential ids using the editor's allocator.
 * Returns the resulting StateNode.
 */
function assignIds(
  newNode: NewNode,
  nextId: { value: number },
): StateNode {
  const id = `n-${nextId.value++}`;
  const children = newNode.children.map((c) => assignIds(c, nextId));
  return createNode(id, newNode.type, newNode.properties, children, newNode.style);
}

export function handleInsertNode(
  editor: EditorState,
  newNode: NewNode,
  _position: Position | undefined,
  config: EditorConfig,
): EditorState {
  const idCounter = { value: editor.nextId };
  const constructed = assignIds(newNode, idCounter);

  // Plan 1: insert as the last child of the document.
  // Plan 2/3 may extend with explicit position support; for now `_position` is unused.
  const newDoc = createNode(
    editor.state.id,
    editor.state.type,
    editor.state.properties,
    [...editor.state.children, constructed],
    editor.state.style,
  );

  return rebuildTrees(
    {
      ...editor,
      state: newDoc,
      nextId: idCounter.value,
    },
    editor,
    config,
  );
}
