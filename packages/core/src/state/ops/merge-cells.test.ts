import { describe, it, expect } from "vitest";
import { mergeCells } from "./merge-cells";
import { getBlock } from "../state";
import { buildTableGrid, getChildIds, resolveTableContext } from "../table-context";
import { resolveCellRange } from "../table-cell-range";
import { createPosition, createSpan } from "../block-position";
import { buildBlock, buildState, inlineContent, text } from "../../test-utils/state-builders";
import type { BlockId } from "../block-id";
import type { State } from "../state";
import type { Block } from "../block";
import type { CellRange } from "../table-cell-range";

/** A cell with one paragraph; `content` is the paragraph's text ("" → empty). */
function cell(id: string, rowId: string, content: string, prev: string | null, next: string | null): Block[] {
  return [
    buildBlock({ id, type: "table-cell", parentId: rowId, prevSiblingId: prev, nextSiblingId: next, firstChildId: `${id}p`, lastChildId: `${id}p` }),
    buildBlock({ id: `${id}p`, type: "paragraph", parentId: id, inlineContent: inlineContent(content === "" ? [] : [text(content)]) }),
  ];
}

/** doc > table > row0[A,B], row1[C,D]; per-cell text supplied by `t`. */
function build2x2(t: { A: string; B: string; C: string; D: string }): State {
  const blocks: Block[] = [
    buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
    buildBlock({ id: "table", type: "table", parentId: "doc", attrs: { columnWidths: [0.5, 0.5] }, firstChildId: "r0", lastChildId: "r1" }),
    buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "A", lastChildId: "B" }),
    buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", firstChildId: "C", lastChildId: "D" }),
    ...cell("A", "r0", t.A, null, "B"),
    ...cell("B", "r0", t.B, "A", null),
    ...cell("C", "r1", t.C, null, "D"),
    ...cell("D", "r1", t.D, "C", null),
  ];
  return buildState({ rootId: "doc", blocks });
}

/** Resolve the cell range for a selection from cell `a`'s paragraph to cell `b`'s. */
function rangeOf(state: State, aPara: string, bPara: string): CellRange {
  const r = resolveCellRange(state, createSpan(createPosition(aPara as BlockId, 0), createPosition(bPara as BlockId, 0)));
  if (r === null) throw new Error("expected a cell range");
  return r;
}

