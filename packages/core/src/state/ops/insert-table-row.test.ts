import { describe, it, expect } from "vitest";
import { insertTableRow } from "./insert-table-row";
import { resolveTableContext } from "../table-context";
import { getBlock } from "../state";
import { buildBlock, buildState, inlineContent } from "../../test-utils/state-builders";
import { createTestAllocator } from "../block-id";
import type { BlockId } from "../block-id";
import type { State } from "../state";

// doc > table[0.5/0.5] > row0(cA,cB) / row1(cC,cD); each cell > paragraph.
function tableState(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
      buildBlock({ id: "table", type: "table", parentId: "doc", attrs: { columnWidths: [0.5, 0.5] }, firstChildId: "row0", lastChildId: "row1" }),
      buildBlock({ id: "row0", type: "table-row", parentId: "table", nextSiblingId: "row1", firstChildId: "cA", lastChildId: "cB" }),
      buildBlock({ id: "row1", type: "table-row", parentId: "table", prevSiblingId: "row0", firstChildId: "cC", lastChildId: "cD" }),
      buildBlock({ id: "cA", type: "table-cell", parentId: "row0", nextSiblingId: "cB", firstChildId: "pA", lastChildId: "pA" }),
      buildBlock({ id: "cB", type: "table-cell", parentId: "row0", prevSiblingId: "cA", firstChildId: "pB", lastChildId: "pB" }),
      buildBlock({ id: "cC", type: "table-cell", parentId: "row1", nextSiblingId: "cD", firstChildId: "pC", lastChildId: "pC" }),
      buildBlock({ id: "cD", type: "table-cell", parentId: "row1", prevSiblingId: "cC", firstChildId: "pD", lastChildId: "pD" }),
      buildBlock({ id: "pA", type: "paragraph", parentId: "cA", inlineContent: inlineContent([]) }),
      buildBlock({ id: "pB", type: "paragraph", parentId: "cB", inlineContent: inlineContent([]) }),
      buildBlock({ id: "pC", type: "paragraph", parentId: "cC", inlineContent: inlineContent([]) }),
      buildBlock({ id: "pD", type: "paragraph", parentId: "cD", inlineContent: inlineContent([]) }),
    ],
  });
}

const ctxAt = (state: State, blockId: string) => {
  const ctx = resolveTableContext(state, blockId as BlockId);
  if (ctx === null) throw new Error("no ctx");
  return ctx;
};

