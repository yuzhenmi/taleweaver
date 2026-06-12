import { describe, it, expect } from "vitest";
import { setTableHeaderRows } from "./set-table-header-rows";
import { getBlock } from "../state";
import { createHistory } from "../history";
import { createPosition, createSpan } from "../block-position";
import { buildBlock, buildState, inlineContent } from "../../test-utils/state-builders";
import type { BlockId } from "../block-id";
import type { State } from "../state";
import type { Block } from "../block";

/** One 1×1 cell: a `table-cell` + its empty paragraph. */
function cell(id: string, rowId: string, prev: string | null, next: string | null): Block[] {
  return [
    buildBlock({
      id,
      type: "table-cell",
      parentId: rowId,
      prevSiblingId: prev,
      nextSiblingId: next,
      firstChildId: `${id}p`,
      lastChildId: `${id}p`,
    }),
    buildBlock({ id: `${id}p`, type: "paragraph", parentId: id, inlineContent: inlineContent([]) }),
  ];
}

/** doc > table with `rowCount` 1×1 rows (single column). Rows are r0..r{n-1}. */
function plainTable(rowCount: number): State {
  const blocks: Block[] = [
    buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
    buildBlock({
      id: "table",
      type: "table",
      parentId: "doc",
      attrs: { columnWidths: [1] },
      firstChildId: "r0",
      lastChildId: `r${rowCount - 1}`,
    }),
  ];
  for (let r = 0; r < rowCount; r++) {
    blocks.push(
      buildBlock({
        id: `r${r}`,
        type: "table-row",
        parentId: "table",
        prevSiblingId: r === 0 ? null : `r${r - 1}`,
        nextSiblingId: r === rowCount - 1 ? null : `r${r + 1}`,
        firstChildId: `c${r}`,
        lastChildId: `c${r}`,
      }),
      ...cell(`c${r}`, `r${r}`, null, null),
    );
  }
  return buildState({ rootId: "doc", blocks });
}

/**
 * doc > table: row0=[A], row1=[B(rowSpan 2)] covering row2, row3=[D]. A boundary
 * at count=2 would straddle B (origin row 1, spans rows 1–2) → clamps to 1.
 */
function spanTable(): State {
  const blocks: Block[] = [
    buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
    buildBlock({ id: "table", type: "table", parentId: "doc", attrs: { columnWidths: [1] }, firstChildId: "r0", lastChildId: "r3" }),
    buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "A", lastChildId: "A" }),
    buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", nextSiblingId: "r2", firstChildId: "B", lastChildId: "B" }),
    buildBlock({ id: "r2", type: "table-row", parentId: "table", prevSiblingId: "r1", nextSiblingId: "r3", firstChildId: null, lastChildId: null }),
    buildBlock({ id: "r3", type: "table-row", parentId: "table", prevSiblingId: "r2", firstChildId: "D", lastChildId: "D" }),
    ...cell("A", "r0", null, null),
    // B carries rowSpan 2 (covers row1 + row2).
    buildBlock({ id: "B", type: "table-cell", parentId: "r1", attrs: { rowSpan: 2 }, firstChildId: "Bp", lastChildId: "Bp" }),
    buildBlock({ id: "Bp", type: "paragraph", parentId: "B", inlineContent: inlineContent([]) }),
    ...cell("D", "r3", null, null),
  ];
  return buildState({ rootId: "doc", blocks });
}

function headerRowCountOf(state: State): unknown {
  return getBlock(state, "table" as BlockId)?.attrs.headerRowCount;
}

describe("setTableHeaderRows", () => {
  it("writes headerRowCount clamped to [0, rowCount]", () => {
    const state = plainTable(3);
    expect(setTableHeaderRows(state, "table" as BlockId, 2).state).not.toBe(state);
    expect(headerRowCountOf(setTableHeaderRows(state, "table" as BlockId, 2).state)).toBe(2);
    // Above rowCount → clamps to 3.
    expect(headerRowCountOf(setTableHeaderRows(state, "table" as BlockId, 9).state)).toBe(3);
    // Negative → clamps to 0 (attr dropped — 0 is the absent default).
    expect(headerRowCountOf(setTableHeaderRows(state, "table" as BlockId, -2).state)).toBeUndefined();
  });

  it("clamps a straddling request DOWN to the clean boundary", () => {
    // requested=2 would straddle B's rowSpan → clamps to 1.
    const state = spanTable();
    expect(headerRowCountOf(setTableHeaderRows(state, "table" as BlockId, 2).state)).toBe(1);
    // requested=3: B at row 1 with rowSpan 2 reaches 1+2=3, which is NOT > 3 (it
    // ends exactly AT the count=3 boundary, not past it) → no straddle at count=3
    // → clean → stays 3.
    expect(headerRowCountOf(setTableHeaderRows(state, "table" as BlockId, 3).state)).toBe(3);
  });

  it("is a no-op (same state ref) when headerRowCount is already equal", () => {
    const state = plainTable(3);
    const once = setTableHeaderRows(state, "table" as BlockId, 2).state;
    const twice = setTableHeaderRows(once, "table" as BlockId, 2);
    expect(twice.state).toBe(once); // identity preserved (no spurious dirty)
  });

  it("is a no-op when setting 0 on a table that has no headerRowCount", () => {
    const state = plainTable(3);
    const result = setTableHeaderRows(state, "table" as BlockId, 0);
    expect(result.state).toBe(state);
  });

  it("throws on a non-table block id", () => {
    const state = plainTable(3);
    expect(() => setTableHeaderRows(state, "r0" as BlockId, 1)).toThrow(/table/);
    expect(() => setTableHeaderRows(state, "missing" as BlockId, 1)).toThrow();
  });

  it("is one undo entry (a single applyOperation transaction)", () => {
    const state = plainTable(3);
    const history = createHistory(state);
    const sel = createSpan(createPosition("c0p" as BlockId, 0), createPosition("c0p" as BlockId, 0));
    const result = setTableHeaderRows(state, "table" as BlockId, 2);
    history.commit(result, { before: sel, after: sel });
    expect(headerRowCountOf(result.state)).toBe(2);
    const undone = history.undo();
    expect(undone).not.toBeNull();
    if (undone === null) throw new Error("expected undo to succeed");
    expect(headerRowCountOf(undone.state)).toBeUndefined();
  });
});
