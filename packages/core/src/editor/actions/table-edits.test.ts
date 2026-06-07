import { describe, it, expect } from "vitest";
import { config, createInitialEditorState, reduceEditor, createPosition, createSpan } from "./test-helpers";
import { createEditorStateFromState } from "../editor-state";
import type { EditorState } from "../editor-state";
import { buildBlock, buildState, inlineContent } from "../../test-utils/state-builders";
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

/** The first paragraph inside the cell at [row r, column c] of the table. */
function cellParagraph(state: State, tableId: BlockId, r: number, c: number): BlockId {
  const row = getChildIds(state, tableId)[r];
  const cell = getChildIds(state, row)[c];
  const para = getBlock(state, cell)?.firstChildId;
  if (para == null) throw new Error(`no paragraph in cell [${r}, ${c}]`);
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

describe("handleDeleteTable — DELETE_TABLE (P15a.S3)", () => {
  it("no-ops (same editor ref) when the caret is not inside a table", () => {
    const editor = createInitialEditorState(config);
    const next = reduceEditor(editor, { type: "DELETE_TABLE" }, config);
    expect(next).toBe(editor);
  });

  it("deletes the whole table; caret lands on the surviving sibling", () => {
    // editorWithTable → doc has [seeded empty paragraph, table]; table's prev is
    // that paragraph, so deleting it is the plain-removal path (no replacement).
    let editor = editorWithTable();
    const tableId = findTableId(editor.state);
    const seededPara = getBlock(editor.state, editor.state.rootId)?.firstChildId ?? null;
    editor = selectInto(editor, firstCellParagraph(editor.state, tableId));

    const next = reduceEditor(editor, { type: "DELETE_TABLE" }, config);
    expect(getBlock(next.state, tableId)).toBeNull();
    // caret moved to the surviving sibling (the seeded paragraph, table's prev)
    expect(next.selection.focus.blockId).toBe(seededPara);
  });

  it("is span-agnostic: deletes a spanned table (NOT gated on hasSpans)", () => {
    const cell = (attrs?: Record<string, unknown>): BlockInit => ({
      type: "table-cell", attrs, children: [{ type: "paragraph", inlineContent: { items: [] } }],
    });
    const spanned: BlockInit = {
      type: "table", attrs: { columnWidths: [0.5, 0.5] },
      children: [{ type: "table-row", children: [cell({ colSpan: 2 })] }],
    };
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_NODE", node: spanned }, config);
    const tableId = findTableId(editor.state);
    editor = selectInto(editor, firstCellParagraph(editor.state, tableId));

    const next = reduceEditor(editor, { type: "DELETE_TABLE" }, config);
    expect(next).not.toBe(editor);
    expect(getBlock(next.state, tableId)).toBeNull();
  });

  it("one undo entry restores the table", () => {
    let editor = editorWithTable();
    const tableId = findTableId(editor.state);
    editor = selectInto(editor, firstCellParagraph(editor.state, tableId));
    const deleted = reduceEditor(editor, { type: "DELETE_TABLE" }, config);
    expect(getBlock(deleted.state, tableId)).toBeNull();
    const undone = reduceEditor(deleted, { type: "UNDO" }, config);
    expect(getBlock(undone.state, tableId)?.type).toBe("table");
  });

  it("sole-child table → caret lands on the fresh replacement paragraph", () => {
    // A document whose ONLY child is a 1×1 table (no seeded sibling paragraph).
    // Deleting it must leave a fresh empty paragraph and place the caret there:
    // the handler's `caretBlockId = result.newParagraphId ?? siblingId` branch
    // where newParagraphId !== null (no surviving sibling to fall back to).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
        buildBlock({ id: "table", type: "table", attrs: { columnWidths: [1] }, parentId: "doc", firstChildId: "row", lastChildId: "row" }),
        buildBlock({ id: "row", type: "table-row", parentId: "table", firstChildId: "cell", lastChildId: "cell" }),
        buildBlock({ id: "cell", type: "table-cell", parentId: "row", firstChildId: "cp", lastChildId: "cp" }),
        buildBlock({ id: "cp", type: "paragraph", parentId: "cell", inlineContent: inlineContent([]) }),
      ],
    });
    const caret = createPosition("cp" as BlockId, 0);
    const editor = createEditorStateFromState(state, createSpan(caret, caret), config);

    const next = reduceEditor(editor, { type: "DELETE_TABLE" }, config);

    // table subtree gone; the body has exactly one replacement paragraph
    expect(getBlock(next.state, "table" as BlockId)).toBeNull();
    const bodyChildren = getChildIds(next.state, next.state.rootId);
    expect(bodyChildren.length).toBe(1);
    const replacement = bodyChildren[0];
    expect(getBlock(next.state, replacement)?.type).toBe("paragraph");
    // caret landed on the fresh replacement paragraph (no sibling fallback)
    expect(next.selection.focus.blockId).toBe(replacement);
  });
});