describe("insertTableRow", () => {
  it("inserts a row BELOW the caret's row with one empty cell per column", () => {
    const state = tableState();
    const { state: next, newRowId } = insertTableRow(
      state, ctxAt(state, "pA"), "below", createTestAllocator("n"),
    );

    const newRow = getBlock(next, newRowId);
    if (newRow === null) throw new Error("new row missing");
    expect(newRow.type).toBe("table-row");
    expect(newRow.parentId).toBe("table");
    // spliced between row0 and row1
    expect(newRow.prevSiblingId).toBe("row0");
    expect(newRow.nextSiblingId).toBe("row1");
    expect(getBlock(next, "row0" as BlockId)?.nextSiblingId).toBe(newRowId);
    expect(getBlock(next, "row1" as BlockId)?.prevSiblingId).toBe(newRowId);
    // table boundary unchanged (middle insert)
    expect(getBlock(next, "table" as BlockId)?.firstChildId).toBe("row0");
    expect(getBlock(next, "table" as BlockId)?.lastChildId).toBe("row1");

    // two cells, each with one empty paragraph
    const c0 = newRow.firstChildId;
    const c1 = newRow.lastChildId;
    if (c0 === null || c1 === null || c0 === c1) throw new Error("expected 2 distinct cells");
    const cell0 = getBlock(next, c0);
    expect(cell0?.type).toBe("table-cell");
    expect(cell0?.parentId).toBe(newRowId);
    expect(cell0?.nextSiblingId).toBe(c1);
    const p0 = cell0?.firstChildId ?? null;
    if (p0 === null) throw new Error("cell missing paragraph");
    const para0 = getBlock(next, p0);
    expect(para0?.type).toBe("paragraph");
    expect(para0?.parentId).toBe(c0);
    expect(para0?.inlineContent).toEqual({ items: [] });
  });

  it("inserts a row ABOVE the caret's row, updating the table's firstChild at the boundary", () => {
    const state = tableState();
    const { state: next, newRowId } = insertTableRow(
      state, ctxAt(state, "pA"), "above", createTestAllocator("n"),
    );
    const newRow = getBlock(next, newRowId);
    expect(newRow?.prevSiblingId).toBeNull();
    expect(newRow?.nextSiblingId).toBe("row0");
    expect(getBlock(next, "table" as BlockId)?.firstChildId).toBe(newRowId);
    expect(getBlock(next, "row0" as BlockId)?.prevSiblingId).toBe(newRowId);
  });

  it("inserts below the LAST row, updating the table's lastChild at the boundary", () => {
    const state = tableState();
    const { state: next, newRowId } = insertTableRow(
      state, ctxAt(state, "pD"), "below", createTestAllocator("n"),
    );
    expect(getBlock(next, newRowId)?.nextSiblingId).toBeNull();
    expect(getBlock(next, "table" as BlockId)?.lastChildId).toBe(newRowId);
    expect(getBlock(next, "row1" as BlockId)?.nextSiblingId).toBe(newRowId);
  });

  it("dirtyIds covers the new row + its cells + paragraphs + touched sibling rows", () => {
    const state = tableState();
    const { state: next, dirtyIds, newRowId } = insertTableRow(
      state, ctxAt(state, "pA"), "below", createTestAllocator("n"),
    );
    expect(dirtyIds.has(newRowId)).toBe(true);
    expect(dirtyIds.has("row0" as BlockId)).toBe(true); // nextSiblingId rewired
    expect(dirtyIds.has("row1" as BlockId)).toBe(true); // prevSiblingId rewired
    // every new cell + its paragraph is dirty (each was blocksMap.set in the tx)
    const newRow = getBlock(next, newRowId);
    for (const cellId of [newRow?.firstChildId, newRow?.lastChildId]) {
      if (cellId == null) throw new Error("missing cell");
      expect(dirtyIds.has(cellId)).toBe(true);
      const para = getBlock(next, cellId)?.firstChildId;
      if (para == null) throw new Error("missing paragraph");
      expect(dirtyIds.has(para)).toBe(true);
    }
  });

  it("handles a 1-column table (single cell row; firstChild === lastChild)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
        buildBlock({ id: "table", type: "table", parentId: "doc", attrs: { columnWidths: [1] }, firstChildId: "r0", lastChildId: "r0" }),
        buildBlock({ id: "r0", type: "table-row", parentId: "table", firstChildId: "c0", lastChildId: "c0" }),
        buildBlock({ id: "c0", type: "table-cell", parentId: "r0", firstChildId: "p0", lastChildId: "p0" }),
        buildBlock({ id: "p0", type: "paragraph", parentId: "c0", inlineContent: inlineContent([]) }),
      ],
    });
    const { state: next, newRowId } = insertTableRow(
      state, ctxAt(state, "p0"), "below", createTestAllocator("n"),
    );
    const newRow = getBlock(next, newRowId);
    expect(newRow?.firstChildId).toBe(newRow?.lastChildId); // the single cell
    const cell = newRow?.firstChildId ?? null;
    if (cell === null) throw new Error("missing cell");
    expect(getBlock(next, cell)?.prevSiblingId).toBeNull();
    expect(getBlock(next, cell)?.nextSiblingId).toBeNull();
    expect(getBlock(next, "table" as BlockId)?.lastChildId).toBe(newRowId);
  });
});
