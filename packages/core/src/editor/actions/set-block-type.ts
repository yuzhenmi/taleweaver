import type { EditorState, EditorConfig } from "../editor-state";
import { pushEditorChange } from "../editor-state";
import { createNode } from "../../state/create-node-legacy";
import { updateAtPath } from "../../state/operations-legacy";
import { rebuildTrees } from "./helpers";

export function handleSetBlockType(
  editor: EditorState,
  blockType: string,
  properties: Record<string, unknown>,
  config: EditorConfig,
): EditorState {
  const pos = editor.selection.focus;
  const paraIdx = pos.path[0];
  const para = editor.stateLegacy.children[paraIdx];
  if (!para) return editor;

  // If already this type, convert back to paragraph
  const newType = para.type === blockType ? "paragraph" : blockType;
  const newProps = para.type === blockType ? {} : properties;

  const newPara = createNode(
    para.id,
    newType,
    { ...newProps },
    para.children,
  );
  const newState = updateAtPath(editor.stateLegacy, [paraIdx], newPara);
  const change = { oldState: editor.stateLegacy, newState, timestamp: 0 };

  return rebuildTrees(
    {
      ...editor,
      stateLegacy: newState,
      historyLegacy: pushEditorChange(editor.historyLegacy, {
        change,
        selectionBefore: editor.selection,
        selectionAfter: editor.selection,
      }),
    },
    editor,
    config,
  );
}
