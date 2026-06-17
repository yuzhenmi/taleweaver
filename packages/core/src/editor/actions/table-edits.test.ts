import { describe, it, expect } from "vitest";
import { config, createInitialEditorState, reduceEditor, createPosition, createSpan } from "./test-helpers";
import { createEditorStateFromState } from "../editor-state";
import type { EditorState } from "../editor-state";
import { buildBlock, buildState, inlineContent } from "../../test-utils/state-builders";
import { getBlock, getChildIds } from "../../state";
import type { BlockId, BlockInit, State } from "../../state";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

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
  const row0 = nth(getChildIds(state, tableId), 0, "row");
  const cellA = nth(getChildIds(state, row0), 0, "cell");
  const para = getBlock(state, cellA)?.firstChildId;
  if (para == null) throw new Error("no paragraph in first cell");
  return para;
}

/** The first paragraph inside the cell at [row r, column c] of the table. */
function cellParagraph(state: State, tableId: BlockId, r: number, c: number): BlockId {
  const row = nth(getChildIds(state, tableId), r, "row");
  const cell = nth(getChildIds(state, row), c, "cell");
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

  it("no-ops on a ragged table (the degenerate carve-out — ctx.ragged gate)", () => {
    // row0 has 2 cells, row1 has 1 cell → a grid hole → resolveTableContext.ragged = true.
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
    const newRow = nth(rows, 1, "row");
    const cells = getChildIds(next.state, newRow);
    expect(cells.length).toBe(2);
    const cell0 = nth(cells, 0, "cell");
    expect(getBlock(next.state, cell0)?.type).toBe("table-cell");
    const p = getBlock(next.state, cell0)?.firstChildId;
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

  it("routes a WELL-FORMED SPANNED table to the span-aware op (P15b): a crossing rowSpan grows", () => {
    // row0=[A(rowSpan 2), B], row1=[C] → occupancy [[A,B],[A,C]]. Caret in B; insert
    // below → A crosses the new boundary → A.rowSpan 2→3. (The old hasSpans gate
    // would have no-op'd this; the new ragged-only gate routes to span-aware insert.)
    const blocks = [
      buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
      buildBlock({ id: "table", type: "table", parentId: "doc", firstChildId: "r0", lastChildId: "r1" }),
      buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "A", lastChildId: "B" }),
      buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", firstChildId: "C", lastChildId: "C" }),
      buildBlock({ id: "A", type: "table-cell", parentId: "r0", attrs: { rowSpan: 2 }, nextSiblingId: "B", firstChildId: "Ap", lastChildId: "Ap" }),
      buildBlock({ id: "Ap", type: "paragraph", parentId: "A", inlineContent: inlineContent([]) }),
      buildBlock({ id: "B", type: "table-cell", parentId: "r0", prevSiblingId: "A", firstChildId: "Bp", lastChildId: "Bp" }),
      buildBlock({ id: "Bp", type: "paragraph", parentId: "B", inlineContent: inlineContent([]) }),
      buildBlock({ id: "C", type: "table-cell", parentId: "r1", firstChildId: "Cp", lastChildId: "Cp" }),
      buildBlock({ id: "Cp", type: "paragraph", parentId: "C", inlineContent: inlineContent([]) }),
    ];
    const state = buildState({ rootId: "doc", blocks });
    const caret = createPosition("Bp" as BlockId, 0);
    let editor = createEditorStateFromState(state, createSpan(caret, caret), config);

    const next = reduceEditor(editor, { type: "INSERT_TABLE_ROW", position: "below" }, config);
    expect(next).not.toBe(editor);
    expect(getBlock(next.state, "A" as BlockId)?.attrs.rowSpan).toBe(3);
    expect(getChildIds(next.state, "table" as BlockId).length).toBe(3);
    expect(next.selection.focus.blockId).toBe("Bp"); // selection unchanged
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
    const replacement = nth(bodyChildren, 0, "block");
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

  it("no-ops on a ragged table (the degenerate carve-out — ctx.ragged gate)", () => {
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

  it("routes a WELL-FORMED SPANNED table to the span-aware op (P15b): a covering rowSpan shrinks + caret lands", () => {
    // row0=[A(rowSpan 2), B], row1=[C] → occupancy [[A,B],[A,C]]. Caret in C (row 1);
    // delete row1 → A covering-shrinks to rowSpan 1; caret → the cell now in C's
    // column at the row that took row1's place = the previous row (row1 was last) =
    // B's column-1 slot, i.e. B's first paragraph.
    const blocks = [
      buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
      buildBlock({ id: "table", type: "table", parentId: "doc", firstChildId: "r0", lastChildId: "r1" }),
      buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "A", lastChildId: "B" }),
      buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", firstChildId: "C", lastChildId: "C" }),
      buildBlock({ id: "A", type: "table-cell", parentId: "r0", attrs: { rowSpan: 2 }, nextSiblingId: "B", firstChildId: "Ap", lastChildId: "Ap" }),
      buildBlock({ id: "Ap", type: "paragraph", parentId: "A", inlineContent: inlineContent([]) }),
      buildBlock({ id: "B", type: "table-cell", parentId: "r0", prevSiblingId: "A", firstChildId: "Bp", lastChildId: "Bp" }),
      buildBlock({ id: "Bp", type: "paragraph", parentId: "B", inlineContent: inlineContent([]) }),
      buildBlock({ id: "C", type: "table-cell", parentId: "r1", firstChildId: "Cp", lastChildId: "Cp" }),
      buildBlock({ id: "Cp", type: "paragraph", parentId: "C", inlineContent: inlineContent([]) }),
    ];
    const state = buildState({ rootId: "doc", blocks });
    const caret = createPosition("Cp" as BlockId, 0);
    const editor = createEditorStateFromState(state, createSpan(caret, caret), config);

    const next = reduceEditor(editor, { type: "DELETE_TABLE_ROW" }, config);
    expect(next).not.toBe(editor);
    expect(getBlock(next.state, "A" as BlockId)?.attrs.rowSpan).toBeUndefined(); // 2→1
    expect(getChildIds(next.state, "table" as BlockId)).toEqual(["r0"]); // row1 gone
    expect(getBlock(next.state, "C" as BlockId)).toBeNull();
    // caret → column 1 of the surviving row (B's first paragraph).
    expect(next.selection.focus.blockId).toBe("Bp");
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
    const body0 = nth(bodyChildren, 0, "block");
    expect(getBlock(next.state, body0)?.type).toBe("paragraph");
    expect(next.selection.focus.blockId).toBe(body0);
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

  it("keeps headerRowCount naming the leading block across a plain row delete (#487)", () => {
    // 3-row single-column PLAIN (no-span) table with headerRowCount=2 (rows 0–1 pinned).
    const hrc = (s: State): unknown => getBlock(s, "table" as BlockId)?.attrs.headerRowCount;
    const plainTable3 = (): State =>
      buildState({
        rootId: "doc",
        blocks: [
          buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
          buildBlock({ id: "table", type: "table", parentId: "doc", attrs: { columnWidths: [1], headerRowCount: 2 }, firstChildId: "r0", lastChildId: "r2" }),
          buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "c0", lastChildId: "c0" }),
          buildBlock({ id: "c0", type: "table-cell", parentId: "r0", firstChildId: "p0", lastChildId: "p0" }),
          buildBlock({ id: "p0", type: "paragraph", parentId: "c0", inlineContent: inlineContent([]) }),
          buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", nextSiblingId: "r2", firstChildId: "c1", lastChildId: "c1" }),
          buildBlock({ id: "c1", type: "table-cell", parentId: "r1", firstChildId: "p1", lastChildId: "p1" }),
          buildBlock({ id: "p1", type: "paragraph", parentId: "c1", inlineContent: inlineContent([]) }),
          buildBlock({ id: "r2", type: "table-row", parentId: "table", prevSiblingId: "r1", firstChildId: "c2", lastChildId: "c2" }),
          buildBlock({ id: "c2", type: "table-cell", parentId: "r2", firstChildId: "p2", lastChildId: "p2" }),
          buildBlock({ id: "p2", type: "paragraph", parentId: "c2", inlineContent: inlineContent([]) }),
        ],
      });

    // Delete row 0 (a header row) → headerRowCount 2 → 1.
    {
      const caret = createPosition("p0" as BlockId, 0);
      const editor = createEditorStateFromState(plainTable3(), createSpan(caret, caret), config);
      const next = reduceEditor(editor, { type: "DELETE_TABLE_ROW" }, config);
      expect(getChildIds(next.state, "table" as BlockId).length).toBe(2);
      expect(hrc(next.state)).toBe(1);
    }

    // Delete a BODY row (row 2) → headerRowCount unchanged at 2.
    {
      const caret = createPosition("p2" as BlockId, 0);
      const editor = createEditorStateFromState(plainTable3(), createSpan(caret, caret), config);
      const next = reduceEditor(editor, { type: "DELETE_TABLE_ROW" }, config);
      expect(hrc(next.state)).toBe(2);
    }
  });

  it("deleting the last header row of a headerRowCount=1 plain table turns the header off (#487)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
        buildBlock({ id: "table", type: "table", parentId: "doc", attrs: { columnWidths: [1], headerRowCount: 1 }, firstChildId: "r0", lastChildId: "r1" }),
        buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "c0", lastChildId: "c0" }),
        buildBlock({ id: "c0", type: "table-cell", parentId: "r0", firstChildId: "p0", lastChildId: "p0" }),
        buildBlock({ id: "p0", type: "paragraph", parentId: "c0", inlineContent: inlineContent([]) }),
        buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", firstChildId: "c1", lastChildId: "c1" }),
        buildBlock({ id: "c1", type: "table-cell", parentId: "r1", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "c1", inlineContent: inlineContent([]) }),
      ],
    });
    const caret = createPosition("p0" as BlockId, 0);
    const editor = createEditorStateFromState(state, createSpan(caret, caret), config);

    const next = reduceEditor(editor, { type: "DELETE_TABLE_ROW" }, config);
    // The last header row removed → header turns OFF (attr dropped, reads as 0/undefined).
    expect(getBlock(next.state, "table" as BlockId)?.attrs.headerRowCount).toBeUndefined();
  });
});

