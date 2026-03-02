import type { EditorState, EditorConfig } from "../editor-state";
import { pushEditorChange } from "../editor-state";
import { createCursor, isCollapsed } from "../../cursor/selection";
import { splitNode } from "../../state/transformations";
import { createNode, createTextNode } from "../../state/create-node";
import { rebuildTrees, deleteSelectionRange, findFirstTextDescendant } from "./helpers";

export function handleInsertTable(
  editor: EditorState,
  rows: number,
  columns: number,
  columnWidths: number[] | undefined,
  config: EditorConfig,
): EditorState {
  // If selection is expanded, delete selection first
  let current = editor;
  if (!isCollapsed(editor.selection)) {
    current = deleteSelectionRange(editor, config);
  }

  const pos = current.selection.focus;
  const paraIdx = pos.path[0];

  // Split current paragraph at cursor
  const nodeId = `node-${current.nextId}`;
  const change = splitNode(current.state, pos, nodeId, 0);

  let nextId = current.nextId + 1;

  // Default columnWidths: evenly split across container width
  const resolvedColumnWidths = columnWidths ?? Array.from(
    { length: columns },
    () => Math.floor(current.containerWidth / columns),
  );

  // Build table state tree: table > rows > cells > paragraph > text
  const tableRows = [];
  for (let r = 0; r < rows; r++) {
    const cells = [];
    for (let c = 0; c < columns; c++) {
      const textNode = createTextNode(`node-${nextId}-t`, "");
      nextId++;
      const para = createNode(`node-${nextId}-p`, "paragraph", {}, [textNode]);
      nextId++;
      const cell = createNode(`node-${nextId}-c`, "table-cell", {}, [para]);
      nextId++;
      cells.push(cell);
    }
    const row = createNode(`node-${nextId}-r`, "table-row", {}, cells);
    nextId++;
    tableRows.push(row);
  }

  const tableNode = createNode(`node-${nextId}-table`, "table", {
    columnWidths: resolvedColumnWidths,
    rowHeights: Array.from({ length: rows }, () => 0),
  }, tableRows);
  nextId++;

  // Insert table between the two split halves
  const docChildren = [...change.newState.children];
  docChildren.splice(paraIdx + 1, 0, tableNode);

  const newDoc = createNode(
    change.newState.id,
    change.newState.type,
    { ...change.newState.properties },
    docChildren,
  );

  // Cursor → first text in first cell: [paraIdx + 1, 0, 0, 0, 0]
  const tableInDoc = newDoc.children[paraIdx + 1];
  const firstText = findFirstTextDescendant(tableInDoc, [paraIdx + 1]);
  const newSelection = firstText
    ? createCursor(firstText.path, 0)
    : createCursor([paraIdx + 1, 0, 0, 0, 0], 0);

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
      nextId,
    },
    current,
    config,
  );
}