describe("handleDeleteTableRow — DELETE_TABLE_ROW (P15a.S4)", () => {
  /** A 1×2 single-row table BlockInit (one row, two cells). */
  function oneRowTableInit(): BlockInit {
    const cell = (): BlockInit => ({
      type: "table-cell",
      children: [{ type: "paragraph", inlineContent: { items: [] } }],
    });
    return { type: "table", attrs: { columnWidths: [0.5, 0.5] }, children: [{ type: "table-row", children: [cell(), cell()] }] };
  }

  it("no-ops (same editor ref) when the caret is not inside a table", () => {
    const editor = createInitialEditorState(config);
    const next = reduceEditor(editor, { type: "DELETE_TABLE_ROW" }, config);
    expect(next).toBe(editor);
  });

  it("no-ops on a ragged table (hasSpans boundary → defer to P15b)", () => {
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

    const next = reduceEditor(editor, { type: "DELETE_TABLE_ROW" }, config);
    expect(next).toBe(editor);
  });

  it("deletes the caret's row; caret moves to the same column in the NEXT row", () => {
    let editor = editorWithTable(); // 2×2
    const tableId = findTableId(editor.state);
    // caret in row 0, column 0; the next row's column-0 paragraph survives.
    const survivingTarget = cellParagraph(editor.state, tableId, 1, 0);
    editor = selectInto(editor, cellParagraph(editor.state, tableId, 0, 0));

    const next = reduceEditor(editor, { type: "DELETE_TABLE_ROW" }, config);

    expect(getChildIds(next.state, tableId).length).toBe(1);
    expect(next.selection.focus.blockId).toBe(survivingTarget);
  });

  it("deleting the LAST row moves the caret to the same column in the PREVIOUS row", () => {
    let editor = editorWithTable(); // 2×2
    const tableId = findTableId(editor.state);
    // caret in row 1 (last), column 1; the previous row's column-1 paragraph survives.
    const survivingTarget = cellParagraph(editor.state, tableId, 0, 1);
    editor = selectInto(editor, cellParagraph(editor.state, tableId, 1, 1));

    const next = reduceEditor(editor, { type: "DELETE_TABLE_ROW" }, config);

    expect(getChildIds(next.state, tableId).length).toBe(1);
    expect(next.selection.focus.blockId).toBe(survivingTarget);
  });

  it("deleting the ONLY row collapses the whole table; caret → surviving sibling", () => {
    // editorWithTable seeds a sibling paragraph before the table, so a 1-row
    // table collapse is the plain-removal path (caret → that sibling).
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_NODE", node: oneRowTableInit() }, config);
    const tableId = findTableId(editor.state);
    const seededPara = getBlock(editor.state, editor.state.rootId)?.firstChildId ?? null;
    editor = selectInto(editor, firstCellParagraph(editor.state, tableId));

    const next = reduceEditor(editor, { type: "DELETE_TABLE_ROW" }, config);

    expect(getBlock(next.state, tableId)).toBeNull();
    expect(next.selection.focus.blockId).toBe(seededPara);
  });

  it("deleting the only row of a sole-child table → fresh replacement paragraph", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
        buildBlock({ id: "table", type: "table", attrs: { columnWidths: [1] }, parentId: "doc", firstChildId: "row", lastChildId: "row" }),
        buildBlock({ id: "row", type: "table-row", parentId: "table", firstChildId: "cell", lastChildId: "cell" }),
        buildBlock({ id: "cell", type: "table-cell", parentId: "row", firstChildId: "cp", lastChildId: "cp" }),
        buildBlock({ id: "cp", type: "paragraph", parentId: "cell", inlineContent: inlineContent([]) }),
      ],
    });
    const caret = createPosition("cp" as BlockId, 0);
    const editor = createEditorStateFromState(state, createSpan(caret, caret), config);

    const next = reduceEditor(editor, { type: "DELETE_TABLE_ROW" }, config);

    expect(getBlock(next.state, "table" as BlockId)).toBeNull();
    const bodyChildren = getChildIds(next.state, next.state.rootId);
    expect(bodyChildren.length).toBe(1);
    expect(getBlock(next.state, bodyChildren[0])?.type).toBe("paragraph");
    expect(next.selection.focus.blockId).toBe(bodyChildren[0]);
  });

  it("one undo entry restores the deleted row", () => {
    let editor = editorWithTable();
    const tableId = findTableId(editor.state);
    editor = selectInto(editor, cellParagraph(editor.state, tableId, 0, 0));

    const deleted = reduceEditor(editor, { type: "DELETE_TABLE_ROW" }, config);
    expect(getChildIds(deleted.state, tableId).length).toBe(1);

    const undone = reduceEditor(deleted, { type: "UNDO" }, config);
    expect(getChildIds(undone.state, tableId).length).toBe(2);
  });
});