describe("handleInsertTableColumn — INSERT_TABLE_COLUMN (P15a.S5)", () => {
  it("no-ops (same editor ref) when the caret is not inside a table", () => {
    const editor = createInitialEditorState(config);
    const next = reduceEditor(editor, { type: "INSERT_TABLE_COLUMN", position: "right" }, config);
    expect(next).toBe(editor);
  });

  it("no-ops on a ragged table (the degenerate carve-out — ctx.ragged gate)", () => {
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

  it("routes a WELL-FORMED SPANNED table to the span-aware op (P15b): a crossing colSpan grows", () => {
    // row0=[A(colSpan 2)], row1=[C, D] → occupancy [[A,A],[C,D]]. Caret in C; insert
    // right → A crosses the new boundary → A.colSpan 2→3. (The old hasSpans gate would
    // have no-op'd this; the new ragged-only gate routes to span-aware insert-column.)
    const blocks = [
      buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
      buildBlock({ id: "table", type: "table", parentId: "doc", firstChildId: "r0", lastChildId: "r1" }),
      buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "A", lastChildId: "A" }),
      buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", firstChildId: "C", lastChildId: "D" }),
      buildBlock({ id: "A", type: "table-cell", parentId: "r0", attrs: { colSpan: 2 }, firstChildId: "Ap", lastChildId: "Ap" }),
      buildBlock({ id: "Ap", type: "paragraph", parentId: "A", inlineContent: inlineContent([]) }),
      buildBlock({ id: "C", type: "table-cell", parentId: "r1", nextSiblingId: "D", firstChildId: "Cp", lastChildId: "Cp" }),
      buildBlock({ id: "Cp", type: "paragraph", parentId: "C", inlineContent: inlineContent([]) }),
      buildBlock({ id: "D", type: "table-cell", parentId: "r1", prevSiblingId: "C", firstChildId: "Dp", lastChildId: "Dp" }),
      buildBlock({ id: "Dp", type: "paragraph", parentId: "D", inlineContent: inlineContent([]) }),
    ];
    const state = buildState({ rootId: "doc", blocks });
    const caret = createPosition("Cp" as BlockId, 0);
    const editor = createEditorStateFromState(state, createSpan(caret, caret), config);

    const next = reduceEditor(editor, { type: "INSERT_TABLE_COLUMN", position: "right" }, config);
    expect(next).not.toBe(editor);
    expect(getBlock(next.state, "A" as BlockId)?.attrs.colSpan).toBe(3);
    expect(getChildIds(next.state, "r1" as BlockId).length).toBe(3); // C, new, D
    expect(next.selection.focus.blockId).toBe("Cp"); // selection unchanged
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
    expect(getChildIds(inserted.state, nth(getChildIds(inserted.state, tableId), 0, "row")).length).toBe(3);
    expect((getBlock(inserted.state, tableId)?.attrs.columnWidths as number[]).length).toBe(3);

    // ONE undo reverts both dimensions together (single transaction → single entry)
    const undone = reduceEditor(inserted, { type: "UNDO" }, config);
    expect(getChildIds(undone.state, nth(getChildIds(undone.state, tableId), 0, "row")).length).toBe(2);
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

  it("no-ops on a ragged table (the degenerate carve-out — ctx.ragged gate)", () => {
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

  it("routes a WELL-FORMED SPANNED table to the span-aware op (P15b): covering colSpan shrinks, the 1×1 at the deleted column is removed, caret lands", () => {
    // row0=[A(colSpan 2)], row1=[C, D]. occupancy [[A,A],[C,D]]. Caret in D (col 1).
    // Delete col1 → A covering-shrinks to colSpan 1; D removed; caret → the cell now in
    // D's row at the column that took col1's place = the previous column = C.
    const blocks = [
      buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
      buildBlock({ id: "table", type: "table", parentId: "doc", firstChildId: "r0", lastChildId: "r1" }),
      buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "A", lastChildId: "A" }),
      buildBlock({ id: "A", type: "table-cell", parentId: "r0", attrs: { colSpan: 2 }, firstChildId: "Ap", lastChildId: "Ap" }),
      buildBlock({ id: "Ap", type: "paragraph", parentId: "A", inlineContent: inlineContent([]) }),
      buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", firstChildId: "C", lastChildId: "D" }),
      buildBlock({ id: "C", type: "table-cell", parentId: "r1", nextSiblingId: "D", firstChildId: "Cp", lastChildId: "Cp" }),
      buildBlock({ id: "Cp", type: "paragraph", parentId: "C", inlineContent: inlineContent([]) }),
      buildBlock({ id: "D", type: "table-cell", parentId: "r1", prevSiblingId: "C", firstChildId: "Dp", lastChildId: "Dp" }),
      buildBlock({ id: "Dp", type: "paragraph", parentId: "D", inlineContent: inlineContent([]) }),
    ];
    const state = buildState({ rootId: "doc", blocks });
    const caret = createPosition("Dp" as BlockId, 0);
    const editor = createEditorStateFromState(state, createSpan(caret, caret), config);

    const next = reduceEditor(editor, { type: "DELETE_TABLE_COLUMN" }, config);
    expect(next).not.toBe(editor);
    expect(getBlock(next.state, "A" as BlockId)?.attrs.colSpan).toBeUndefined(); // 2→1
    expect(getChildIds(next.state, "table" as BlockId)).toEqual(["r0", "r1"]); // both rows remain
    expect(getBlock(next.state, "D" as BlockId)).toBeNull();
    expect(getChildIds(next.state, "r1" as BlockId)).toEqual(["C"]);
    expect(next.selection.focus.blockId).toBe("Cp");
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
    expect(getChildIds(deleted.state, nth(getChildIds(deleted.state, tableId), 0, "row")).length).toBe(1);
    expect(getBlock(deleted.state, tableId)?.attrs.columnWidths).toEqual([1]);

    const undone = reduceEditor(deleted, { type: "UNDO" }, config);
    expect(getChildIds(undone.state, nth(getChildIds(undone.state, tableId), 0, "row")).length).toBe(2);
    expect(getBlock(undone.state, tableId)?.attrs.columnWidths).toEqual([0.5, 0.5]);
  });
});

describe("handleSplitCell — SPLIT_CELL (P15b.S2)", () => {
  /**
   * A spanned table: row0 = [A(colSpan 2)], row1 = [C, D]. occupancy [[A,A],[C,D]].
   * Built directly (INSERT_NODE can't stamp spans) and wrapped in an editor with
   * the caret in A's paragraph.
   */
  function editorWithSpannedTable(): EditorState {
    const blocks = [
      buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
      buildBlock({ id: "table", type: "table", parentId: "doc", attrs: { columnWidths: [0.5, 0.5] }, firstChildId: "r0", lastChildId: "r1" }),
      buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "A", lastChildId: "A" }),
      buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", firstChildId: "C", lastChildId: "D" }),
      buildBlock({ id: "A", type: "table-cell", parentId: "r0", attrs: { colSpan: 2 }, firstChildId: "Ap", lastChildId: "Ap" }),
      buildBlock({ id: "Ap", type: "paragraph", parentId: "A", inlineContent: inlineContent([]) }),
      buildBlock({ id: "C", type: "table-cell", parentId: "r1", nextSiblingId: "D", firstChildId: "Cp", lastChildId: "Cp" }),
      buildBlock({ id: "Cp", type: "paragraph", parentId: "C", inlineContent: inlineContent([]) }),
      buildBlock({ id: "D", type: "table-cell", parentId: "r1", prevSiblingId: "C", firstChildId: "Dp", lastChildId: "Dp" }),
      buildBlock({ id: "Dp", type: "paragraph", parentId: "D", inlineContent: inlineContent([]) }),
    ];
    const state = buildState({ rootId: "doc", blocks });
    const caret = createPosition("Ap" as BlockId, 0);
    return createEditorStateFromState(state, createSpan(caret, caret), config);
  }

  it("no-ops (same editor ref) when the caret is not inside a table", () => {
    const editor = createInitialEditorState(config);
    const next = reduceEditor(editor, { type: "SPLIT_CELL" }, config);
    expect(next).toBe(editor);
  });

  it("no-ops when the caret cell is a plain 1×1 (nothing to unmerge)", () => {
    let editor = editorWithTable(); // uniform 2×2, no spans
    const tableId = findTableId(editor.state);
    editor = selectInto(editor, firstCellParagraph(editor.state, tableId));
    const next = reduceEditor(editor, { type: "SPLIT_CELL" }, config);
    expect(next).toBe(editor);
  });

  it("no-ops (same editor ref) on a ragged table — the degenerate carve-out (ctx.ragged gate)", () => {
    // row0 = [A(colSpan 2), B], row1 = [C, D] → A spans cols 0–1, B lands at col 2,
    // but row1 only fills cols 0–1 → occupancy [[A,A,B],[C,D,null]] has a HOLE at
    // (1,2). The grid-based `ragged` flag is true, so SPLIT_CELL stays gated.
    const blocks = [
      buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
      buildBlock({ id: "table", type: "table", parentId: "doc", firstChildId: "r0", lastChildId: "r1" }),
      buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "A", lastChildId: "B" }),
      buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", firstChildId: "C", lastChildId: "D" }),
      buildBlock({ id: "A", type: "table-cell", parentId: "r0", attrs: { colSpan: 2 }, nextSiblingId: "B", firstChildId: "Ap", lastChildId: "Ap" }),
      buildBlock({ id: "Ap", type: "paragraph", parentId: "A", inlineContent: inlineContent([]) }),
      buildBlock({ id: "B", type: "table-cell", parentId: "r0", prevSiblingId: "A", firstChildId: "Bp", lastChildId: "Bp" }),
      buildBlock({ id: "Bp", type: "paragraph", parentId: "B", inlineContent: inlineContent([]) }),
      buildBlock({ id: "C", type: "table-cell", parentId: "r1", nextSiblingId: "D", firstChildId: "Cp", lastChildId: "Cp" }),
      buildBlock({ id: "Cp", type: "paragraph", parentId: "C", inlineContent: inlineContent([]) }),
      buildBlock({ id: "D", type: "table-cell", parentId: "r1", prevSiblingId: "C", firstChildId: "Dp", lastChildId: "Dp" }),
      buildBlock({ id: "Dp", type: "paragraph", parentId: "D", inlineContent: inlineContent([]) }),
    ];
    const state = buildState({ rootId: "doc", blocks });
    const caret = createPosition("Ap" as BlockId, 0);
    const editor = createEditorStateFromState(state, createSpan(caret, caret), config);
    const next = reduceEditor(editor, { type: "SPLIT_CELL" }, config);
    expect(next).toBe(editor);
  });

  it("unmerges a colSpan-2 cell: row0 grows to 2 cells, the survivor drops its span, caret stays", () => {
    const editor = editorWithSpannedTable();
    const next = reduceEditor(editor, { type: "SPLIT_CELL" }, config);
    expect(next).not.toBe(editor);

    const r0 = getChildIds(next.state, "r0" as BlockId);
    expect(r0.length).toBe(2);
    expect(r0[0]).toBe("A");
    expect(getBlock(next.state, "A" as BlockId)?.attrs.colSpan).toBeUndefined();
    expect(getBlock(next.state, nth(r0, 1, "cell"))?.type).toBe("table-cell");
    // Selection is unchanged (caret still in the survivor's paragraph).
    expect(next.selection.focus.blockId).toBe("Ap");
    expect(next.selection.anchor.blockId).toBe("Ap");
  });

  it("is one undo entry: UNDO restores the merged cell (row0 back to 1 cell, colSpan 2)", () => {
    const editor = editorWithSpannedTable();
    const split = reduceEditor(editor, { type: "SPLIT_CELL" }, config);
    const undone = reduceEditor(split, { type: "UNDO" }, config);
    expect(getChildIds(undone.state, "r0" as BlockId).length).toBe(1);
    expect(getBlock(undone.state, "A" as BlockId)?.attrs.colSpan).toBe(2);
  });
});

