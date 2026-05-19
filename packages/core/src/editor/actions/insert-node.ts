import type { EditorState, EditorConfig } from "../editor-state";
import type { NewNode } from "../../state/node";
import type { Position } from "../../state/block-position";
import type { State } from "../../state/state";
import type { BlockId, IdAllocator } from "../../state/block-id";
import { productionAllocator } from "../../state/block-id";
import { getBlock } from "../../state/state";
import { insertBlock } from "../../state/insert-block";
import { rebuildTrees } from "./helpers";

/**
 * Insert `newNode` (and recursively its descendants) under `parentId` as
 * the last child. Returns the resulting state and the new root block id.
 * Closed-schema `style` from NewNode is ignored in the new model — only
 * `properties` (treated as attrs) flow into the inserted block. Callers
 * that need styling should set attrs that route through AttrRegistry.
 */
function insertNewNodeAt(
  state: State,
  newNode: NewNode,
  parentId: BlockId,
  allocator: IdAllocator,
): State {
  const insertResult = insertBlock(state, parentId, null, {
    type: newNode.type,
    attrs: newNode.properties,
    inlineContent: newNode.children.length === 0 ? { items: [] } : null,
  }, allocator);
  let cur = insertResult.state;
  // After insert, the new block is the parent's lastChildId.
  const parent = getBlock(cur, parentId);
  if (parent === null) return cur;
  const newId = parent.lastChildId;
  if (newId === null) return cur;
  for (const child of newNode.children) {
    cur = insertNewNodeAt(cur, child, newId, allocator);
  }
  return cur;
}

export function handleInsertNode(
  editor: EditorState,
  newNode: NewNode,
  _position: Position | undefined,
  config: EditorConfig,
): EditorState {
  const newState = insertNewNodeAt(
    editor.state,
    newNode,
    editor.state.rootId,
    productionAllocator,
  );
  editor.history.setState(newState);
  editor.history.push({ selection: editor.selection });
  return rebuildTrees(
    { ...editor, state: newState },
    editor,
    config,
  );
}
