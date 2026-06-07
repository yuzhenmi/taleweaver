import { describe, it, expect } from "vitest";
import { resolveTableContext, getChildIds } from "./table-context";
import { buildBlock, buildState, inlineContent } from "../test-utils/state-builders";
import type { BlockId } from "./block-id";
import type { Block } from "./block";

/**
 * doc
 *  └ table [columnWidths 0.5/0.5]
 *     ├ row0 → cA(pA), cB(pB)
 *     └ row1 → cC(pC), cD(pD)
 * Extra cell attrs let individual tests inject a span / ragged shape.
 */
function buildTableState(opts?: {
  cAattrs?: Record<string, unknown>;
  dropCellD?: boolean;
}): ReturnType<typeof buildState> {
  const blocks: Block[] = [
    buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
    buildBlock({
      id: "table", type: "table", parentId: "doc",
      attrs: { columnWidths: [0.5, 0.5] },
      firstChildId: "row0", lastChildId: "row1",
    }),
    buildBlock({ id: "row0", type: "table-row", parentId: "table", nextSiblingId: "row1", firstChildId: "cA", lastChildId: "cB" }),
    buildBlock({ id: "row1", type: "table-row", parentId: "table", prevSiblingId: "row0", firstChildId: "cC", lastChildId: opts?.dropCellD ? "cC" : "cD" }),
    buildBlock({ id: "cA", type: "table-cell", parentId: "row0", nextSiblingId: "cB", firstChildId: "pA", lastChildId: "pA", attrs: opts?.cAattrs }),
    buildBlock({ id: "cB", type: "table-cell", parentId: "row0", prevSiblingId: "cA", firstChildId: "pB", lastChildId: "pB" }),
    buildBlock({ id: "cC", type: "table-cell", parentId: "row1", nextSiblingId: opts?.dropCellD ? null : "cD", firstChildId: "pC", lastChildId: "pC" }),
    buildBlock({ id: "pA", type: "paragraph", parentId: "cA", inlineContent: inlineContent([]) }),
    buildBlock({ id: "pB", type: "paragraph", parentId: "cB", inlineContent: inlineContent([]) }),
    buildBlock({ id: "pC", type: "paragraph", parentId: "cC", inlineContent: inlineContent([]) }),
  ];
  if (!opts?.dropCellD) {
    blocks.push(
      buildBlock({ id: "cD", type: "table-cell", parentId: "row1", prevSiblingId: "cC", firstChildId: "pD", lastChildId: "pD" }),
      buildBlock({ id: "pD", type: "paragraph", parentId: "cD", inlineContent: inlineContent([]) }),
    );
  }
  return buildState({ rootId: "doc", blocks });
}

describe("getChildIds", () => {
  it("returns the document-order child ids of a parent", () => {
    const state = buildTableState();
    expect(getChildIds(state, "table" as BlockId)).toEqual(["row0", "row1"]);
    expect(getChildIds(state, "row0" as BlockId)).toEqual(["cA", "cB"]);
  });
  it("returns [] for a missing or childless block", () => {
    const state = buildTableState();
    expect(getChildIds(state, "nope" as BlockId)).toEqual([]);
    expect(getChildIds(state, "pA" as BlockId)).toEqual([]);
  });
});

describe("resolveTableContext", () => {
  it("resolves the full grid context from a caret inside a cell's paragraph", () => {
    const state = buildTableState();
    const ctx = resolveTableContext(state, "pD" as BlockId);
    expect(ctx).not.toBeNull();
    if (ctx === null) throw new Error("expected ctx");
    expect(ctx.tableId).toBe("table");
    expect(ctx.rowId).toBe("row1");
    expect(ctx.cellId).toBe("cD");
    expect(ctx.rowIndex).toBe(1);
    expect(ctx.colIndex).toBe(1);
    expect(ctx.rowIds).toEqual(["row0", "row1"]);
    expect(ctx.cellIdsByRow).toEqual([["cA", "cB"], ["cC", "cD"]]);
    expect(ctx.hasSpans).toBe(false);
    expect(ctx.spanned).toBe(false);
    expect(ctx.ragged).toBe(false);
  });

  it("resolves when given the cell id directly", () => {
    const state = buildTableState();
    const ctx = resolveTableContext(state, "cA" as BlockId);
    expect(ctx?.colIndex).toBe(0);
    expect(ctx?.rowIndex).toBe(0);
  });

  it("returns null when the block is not inside a table", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
    });
    expect(resolveTableContext(state, "p" as BlockId)).toBeNull();
    expect(resolveTableContext(state, "missing" as BlockId)).toBeNull();
  });

  it("returns null for a table inside a NON-main tree (header/footer body) — ops are main-tree-only", () => {
    // A full table tree lives in templateContents (a header/footer body), not the
    // main tree. ancestorChain resolves it (cross-tree), but getBlock is main-tree
    // only, so no table-cell matches → null (the main-tree guard).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
      templateContents: [
        buildBlock({ id: "tplTable", type: "table", firstChildId: "tplRow", lastChildId: "tplRow" }),
        buildBlock({ id: "tplRow", type: "table-row", parentId: "tplTable", firstChildId: "tplCell", lastChildId: "tplCell" }),
        buildBlock({ id: "tplCell", type: "table-cell", parentId: "tplRow", firstChildId: "tplPara", lastChildId: "tplPara" }),
        buildBlock({ id: "tplPara", type: "paragraph", parentId: "tplCell", inlineContent: inlineContent([]) }),
      ],
    });
    expect(resolveTableContext(state, "tplPara" as BlockId)).toBeNull();
  });

  it("flags hasSpans/spanned when any cell carries a real rowSpan/colSpan", () => {
    const state = buildTableState({ cAattrs: { colSpan: 2 } });
    const ctx = resolveTableContext(state, "pA" as BlockId);
    expect(ctx?.hasSpans).toBe(true);
    // spanned (well-formed merged cells) → P15b routes to the span-aware op.
    expect(ctx?.spanned).toBe(true);
    expect(ctx?.ragged).toBe(false);
  });

  it("does NOT flag a malformed (non-integer) span — agrees with the component predicate", () => {
    const state = buildTableState({ cAattrs: { colSpan: 1.5 } });
    const ctx = resolveTableContext(state, "pA" as BlockId);
    expect(ctx?.hasSpans).toBe(false);
  });

  it("flags hasSpans/ragged for a ragged table (rows with differing cell counts)", () => {
    const state = buildTableState({ dropCellD: true }); // row1 has 1 cell, row0 has 2
    const ctx = resolveTableContext(state, "pA" as BlockId);
    expect(ctx).not.toBeNull();
    expect(ctx?.hasSpans).toBe(true);
    // ragged (degenerate) → P15b LEAVES IT GATED (a handler checks `ragged` first
    // so a spanned-AND-ragged table still no-ops — the ragged gate wins).
    expect(ctx?.ragged).toBe(true);
    expect(ctx?.spanned).toBe(false);
  });
});
