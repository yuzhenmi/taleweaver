import type { StateNode } from "../../state/state-node";
import type { EditorState, EditorConfig } from "../editor-state";
import { pushEditorChange } from "../editor-state";
import { createCursor } from "../../cursor/selection";
import { createNode } from "../../state/create-node";
import { rebuildTrees } from "./helpers";

export function handleToggleList(
  editor: EditorState,
  listType: "ordered" | "unordered",
  config: EditorConfig,
): EditorState {
  const pos = editor.selection.focus;
  const paraIdx = pos.path[0];
  const currentBlock = editor.state.children[paraIdx];
  if (!currentBlock) return editor;

  // If already in a list, unwrap
  if (currentBlock.type === "list") {
    // Extract list items as paragraphs
    const newChildren = [...editor.state.children];
    const listItems = currentBlock.children;
    const paragraphs: StateNode[] = [];

    for (const item of listItems) {
      const para = createNode(
        item.id,
        "paragraph",
        {},
        item.children,
      );
      paragraphs.push(para);
    }

    newChildren.splice(paraIdx, 1, ...paragraphs);
    const newDoc = createNode(
      editor.state.id,
      editor.state.type,
      { ...editor.state.properties },
      newChildren,
    );
    const change = { oldState: editor.state, newState: newDoc, timestamp: 0 };

    // Adjust selection path — cursor was at [paraIdx, itemIdx, textIdx...], now [paraIdx + itemIdx, textIdx...]
    const itemIdx = pos.path[1] ?? 0;
    const newSelection = createCursor([paraIdx + itemIdx, ...pos.path.slice(2)], pos.offset);

    return rebuildTrees(
      {
        ...editor,
        state: newDoc,
        selection: newSelection,
        history: pushEditorChange(editor.history, {
          change,
          selectionBefore: editor.selection,
          selectionAfter: newSelection,
        }),
      },
      editor,
      config,
    );
  }

  // Wrap current paragraph in a list
  const listItem = createNode(
    `li-${editor.nextId}`,
    "list-item",
    {},
    currentBlock.children,
  );
  const list = createNode(
    `list-${editor.nextId}`,
    "list",
    { listType },
    [listItem],
  );

  const newChildren = [...editor.state.children];
  newChildren[paraIdx] = list;
  const newDoc = createNode(
    editor.state.id,
    editor.state.type,
    { ...editor.state.properties },
    newChildren,
  );
  const change = { oldState: editor.state, newState: newDoc, timestamp: 0 };

  // Selection path changes: [paraIdx, textIdx] → [paraIdx, 0, textIdx]
  const textPathRest = pos.path.slice(1);
  const newSelection = createCursor([paraIdx, 0, ...textPathRest], pos.offset);

  return rebuildTrees(
    {
      ...editor,
      state: newDoc,
      selection: newSelection,
      history: pushEditorChange(editor.history, {
        change,
        selectionBefore: editor.selection,
        selectionAfter: newSelection,
      }),
      nextId: editor.nextId + 1,
    },
    editor,
    config,
  );
}
