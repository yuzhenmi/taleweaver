import { describe, it, expect } from "vitest";
import { config, createInitialEditorState, reduceEditor, createPosition, createSpan } from "./test-helpers";
import type { EditorState } from "../editor-state";
import { getBlock, getChildIds } from "../../state";
import type { BlockId, BlockInit, State } from "../../state";

/** A 2×2 table BlockInit (50/50 columns), each cell holding one empty paragraph. */
function tableInit(): BlockInit {
  const cell = (): BlockInit => ({
    type: "table-cell",
    children: [{ type: "paragraph", inlineContent: { items: [] } }],
  });
  const row = (): BlockInit => ({ type: "table-row", children: [cell(), cell()] });
  return { type: "table", attrs: { columnWidths: [0.5, 0.5] }, children: [row(), row()] };
}

/** Insert a 2×2 table into a fresh editor and return it. */
function editorWithTable(): EditorState {
  const editor = createInitialEditorState(config);
  return reduceEditor(editor, { type: "INSERT_NODE", node: tableInit() }, config);
}

/** Find the table block id (first table under the doc root, depth-first by child order). */
function findTableId(state: State): BlockId {
  for (const id of getChildIds(state, state.rootId)) {
    if (getBlock(state, id)?.type === "table") return id;
  }
  throw new Error("no table in state");
}

/** The first paragraph inside the table's first cell. */
function firstCellParagraph(state: State, tableId: BlockId): BlockId {
  const row0 = getChildIds(state, tableId)[0];
  const cellA = getChildIds(state, row0)[0];
  const para = getBlock(state, cellA)?.firstChildId;
  if (para == null) throw new Error("no paragraph in first cell");
  return para;
}

const selectInto = (editor: EditorState, blockId: BlockId): EditorState => {
  const caret = createPosition(blockId, 0);
  return reduceEditor(editor, { type: "SET_SELECTION", selection: createSpan(caret, caret) }, config);
};

describe("handleInsertTableRow — INSERT_TABLE_ROW (P15a.S2)", () => {
  it("no-ops (same editor ref) when the caret is not inside a table", () => {
    const editor = createInitialEditorState(config); // caret in a plain paragraph
    const next = reduceEditor(editor, { type: "INSERT_TABLE_ROW", position: "below" }, config);
    expect(next).toBe(editor);
  });

  it("no-ops on a ragged table (hasSpans boundary → defer to P15b)", () => {
    // row0 has 2 cells, row1 has 1 cell → resolveTableContext.hasSpans = true.
    const cell = (): BlockInit => ({ type: "table-cell", children: [{ type: "paragraph", inlineContent: { items: [] } }] });
    const ragged: BlockInit = {
      type: "table",
      attrs: { columnWidths: [0.5, 0.5] },
      children: [
        { type: "table-row", children: [cell(), cell()] },
        { type: "table-row", children: [cell()] },
      ],
    };
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_NODE", node: ragged }, config);
    const tableId = findTableId(editor.state);
    editor = selectInto(editor, firstCellParagraph(editor.state, tableId));

    const next = reduceEditor(editor, { type: "INSERT_TABLE_ROW", position: "below" }, config);
    expect(next).toBe(editor);
  });

  it("inserts a row below the caret's row; the table grows from 2 to 3 rows", () => {
    let editor = editorWithTable();
    const tableId = findTableId(editor.state);
    editor = selectInto(editor, firstCellParagraph(editor.state, tableId));
    const before = createSpan(editor.selection.anchor, editor.selection.focus);

    const next = reduceEditor(editor, { type: "INSERT_TABLE_ROW", position: "below" }, config);

    const rows = getChildIds(next.state, tableId);
    expect(rows.length).toBe(3);
    // the new row is the second one (below row 0), with 2 cells each holding a paragraph
    const newRow = rows[1];
    const cells = getChildIds(next.state, newRow);
    expect(cells.length).toBe(2);
    expect(getBlock(next.state, cells[0])?.type).toBe("table-cell");
    const p = getBlock(next.state, cells[0])?.firstChildId;
    expect(p != null && getBlock(next.state, p)?.type).toBe("paragraph");

    // selection unchanged (Google Docs keeps the caret in place on insert-row)
    expect(next.selection).toEqual(before);
  });

  it("inserts a row above; one undo entry restores the 2-row table", () => {
    let editor = editorWithTable();
    const tableId = findTableId(editor.state);
    editor = selectInto(editor, firstCellParagraph(editor.state, tableId));

    const inserted = reduceEditor(editor, { type: "INSERT_TABLE_ROW", position: "above" }, config);
    expect(getChildIds(inserted.state, tableId).length).toBe(3);

    const undone = reduceEditor(inserted, { type: "UNDO" }, config);
    expect(getChildIds(undone.state, tableId).length).toBe(2);
  });
});
