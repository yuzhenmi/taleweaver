import { describe, it, expect } from "vitest";
import { deleteTableColumnSpanAware } from "./delete-table-column-span-aware";
import { getBlock } from "../document";
import { resolveTableContext, getChildIds, buildTableGrid } from "../table-context";
import { buildBlock, buildDocument, inlineContent } from "../../test-utils/document-builders";
import type { BlockId } from "../block-id";
import type { Document } from "../document";
import type { Block } from "../block";

function cell(id: string, rowId: string, attrs: Record<string, unknown> | undefined, prev: string | null, next: string | null): Block[] {
  return [
    buildBlock({ id, type: "table-cell", parentId: rowId, attrs, prevSiblingId: prev, nextSiblingId: next, firstChildId: `${id}p`, lastChildId: `${id}p` }),
    buildBlock({ id: `${id}p`, type: "paragraph", parentId: id, inlineContent: inlineContent([]) }),
  ];
}

function ctxAt(document: Document, blockId: string) {
  const ctx = resolveTableContext(document, blockId as BlockId);
  if (ctx === null) throw new Error("expected table context");
  return ctx;
}

const run = (document: Document, caretBlock: string) =>
  deleteTableColumnSpanAware(document, ctxAt(document, caretBlock));

/**
 * row0=[A(colSpan n)]; row1=[C, D, …] (n 1×1 cells). occupancy: A tiles row0 across
 * all n columns; row1 is one 1×1 cell per column. Optional `columnWidths` on the table.
 */
function buildHorizontalSpan(n: number, columnWidths?: number[]): Document {
  const lastRow1 = String.fromCharCode(67 + n - 1); // 'C' = 67
  const blocks: Block[] = [
    buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
    buildBlock({ id: "table", type: "table", parentId: "doc", attrs: columnWidths ? { columnWidths } : undefined, firstChildId: "r0", lastChildId: "r1" }),
    buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "A", lastChildId: "A" }),
    ...cell("A", "r0", { colSpan: n }, null, null),
    buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", firstChildId: "C", lastChildId: lastRow1 }),
  ];
  for (let c = 0; c < n; c++) {
    const id = String.fromCharCode(67 + c);
    const prev = c === 0 ? null : String.fromCharCode(67 + c - 1);
    const next = c === n - 1 ? null : String.fromCharCode(67 + c + 1);
    blocks.push(...cell(id, "r1", undefined, prev, next));
  }
  return buildDocument({ rootId: "doc", blocks });
}