describe("handleInsertTableColumn — INSERT_TABLE_COLUMN (P15a.S5)", () => {
  it("no-ops (same editor ref) when the caret is not inside a table", () => {
    const editor = createInitialEditorState(config);
    const next = reduceEditor(editor, { type: "INSERT_TABLE_COLUMN", position: "right" }, config);
    expect(next).toBe(editor);
  });

  it("no-ops on a ragged table (hasSpans boundary → defer to P15b)", () => {
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

    const next = reduceEditor(editor, { type: "INSERT_TABLE_COLUMN", position: "right" }, config);
    expect(next).toBe(editor);
  });

  it("inserts a column right of the caret's column in every row; caret unchanged", () => {
    let editor = editorWithTable(); // 2×2
    const tableId = findTableId(editor.state);
    editor = selectInto(editor, cellParagraph(editor.state, tableId, 0, 0));
    const before = createSpan(editor.selection.anchor, editor.selection.focus);

    const next = reduceEditor(editor, { type: "INSERT_TABLE_COLUMN", position: "right" }, config);

    // every row grew 2 → 3 cells
    for (const rowId of getChildIds(next.state, tableId)) {
      expect(getChildIds(next.state, rowId).length).toBe(3);
    }
    // Google Docs keeps the cursor in its current cell on insert-column.
    expect(next.selection).toEqual(before);
  });

  it("one undo entry reverts BOTH the new cells AND the columnWidths (C1/D4 atomicity)", () => {
    let editor = editorWithTable(); // 2×2, columnWidths [0.5, 0.5]
    const tableId = findTableId(editor.state);
    editor = selectInto(editor, cellParagraph(editor.state, tableId, 0, 0));

    const inserted = reduceEditor(editor, { type: "INSERT_TABLE_COLUMN", position: "left" }, config);
    // cells grew and columnWidths re-spliced to 3 entries
    expect(getChildIds(inserted.state, getChildIds(inserted.state, tableId)[0]).length).toBe(3);
    expect((getBlock(inserted.state, tableId)?.attrs.columnWidths as number[]).length).toBe(3);

    // ONE undo reverts both dimensions together (single transaction → single entry)
    const undone = reduceEditor(inserted, { type: "UNDO" }, config);
    expect(getChildIds(undone.state, getChildIds(undone.state, tableId)[0]).length).toBe(2);
    expect(getBlock(undone.state, tableId)?.attrs.columnWidths).toEqual([0.5, 0.5]);
  });
});

