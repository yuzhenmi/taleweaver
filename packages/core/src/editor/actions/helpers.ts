import type { StateNode } from "../../state/state-node";
import type { EditorState, EditorConfig } from "../editor-state";
import { pushEditorChange } from "../editor-state";
import { renderTreeIncremental } from "../../render/render";
import { layoutTreeIncremental } from "../../layout/layout-engine";
import { createCursor } from "../../cursor/selection";
import { normalizeSpan } from "../../state/position";
import { deleteRange } from "../../state/transformations";

/** Find the last text node descendant of a node at the given base path. */
export function findLastTextDescendant(
  node: StateNode,
  basePath: number[],
): { path: number[]; node: StateNode } | null {
  if (node.type === "text") return { path: basePath, node };
  for (let i = node.children.length - 1; i >= 0; i--) {
    const result = findLastTextDescendant(node.children[i], [...basePath, i]);
    if (result) return result;
  }
  return null;
}

/** Find the first text node descendant of a node at the given base path. */
export function findFirstTextDescendant(
  node: StateNode,
  basePath: number[],
): { path: number[]; node: StateNode } | null {
  if (node.type === "text") return { path: basePath, node };
  for (let i = 0; i < node.children.length; i++) {
    const result = findFirstTextDescendant(node.children[i], [...basePath, i]);
    if (result) return result;
  }
  return null;
}

export function rebuildTrees(
  newEditor: EditorState,
  oldEditor: EditorState,
  config: EditorConfig,
): EditorState {
  const newRender = renderTreeIncremental(
    newEditor.state,
    oldEditor.state,
    oldEditor.renderTree,
    config.registry,
  );
  const newLayout = layoutTreeIncremental(
    newRender,
    oldEditor.renderTree,
    oldEditor.layoutTree,
    newEditor.containerWidth,
    config.measurer,
    config.pageHeight,
    config.pageMargins,
  );

  return {
    ...newEditor,
    renderTree: newRender,
    layoutTree: newLayout,
  };
}

export function deleteSelectionRange(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  const normalized = normalizeSpan(editor.selection);
  const change = deleteRange(editor.state, normalized);
  const newSelection = createCursor(
    normalized.anchor.path,
    normalized.anchor.offset,
  );

  return rebuildTrees(
    {
      ...editor,
      state: change.newState,
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