describe("deleteTableColumnSpanAware", () => {
  it("delete a column a span COVERS from the left: the covering cell shrinks its colSpan", () => {
    // row0=[A(colSpan 2)], row1=[C, D]. occupancy [[A,A],[C,D]]. Delete col1 (caret D).
    const document = buildHorizontalSpan(2);
    const result = run(document, "Dp");
    expect(result.document).not.toBe(document);

    expect(getBlock(result.document, "A" as BlockId)?.attrs.colSpan).toBeUndefined(); // 2→1, attr dropped
    expect(getBlock(result.document, "D" as BlockId)).toBeNull();
    expect(getChildIds(result.document, "r1" as BlockId)).toEqual(["C"]);
    const grid = buildTableGrid(result.document, "table" as BlockId);
    if (grid === null) throw new Error("expected grid");
    expect(grid.occupancy).toEqual([["A"], ["C"]]);
  });

  it("delete a column a span ORIGINATES in (colSpan>1): the cell shrinks in place, keeping its content", () => {
    // row0=[A(colSpan 2)], row1=[C, D]. occupancy [[A,A],[C,D]]. Delete col0 (caret C).
    const document = buildHorizontalSpan(2);
    const result = run(document, "Cp");

    expect(getBlock(result.document, "C" as BlockId)).toBeNull(); // 1×1 in the deleted column → removed
    const a = getBlock(result.document, "A" as BlockId);
    expect(a?.attrs.colSpan).toBeUndefined(); // 2→1, attr dropped
    expect(a?.parentId).toBe("r0"); // NOT reparented — a column delete keeps the cell in its row
    expect(getChildIds(result.document, "r1" as BlockId)).toEqual(["D"]);
    const grid = buildTableGrid(result.document, "table" as BlockId);
    if (grid === null) throw new Error("expected grid");
    expect(grid.occupancy).toEqual([["A"], ["D"]]);
  });

  it("caret INSIDE the colSpan>1 cell being shrunk: gc = its origin column, the cell shrinks", () => {
    // row0=[A(colSpan 2)], row1=[C, D]. Caret in A itself (gridCol 0). Delete col0:
    // A originating→colSpan 1 (stays), C (1×1 at col0) removed. Same outcome as caret-on-C,
    // exercising the gc = caret.gridCol path when the caret IS the originating span cell.
    const document = buildHorizontalSpan(2);
    const result = run(document, "Ap");

    expect(getBlock(result.document, "A" as BlockId)?.attrs.colSpan).toBeUndefined(); // 2→1
    expect(getBlock(result.document, "C" as BlockId)).toBeNull();
    expect(getChildIds(result.document, "r1" as BlockId)).toEqual(["D"]);
    const grid = buildTableGrid(result.document, "table" as BlockId);
    if (grid === null) throw new Error("expected grid");
    expect(grid.occupancy).toEqual([["A"], ["D"]]);
  });

  it("delete the origin column of a colSpan-3 cell: it shrinks in place with remaining span 2", () => {
    // row0=[A(colSpan 3)], row1=[C, D, E]. occupancy [[A,A,A],[C,D,E]]. Delete col0 (caret C).
    const document = buildHorizontalSpan(3);
    const result = run(document, "Cp");

    expect(getBlock(result.document, "A" as BlockId)?.attrs.colSpan).toBe(2); // 3→2, still a span
    expect(getBlock(result.document, "C" as BlockId)).toBeNull();
    expect(getChildIds(result.document, "r1" as BlockId)).toEqual(["D", "E"]);
    const grid = buildTableGrid(result.document, "table" as BlockId);
    if (grid === null) throw new Error("expected grid");
    expect(grid.occupancy).toEqual([["A", "A"], ["D", "E"]]);
  });

  it("delete a MIDDLE column a colSpan-3 cell covers: the covering cell shrinks to span 2", () => {
    // row0=[A(colSpan 3)], row1=[C, D, E]. Delete col1 (caret D).
    const document = buildHorizontalSpan(3);
    const result = run(document, "Dp");

    expect(getBlock(result.document, "A" as BlockId)?.attrs.colSpan).toBe(2); // 3→2
    expect(getBlock(result.document, "D" as BlockId)).toBeNull();
    expect(getChildIds(result.document, "r1" as BlockId)).toEqual(["C", "E"]);
    const grid = buildTableGrid(result.document, "table" as BlockId);
    if (grid === null) throw new Error("expected grid");
    expect(grid.occupancy).toEqual([["A", "A"], ["C", "E"]]);
  });

  it("a deleted column with a covering cell + an originating span + a removed 1×1 (all three buckets at once)", () => {
    // 3×3. row0: A(colSpan 3) covers all columns. row1: P(col0,1×1), B(col1, colSpan 2).
    // row2: Q(col0), C(col1, 1×1), R(col2). occupancy [[A,A,A],[P,B,B],[Q,C,R]]. Delete col1 (caret C):
    // A covering→colSpan 2, B originating→colSpan 1 (stays), C removed (interior splice between Q and R).
    const blocks: Block[] = [
      buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
      buildBlock({ id: "table", type: "table", parentId: "doc", firstChildId: "r0", lastChildId: "r2" }),
      buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "A", lastChildId: "A" }),
      buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", nextSiblingId: "r2", firstChildId: "P", lastChildId: "B" }),
      buildBlock({ id: "r2", type: "table-row", parentId: "table", prevSiblingId: "r1", firstChildId: "Q", lastChildId: "R" }),
      ...cell("A", "r0", { colSpan: 3 }, null, null),
      ...cell("P", "r1", undefined, null, "B"),
      ...cell("B", "r1", { colSpan: 2 }, "P", null),
      ...cell("Q", "r2", undefined, null, "C"),
      ...cell("C", "r2", undefined, "Q", "R"),
      ...cell("R", "r2", undefined, "C", null),
    ];
    const document = buildDocument({ rootId: "doc", blocks });
    const result = run(document, "Cp");

    expect(getBlock(result.document, "A" as BlockId)?.attrs.colSpan).toBe(2); // covering: 3→2
    expect(getBlock(result.document, "B" as BlockId)?.attrs.colSpan).toBeUndefined(); // originating: 2→1
    expect(getBlock(result.document, "B" as BlockId)?.parentId).toBe("r1"); // stayed in its row
    expect(getBlock(result.document, "C" as BlockId)).toBeNull(); // 1×1 removed
    expect(getChildIds(result.document, "r1" as BlockId)).toEqual(["P", "B"]);
    expect(getChildIds(result.document, "r2" as BlockId)).toEqual(["Q", "R"]); // C spliced out from between Q and R
    const grid = buildTableGrid(result.document, "table" as BlockId);
    if (grid === null) throw new Error("expected grid");
    expect(grid.occupancy).toEqual([["A", "A"], ["P", "B"], ["Q", "R"]]);
  });

  it("re-shrinks the table's columnWidths in the SAME op (one undo reverts cells + widths)", () => {
    // 2-column table with explicit widths. Delete col0 → removeColumnWidth([0.5,0.5], 0) = [1].
    const document = buildHorizontalSpan(2, [0.5, 0.5]);
    const result = run(document, "Cp");
    expect(getBlock(result.document, "table" as BlockId)?.attrs.columnWidths).toEqual([1]);
  });

  it("no-ops (same state ref) on a single-column table (the last-column collapse is the handler's job)", () => {
    const blocks: Block[] = [
      buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
      buildBlock({ id: "table", type: "table", parentId: "doc", firstChildId: "r0", lastChildId: "r1" }),
      buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "A", lastChildId: "A" }),
      ...cell("A", "r0", undefined, null, null),
      buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", firstChildId: "B", lastChildId: "B" }),
      ...cell("B", "r1", undefined, null, null),
    ];
    const document = buildDocument({ rootId: "doc", blocks });
    const result = run(document, "Ap");
    expect(result.document).toBe(document);
    expect(result.dirtyIds.size).toBe(0);
  });
});