describe("handleMergeCells — MERGE_CELLS (P15b.S3)", () => {
  /** Set a span selection from paragraph `aPara` to `bPara` (anchor→focus). */
  const spanSelect = (editor: EditorState, aPara: BlockId, bPara: BlockId): EditorState =>
    reduceEditor(
      editor,
      { type: "SET_SELECTION", selection: createSpan(createPosition(aPara, 0), createPosition(bPara, 0)) },
      config,
    );

  it("no-ops (same editor ref) when the caret is not inside a table", () => {
    const editor = createInitialEditorState(config);
    const next = reduceEditor(editor, { type: "MERGE_CELLS" }, config);
    expect(next).toBe(editor);
  });

  it("no-ops on a single-cell (collapsed) selection — nothing to merge", () => {
    let editor = editorWithTable();
    const tableId = findTableId(editor.state);
    editor = selectInto(editor, firstCellParagraph(editor.state, tableId));
    const next = reduceEditor(editor, { type: "MERGE_CELLS" }, config);
    expect(next).toBe(editor);
  });

  it("merges a 2×2 selection: survivor spans 2×2, row1 empties, caret lands in the survivor", () => {
    let editor = editorWithTable(); // uniform 2×2
    const tableId = findTableId(editor.state);
    const r0 = nth(getChildIds(editor.state, tableId), 0, "row");
    const r1 = nth(getChildIds(editor.state, tableId), 1, "row");
    const survivor = nth(getChildIds(editor.state, r0), 0, "cell"); // cell (0,0)
    const p00 = cellParagraph(editor.state, tableId, 0, 0);
    const p11 = cellParagraph(editor.state, tableId, 1, 1);
    editor = spanSelect(editor, p00, p11);
    // Sanity: a same-table cross-cell span IS accepted (not dropped by the
    // cross-context selection guard #424) — so the merge below has real input.
    expect(editor.selection.anchor.blockId).toBe(p00);
    expect(editor.selection.focus.blockId).toBe(p11);

    const next = reduceEditor(editor, { type: "MERGE_CELLS" }, config);
    expect(next).not.toBe(editor);

    expect(getBlock(next.state, survivor)?.attrs.rowSpan).toBe(2);
    expect(getBlock(next.state, survivor)?.attrs.colSpan).toBe(2);
    expect(getChildIds(next.state, r0)).toEqual([survivor]);
    expect(getChildIds(next.state, r1)).toEqual([]);
    // Caret → collapsed at the survivor's first paragraph (p00 survives).
    expect(next.selection.focus.blockId).toBe(p00);
    expect(next.selection.anchor.blockId).toBe(p00);
    expect(next.selection.focus.offset).toBe(0);
  });

  it("is one undo entry: UNDO restores the 4 separate cells", () => {
    let editor = editorWithTable();
    const tableId = findTableId(editor.state);
    const r0 = nth(getChildIds(editor.state, tableId), 0, "row");
    const survivor = nth(getChildIds(editor.state, r0), 0, "cell");
    const p00 = cellParagraph(editor.state, tableId, 0, 0);
    const p11 = cellParagraph(editor.state, tableId, 1, 1);
    editor = spanSelect(editor, p00, p11);

    const merged = reduceEditor(editor, { type: "MERGE_CELLS" }, config);
    const undone = reduceEditor(merged, { type: "UNDO" }, config);
    expect(getChildIds(undone.state, r0).length).toBe(2);
    expect(getBlock(undone.state, survivor)?.attrs.rowSpan).toBeUndefined();
    expect(getBlock(undone.state, survivor)?.attrs.colSpan).toBeUndefined();
  });

  it("no-ops (same editor ref) on a ragged table — the degenerate carve-out (ctx.ragged gate)", () => {
    // Holed table: row0=[A(colSpan2),B], row1=[C,D] → occupancy [[A,A,B],[C,D,null]].
    const blocks = [
      buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
      buildBlock({ id: "table", type: "table", parentId: "doc", firstChildId: "r0", lastChildId: "r1" }),
      buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "A", lastChildId: "B" }),
      buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", firstChildId: "C", lastChildId: "D" }),
      buildBlock({ id: "A", type: "table-cell", parentId: "r0", attrs: { colSpan: 2 }, nextSiblingId: "B", firstChildId: "Ap", lastChildId: "Ap" }),
      buildBlock({ id: "Ap", type: "paragraph", parentId: "A", inlineContent: inlineContent([]) }),
      buildBlock({ id: "B", type: "table-cell", parentId: "r0", prevSiblingId: "A", firstChildId: "Bp", lastChildId: "Bp" }),
      buildBlock({ id: "Bp", type: "paragraph", parentId: "B", inlineContent: inlineContent([]) }),
      buildBlock({ id: "C", type: "table-cell", parentId: "r1", nextSiblingId: "D", firstChildId: "Cp", lastChildId: "Cp" }),
      buildBlock({ id: "Cp", type: "paragraph", parentId: "C", inlineContent: inlineContent([]) }),
      buildBlock({ id: "D", type: "table-cell", parentId: "r1", prevSiblingId: "C", firstChildId: "Dp", lastChildId: "Dp" }),
      buildBlock({ id: "Dp", type: "paragraph", parentId: "D", inlineContent: inlineContent([]) }),
    ];
    const state = buildState({ rootId: "doc", blocks });
    const editor = createEditorStateFromState(
      state,
      createSpan(createPosition("Ap" as BlockId, 0), createPosition("Dp" as BlockId, 0)),
      config,
    );
    const next = reduceEditor(editor, { type: "MERGE_CELLS" }, config);
    expect(next).toBe(editor);
  });
});
