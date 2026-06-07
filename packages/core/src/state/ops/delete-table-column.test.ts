import { describe, it, expect } from "vitest";
import { deleteTableColumn } from "./delete-table-column";
import { getBlock } from "../state";
import { resolveTableContext, getChildIds } from "../table-context";
import { buildBlock, buildState, inlineContent } from "../../test-utils/state-builders";
import type { BlockId } from "../block-id";
import type { State } from "../state";
import type { Block } from "../block";

/** A 2×2 table (doc > table > 2 rows > 2 cells each > paragraph). */
function build2x2(tableAttrs: Record<string, unknown>): State {
  const blocks: Block[] = [
    buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
    buildBlock({ id: "table", type: "table", attrs: tableAttrs, parentId: "doc", firstChildId: "r0", lastChildId: "r1" }),
    buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "r0c0", lastChildId: "r0c1" }),
    buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", firstChildId: "r1c0", lastChildId: "r1c1" }),
  ];
  for (const r of ["r0", "r1"]) {
    blocks.push(
      buildBlock({ id: `${r}c0`, type: "table-cell", parentId: r, nextSiblingId: `${r}c1`, firstChildId: `${r}p0`, lastChildId: `${r}p0` }),
      buildBlock({ id: `${r}c1`, type: "table-cell", parentId: r, prevSiblingId: `${r}c0`, firstChildId: `${r}p1`, lastChildId: `${r}p1` }),
      buildBlock({ id: `${r}p0`, type: "paragraph", parentId: `${r}c0`, inlineContent: inlineContent([]) }),
      buildBlock({ id: `${r}p1`, type: "paragraph", parentId: `${r}c1`, inlineContent: inlineContent([]) }),
    );
  }
  return buildState({ rootId: "doc", blocks });
}

/** A 1×1 table (doc > table > row > cell > paragraph). */
function build1x1(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
      buildBlock({ id: "table", type: "table", attrs: { columnWidths: [1] }, parentId: "doc", firstChildId: "row", lastChildId: "row" }),
      buildBlock({ id: "row", type: "table-row", parentId: "table", firstChildId: "cell", lastChildId: "cell" }),
      buildBlock({ id: "cell", type: "table-cell", parentId: "row", firstChildId: "cp", lastChildId: "cp" }),
      buildBlock({ id: "cp", type: "paragraph", parentId: "cell", inlineContent: inlineContent([]) }),
    ],
  });
}

function ctxAt(state: State, cellParagraphId: string) {
  const ctx = resolveTableContext(state, cellParagraphId as BlockId);
  if (ctx === null) throw new Error("expected a table context");
  return ctx;
}

describe("deleteTableColumn", () => {
  it("removes the caret column's cell (column 0) in every row; survivor becomes first", () => {
    const state = build2x2({ columnWidths: [0.5, 0.5] });
    const ctx = ctxAt(state, "r0p0"); // caret in column 0
    const { state: next } = deleteTableColumn(state, ctx);

    for (const r of ["r0", "r1"]) {
      const cells = getChildIds(next, r as BlockId);
      expect(cells.length).toBe(1);
      expect(cells[0]).toBe(`${r}c1`);
      // removed cell + its paragraph are gone
      expect(getBlock(next, `${r}c0` as BlockId)).toBeNull();
      expect(getBlock(next, `${r}p0` as BlockId)).toBeNull();
      // survivor is now the row's sole child
      expect(getBlock(next, `${r}c1` as BlockId)?.prevSiblingId).toBeNull();
      expect(getBlock(next, r as BlockId)?.firstChildId).toBe(`${r}c1`);
      expect(getBlock(next, r as BlockId)?.lastChildId).toBe(`${r}c1`);
    }
  });

  it("removes the LAST column (column 1) in every row; survivor becomes last", () => {
    const state = build2x2({ columnWidths: [0.5, 0.5] });
    const ctx = ctxAt(state, "r0p1"); // caret in column 1 (last)
    const { state: next } = deleteTableColumn(state, ctx);

    for (const r of ["r0", "r1"]) {
      const cells = getChildIds(next, r as BlockId);
      expect(cells.length).toBe(1);
      expect(cells[0]).toBe(`${r}c0`);
      expect(getBlock(next, `${r}c1` as BlockId)).toBeNull();
      expect(getBlock(next, `${r}c0` as BlockId)?.nextSiblingId).toBeNull();
      expect(getBlock(next, r as BlockId)?.lastChildId).toBe(`${r}c0`);
    }
  });

  it("re-removes columnWidths (present) and renormalizes to sum ≈ 1", () => {
    const state = build2x2({ columnWidths: [0.5, 0.5] });
    const ctx = ctxAt(state, "r0p0");
    const { state: next } = deleteTableColumn(state, ctx);
    // removeColumnWidth([0.5,0.5], 0) → normalize([0.5]) → [1]
    expect(getBlock(next, "table" as BlockId)?.attrs.columnWidths).toEqual([1]);
  });

  it("auto-layout (absent columnWidths) → cells removed, NO columnWidths attr written", () => {
    const state = build2x2({});
    const ctx = ctxAt(state, "r0p1");
    const { state: next } = deleteTableColumn(state, ctx);
    expect(getChildIds(next, "r0" as BlockId).length).toBe(1);
    expect(getBlock(next, "table" as BlockId)?.attrs.columnWidths).toBeUndefined();
  });

  it("throws on a single-column table (the caller must collapse the whole table)", () => {
    const state = build1x1();
    const ctx = ctxAt(state, "cp");
    expect(() => deleteTableColumn(state, ctx)).toThrow(/last column/);
  });

  it("dirtyIds covers the table, every touched row, removed cells, and survivors", () => {
    const state = build2x2({ columnWidths: [0.5, 0.5] });
    const ctx = ctxAt(state, "r0p0"); // delete column 0
    const { dirtyIds } = deleteTableColumn(state, ctx);

    expect(dirtyIds.has("table" as BlockId)).toBe(true); // columnWidths write
    expect(dirtyIds.has("r0" as BlockId)).toBe(true); // firstChildId rewired
    expect(dirtyIds.has("r1" as BlockId)).toBe(true);
    expect(dirtyIds.has("r0c0" as BlockId)).toBe(true); // removed
    expect(dirtyIds.has("r1c0" as BlockId)).toBe(true);
    expect(dirtyIds.has("r0c1" as BlockId)).toBe(true); // prevSibling rewired
    expect(dirtyIds.has("r1c1" as BlockId)).toBe(true);
  });
});