describe("handleDeleteTableColumn — DELETE_TABLE_COLUMN (P15a.S6)", () => {
  /** A 1×2 single-row table BlockInit (one row, two columns). */
  function oneRowTableInit(): BlockInit {
    const cell = (): BlockInit => ({
      type: "table-cell",
      children: [{ type: "paragraph", inlineContent: { items: [] } }],
    });
    return { type: "table", attrs: { columnWidths: [0.5, 0.5] }, children: [{ type: "table-row", children: [cell(), cell()] }] };
  }

  it("no-ops (same editor ref) when the caret is not inside a table", () => {
    const editor = createInitialEditorState(config);
    const next = reduceEditor(editor, { type: "DELETE_TABLE_COLUMN" }, config);
    expect(next).toBe(editor);
  });

  it("no-ops on a ragged table (hasSpans boundary → defer to P15b)", () => {
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

    const next = reduceEditor(editor, { type: "DELETE_TABLE_COLUMN" }, config);
    expect(next).toBe(editor);
  });

  it("deletes the caret's column; caret moves to the same row's NEXT column", () => {
    let editor = editorWithTable(); // 2×2
    const tableId = findTableId(editor.state);
    // caret in row 0, column 0; the same row's column-1 cell survives.
    const survivingTarget = cellParagraph(editor.state, tableId, 0, 1);
    editor = selectInto(editor, cellParagraph(editor.state, tableId, 0, 0));

    const next = reduceEditor(editor, { type: "DELETE_TABLE_COLUMN" }, config);

    for (const rowId of getChildIds(next.state, tableId)) {
      expect(getChildIds(next.state, rowId).length).toBe(1);
    }
    expect(next.selection.focus.blockId).toBe(survivingTarget);
  });

  it("deleting the LAST column moves the caret to the same row's PREVIOUS column", () => {
    let editor = editorWithTable(); // 2×2
    const tableId = findTableId(editor.state);
    // caret in row 1, column 1 (last); the same row's column-0 cell survives.
    const survivingTarget = cellParagraph(editor.state, tableId, 1, 0);
    editor = selectInto(editor, cellParagraph(editor.state, tableId, 1, 1));

    const next = reduceEditor(editor, { type: "DELETE_TABLE_COLUMN" }, config);

    for (const rowId of getChildIds(next.state, tableId)) {
      expect(getChildIds(next.state, rowId).length).toBe(1);
    }
    expect(next.selection.focus.blockId).toBe(survivingTarget);
  });

  it("deleting the ONLY column collapses the whole table; caret → surviving sibling", () => {
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_NODE", node: oneRowTableInit() }, config);
    let tableId = findTableId(editor.state);
    const seededPara = getBlock(editor.state, editor.state.rootId)?.firstChildId ?? null;
    // Delete column 0, then column 0 again: the second delete is on a 1-column
    // table → collapses the whole table.
    editor = selectInto(editor, firstCellParagraph(editor.state, tableId));
    editor = reduceEditor(editor, { type: "DELETE_TABLE_COLUMN" }, config);
    tableId = findTableId(editor.state);
    editor = selectInto(editor, firstCellParagraph(editor.state, tableId));

    const next = reduceEditor(editor, { type: "DELETE_TABLE_COLUMN" }, config);

    expect(getBlock(next.state, tableId)).toBeNull();
    expect(next.selection.focus.blockId).toBe(seededPara);
  });

  it("one undo entry restores BOTH the deleted column AND the columnWidths", () => {
    let editor = editorWithTable(); // 2×2, columnWidths [0.5, 0.5]
    const tableId = findTableId(editor.state);
    editor = selectInto(editor, cellParagraph(editor.state, tableId, 0, 0));

    const deleted = reduceEditor(editor, { type: "DELETE_TABLE_COLUMN" }, config);
    expect(getChildIds(deleted.state, getChildIds(deleted.state, tableId)[0]).length).toBe(1);
    expect(getBlock(deleted.state, tableId)?.attrs.columnWidths).toEqual([1]);

    const undone = reduceEditor(deleted, { type: "UNDO" }, config);
    expect(getChildIds(undone.state, getChildIds(undone.state, tableId)[0]).length).toBe(2);
    expect(getBlock(undone.state, tableId)?.attrs.columnWidths).toEqual([0.5, 0.5]);
  });
});
