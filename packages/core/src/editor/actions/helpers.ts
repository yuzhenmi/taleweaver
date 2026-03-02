import type { StateNode } from "../../state/state-node";
import type { Position } from "../../state/position";
import type { EditorState, EditorConfig } from "../editor-state";
import { pushEditorChange } from "../editor-state";
import { renderTreeIncremental } from "../../render/render";
import { layoutTreeIncremental } from "../../layout/layout-engine";
import { createCursor } from "../../cursor/selection";
import { normalizeSpan, pathsEqual } from "../../state/position";
import { deleteRange } from "../../state/transformations";
import { getNodeByPath } from "../../state/operations";
import { getTextContentLength } from "../../state/text-utils";

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

/**
 * Check if the cursor is at the start or end boundary of a table cell.
 * Returns true if the cursor is at the first/last text position in a cell,
 * which should prevent cross-cell deletion.
 */
export function isAtCellBoundary(
  state: StateNode,
  pos: Position,
  boundary: "start" | "end",
): boolean {
  // Find if there's a table-cell ancestor in the path
  // Path structure for table: [tableIdx, rowIdx, cellIdx, paraIdx, textIdx]
  // We need to check if path[0] points to a table node
  const topBlock = state.children[pos.path[0]];
  if (!topBlock || topBlock.type !== "table") return false;

  // Must have at least 5 path elements for table > row > cell > para > text
  if (pos.path.length < 5) return false;

  const cellPath = pos.path.slice(0, 3); // [tableIdx, rowIdx, cellIdx]
  const cell = getNodeByPath(state, cellPath);
  if (!cell || cell.type !== "table-cell") return false;

  if (boundary === "start") {
    const firstText = findFirstTextDescendant(cell, [...cellPath]);
    if (!firstText) return false;
    return pathsEqual(pos.path, firstText.path) && pos.offset === 0;
  } else {
    const lastText = findLastTextDescendant(cell, [...cellPath]);
    if (!lastText) return false;
    const textLen = getTextContentLength(lastText.node);
    return pathsEqual(pos.path, lastText.path) && pos.offset === textLen;
  }
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