describe("mergeCells", () => {
  it("merges a whole 2×2: survivor spans 2×2, others' content appended row-major, empty cell dropped (F9)", () => {
    // A="a", B="b", C="" (empty → dropped), D="d".
    const state = build2x2({ A: "a", B: "b", C: "", D: "d" });
    const result = mergeCells(state, rangeOf(state, "Ap", "Dp"));
    expect(result.state).not.toBe(state);

    // Survivor A now spans the whole grid.
    const a = getBlock(result.state, "A" as BlockId);
    expect(a?.attrs.rowSpan).toBe(2);
    expect(a?.attrs.colSpan).toBe(2);
    // Content: survivor's own first, then B and D (row-major); C's empty paragraph dropped.
    expect(getChildIds(result.state, "A" as BlockId)).toEqual(["Ap", "Bp", "Dp"]);
    // Donor cells gone; C's empty paragraph gone; B/D paragraphs survive (now under A).
    expect(getBlock(result.state, "B" as BlockId)).toBeNull();
    expect(getBlock(result.state, "C" as BlockId)).toBeNull();
    expect(getBlock(result.state, "D" as BlockId)).toBeNull();
    expect(getBlock(result.state, "Cp" as BlockId)).toBeNull();
    expect(getBlock(result.state, "Bp" as BlockId)?.parentId).toBe("A");
    // Rows: row0 keeps only A; row1 is emptied (covered by the rowSpan).
    expect(getChildIds(result.state, "r0" as BlockId)).toEqual(["A"]);
    expect(getChildIds(result.state, "r1" as BlockId)).toEqual([]);
    // Occupancy is a clean rectangle filled by the survivor.
    const grid = buildTableGrid(result.state, "table" as BlockId);
    if (grid === null) throw new Error("expected grid");
    expect(grid.occupancy).toEqual([["A", "A"], ["A", "A"]]);
  });

  it("merges one row horizontally: survivor gets colSpan only, row below untouched", () => {
    const state = build2x2({ A: "a", B: "b", C: "c", D: "d" });
    const result = mergeCells(state, rangeOf(state, "Ap", "Bp")); // A..B
    const a = getBlock(result.state, "A" as BlockId);
    expect(a?.attrs.colSpan).toBe(2);
    expect(a?.attrs.rowSpan).toBeUndefined(); // 1 → attr dropped
    expect(getChildIds(result.state, "A" as BlockId)).toEqual(["Ap", "Bp"]);
    expect(getChildIds(result.state, "r0" as BlockId)).toEqual(["A"]);
    expect(getChildIds(result.state, "r1" as BlockId)).toEqual(["C", "D"]); // untouched
    const grid = buildTableGrid(result.state, "table" as BlockId);
    if (grid === null) throw new Error("expected grid");
    expect(grid.occupancy).toEqual([["A", "A"], ["C", "D"]]);
  });

  it("vertical 2×1 merge empties the lower row (covered by the survivor's rowSpan)", () => {
    // Single-column table: row0=[A], row1=[B].
    const blocks: Block[] = [
      buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
      buildBlock({ id: "table", type: "table", parentId: "doc", firstChildId: "r0", lastChildId: "r1" }),
      buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "A", lastChildId: "A" }),
      buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", firstChildId: "B", lastChildId: "B" }),
      ...cell("A", "r0", "a", null, null),
      ...cell("B", "r1", "b", null, null),
    ];
    const state = buildState({ rootId: "doc", blocks });
    const result = mergeCells(state, rangeOf(state, "Ap", "Bp"));
    const a = getBlock(result.state, "A" as BlockId);
    expect(a?.attrs.rowSpan).toBe(2);
    expect(a?.attrs.colSpan).toBeUndefined();
    expect(getChildIds(result.state, "A" as BlockId)).toEqual(["Ap", "Bp"]);
    expect(getChildIds(result.state, "r1" as BlockId)).toEqual([]);
    const grid = buildTableGrid(result.state, "table" as BlockId);
    if (grid === null) throw new Error("expected grid");
    expect(grid.occupancy).toEqual([["A"], ["A"]]);
  });

  it("keeps the survivor's own (empty) content first when it leads an otherwise non-empty merge", () => {
    // A empty, B="b": merging keeps A's empty paragraph first, then B's content.
    const state = build2x2({ A: "", B: "b", C: "c", D: "d" });
    const result = mergeCells(state, rangeOf(state, "Ap", "Bp"));
    expect(getChildIds(result.state, "A" as BlockId)).toEqual(["Ap", "Bp"]);
    expect(getBlock(result.state, "Ap" as BlockId)?.inlineContent?.items.length).toBe(0);
  });

  it("preserves out-of-range cells flanking the merge in the same row (interior survivor)", () => {
    // 3-column table. row0 = [L, A, B], row1 = [C, D, E]. Merge A+B (the middle and
    // right of row0): L must stay as A's left sibling, row0 becomes [L, A(colSpan2)],
    // and row1 is wholly untouched.
    const blocks: Block[] = [
      buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
      buildBlock({ id: "table", type: "table", parentId: "doc", firstChildId: "r0", lastChildId: "r1" }),
      buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "L", lastChildId: "B" }),
      buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", firstChildId: "C", lastChildId: "E" }),
      ...cell("L", "r0", "l", null, "A"),
      ...cell("A", "r0", "a", "L", "B"),
      ...cell("B", "r0", "b", "A", null),
      ...cell("C", "r1", "c", null, "D"),
      ...cell("D", "r1", "d", "C", "E"),
      ...cell("E", "r1", "e", "D", null),
    ];
    const state = buildState({ rootId: "doc", blocks });
    const result = mergeCells(state, rangeOf(state, "Ap", "Bp"));

    const a = getBlock(result.state, "A" as BlockId);
    expect(a?.attrs.colSpan).toBe(2);
    expect(getChildIds(result.state, "A" as BlockId)).toEqual(["Ap", "Bp"]);
    // row0: L kept, correctly re-chained before the survivor.
    expect(getChildIds(result.state, "r0" as BlockId)).toEqual(["L", "A"]);
    expect(getBlock(result.state, "L" as BlockId)?.nextSiblingId).toBe("A");
    expect(getBlock(result.state, "A" as BlockId)?.prevSiblingId).toBe("L");
    // row1: completely untouched.
    expect(getChildIds(result.state, "r1" as BlockId)).toEqual(["C", "D", "E"]);
    const grid = buildTableGrid(result.state, "table" as BlockId);
    if (grid === null) throw new Error("expected grid");
    expect(grid.occupancy).toEqual([["L", "A", "A"], ["C", "D", "E"]]);
  });

  it("no-ops (same state ref) on a single-cell range", () => {
    const state = build2x2({ A: "a", B: "b", C: "c", D: "d" });
    const ctx = resolveTableContext(state, "Ap" as BlockId);
    if (ctx === null) throw new Error("ctx");
    const single: CellRange = { tableId: ctx.tableId, minRow: 0, minCol: 0, maxRow: 0, maxCol: 0 };
    const result = mergeCells(state, single);
    expect(result.state).toBe(state);
    expect(result.dirtyIds.size).toBe(0);
  });
});
