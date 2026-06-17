import { describe, it, expect } from "vitest";
import { insertTableColumn } from "./insert-table-column";
import { getBlock } from "../state";
import { resolveTableContext, getChildIds } from "../table-context";
import { buildBlock, buildState, inlineContent } from "../../test-utils/state-builders";
import { createTestAllocator } from "../block-id";
import type { BlockId } from "../block-id";
import type { State } from "../state";
import type { Block } from "../block";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

/**
 * A 2×2 table (doc > table > 2 rows > 2 cells each > paragraph). `columnWidths`
 * is supplied via `tableAttrs` so tests can exercise the present/absent paths.
 */
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

/** Resolve a context with the caret in the given cell's paragraph. */
function ctxAt(state: State, cellParagraphId: string) {
  const ctx = resolveTableContext(state, cellParagraphId as BlockId);
  if (ctx === null) throw new Error("expected a table context");
  return ctx;
}

describe("insertTableColumn", () => {
  it("inserts a column to the LEFT of the caret's column in every row", () => {
    const state = build2x2({ columnWidths: [0.5, 0.5] });
    const ctx = ctxAt(state, "r0p0"); // caret in row 0, column 0
    const { state: next } = insertTableColumn(state, ctx, "left", createTestAllocator("n"));

    // Each row now has 3 cells; the new cell is first (left of column 0).
    for (const r of ["r0", "r1"]) {
      const cells = getChildIds(next, r as BlockId);
      expect(cells.length).toBe(3);
      expect(cells[1]).toBe(`${r}c0`);
      expect(cells[2]).toBe(`${r}c1`);
      // new cell: parent = row, holds one empty paragraph
      const newCell = getBlock(next, nth(cells, 0, "cell"));
      expect(newCell?.type).toBe("table-cell");
      expect(newCell?.parentId).toBe(r);
      expect(newCell?.prevSiblingId).toBeNull();
      const p = newCell?.firstChildId;
      expect(p != null && getBlock(next, p)?.type).toBe("paragraph");
      expect(p != null && getBlock(next, p)?.inlineContent).toEqual({ items: [] });
    }
  });

  it("inserts a column to the RIGHT (append) when the caret is in the last column", () => {
    const state = build2x2({ columnWidths: [0.5, 0.5] });
    const ctx = ctxAt(state, "r0p1"); // caret in row 0, column 1 (last)
    const { state: next } = insertTableColumn(state, ctx, "right", createTestAllocator("n"));

    for (const r of ["r0", "r1"]) {
      const cells = getChildIds(next, r as BlockId);
      expect(cells.length).toBe(3);
      expect(cells[0]).toBe(`${r}c0`);
      expect(cells[1]).toBe(`${r}c1`);
      // new cell appended last
      expect(getBlock(next, nth(cells, 2, "cell"))?.type).toBe("table-cell");
      expect(getBlock(next, nth(cells, 2, "cell"))?.nextSiblingId).toBeNull();
      expect(getBlock(next, r as BlockId)?.lastChildId).toBe(cells[2]);
    }
  });

  it("re-splices columnWidths (present) to sum ≈ 1 with the new fraction", () => {
    const state = build2x2({ columnWidths: [0.5, 0.5] });
    const ctx = ctxAt(state, "r0p0");
    const { state: next } = insertTableColumn(state, ctx, "left", createTestAllocator("n"));

    const cw = getBlock(next, "table" as BlockId)?.attrs.columnWidths;
    expect(Array.isArray(cw)).toBe(true);
    const widths = cw as number[];
    expect(widths.length).toBe(3);
    const sum = widths.reduce((s, w) => s + w, 0);
    expect(sum).toBeCloseTo(1, 10);
    for (const w of widths) expect(w).toBeCloseTo(1 / 3, 10);
  });

  it("auto-layout (absent columnWidths) → cells added, NO columnWidths attr written", () => {
    const state = build2x2({}); // no columnWidths
    const ctx = ctxAt(state, "r0p0");
    const { state: next } = insertTableColumn(state, ctx, "right", createTestAllocator("n"));

    expect(getChildIds(next, "r0" as BlockId).length).toBe(3);
    expect(getBlock(next, "table" as BlockId)?.attrs.columnWidths).toBeUndefined();
  });

  it("dirtyIds covers the table, every touched row, and the new cells/paragraphs", () => {
    const state = build2x2({ columnWidths: [0.5, 0.5] });
    const ctx = ctxAt(state, "r0p0"); // left of column 0
    const { dirtyIds } = insertTableColumn(state, ctx, "left", createTestAllocator("n"));

    // table attr (columnWidths) write
    expect(dirtyIds.has("table" as BlockId)).toBe(true);
    // each row's firstChildId rewired (new cell became first) + the old first cell's prevSibling
    expect(dirtyIds.has("r0" as BlockId)).toBe(true);
    expect(dirtyIds.has("r1" as BlockId)).toBe(true);
    expect(dirtyIds.has("r0c0" as BlockId)).toBe(true);
    expect(dirtyIds.has("r1c0" as BlockId)).toBe(true);
    // the new cells (n-0 for r0, n-2 for r1) + their paragraphs
    expect(dirtyIds.has("n-0" as BlockId)).toBe(true);
    expect(dirtyIds.has("n-1" as BlockId)).toBe(true);
    expect(dirtyIds.has("n-2" as BlockId)).toBe(true);
    expect(dirtyIds.has("n-3" as BlockId)).toBe(true);
  });
});
