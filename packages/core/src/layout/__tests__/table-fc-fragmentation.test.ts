// packages/core/src/layout/__tests__/table-fc-fragmentation.test.ts
import { describe, it, expect } from "vitest";
import type { FragmentationContext } from "../fragmentation";
import { layoutTable } from "../table-fc";
import { makeRootContext } from "../layout-context";
import { INITIAL_COMPUTED_STYLE } from "../../styles";
import { createMockShaper } from "../mock-shaper";
import { cascadePass } from "../../cascade";
import { createElementBox, createTextBox } from "../../render/render-node";
import type { ElementBox } from "../../render/render-node";

/** Build a simple table with N body rows, fixed row height via blockSize style. */
function buildSimpleTable(numBodyRows: number, rowHeight: number = 30): ElementBox {
  const rows = Array.from({ length: numBodyRows }, (_, i) =>
    createElementBox(`row-${i}`, { display: "table-row", blockSize: rowHeight }, [
      createElementBox(`cell-${i}-0`, { display: "table-cell" }, [
        createTextBox(`t-${i}`, {}, "x"),
      ]),
    ]),
  );
  const table = createElementBox("table", { display: "table" }, rows);
  const cascaded = cascadePass(table);
  if (cascaded.type !== "element") throw new Error("cascadePass returned non-element");
  return cascaded;
}

describe("Table FC fragmentation — row-level split", () => {
  it("places all rows when table fits", () => {
    const table = buildSimpleTable(3, 30);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 200, pageIndex: 0, resumeFrom: null,
    };
    const { box, breakToken } = layoutTable(table, 0, 0, ctx, shaper, fragmentation);
    expect(box).not.toBeNull();
    expect(breakToken).toBeNull();
    // Verify some rows present:
    expect(box!.children.length).toBeGreaterThan(0);
  });

  it("stops at the row that overflows; returns TableBreakToken", () => {
    const table = buildSimpleTable(5, 30); // 5 rows × 30 = 150
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 90, // fits 3 rows (3 × 30 = 90)
      pageIndex: 0, resumeFrom: null,
    };
    const { box, breakToken } = layoutTable(table, 0, 0, ctx, shaper, fragmentation);
    expect(box).not.toBeNull();
    expect(breakToken).toEqual({ type: "table", resumeAtRow: 3 });
  });

  it("returns box: null + TableBreakToken at row 0 when even the first row doesn't fit", () => {
    const table = buildSimpleTable(5, 100);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 50, pageIndex: 0, resumeFrom: null,
    };
    const { box, breakToken } = layoutTable(table, 0, 0, ctx, shaper, fragmentation);
    expect(box).toBeNull();
    expect(breakToken).toEqual({ type: "table", resumeAtRow: 0 });
  });
});

// ---------------------------------------------------------------------------
// E.3 — Resume from TableBreakToken
// ---------------------------------------------------------------------------

describe("Table FC fragmentation — resume from TableBreakToken", () => {
  it("skips body rows 0..resumeAtRow-1 when resuming", () => {
    const table = buildSimpleTable(8, 30);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    const r1 = layoutTable(table, 0, 0, ctx, shaper, {
      availableBlockSize: 120, pageIndex: 0, resumeFrom: null,
    });
    expect(r1.breakToken).toEqual({ type: "table", resumeAtRow: 4 });
    const r2 = layoutTable(table, 0, 0, ctx, shaper, {
      availableBlockSize: 200, pageIndex: 1, resumeFrom: r1.breakToken,
    });
    expect(r2.box).not.toBeNull();
    expect(r2.breakToken).toBeNull();
    // Verify body rows 4..7 placed (4 rows × 30 = 120 total).
    expect(r2.box!.children.length).toBe(4);
    expect(r2.box!.blockSize).toBe(120);
  });

  it("throws when given a non-Table top-level resumeFrom token", () => {
    const table = buildSimpleTable(3, 30);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    expect(() =>
      layoutTable(table, 0, 0, ctx, shaper, {
        availableBlockSize: 100, pageIndex: 0,
        resumeFrom: { type: "ifc", resumeAtLine: 0 },
      }),
    ).toThrow(/expected.*TableBreakToken/i);
  });
});

// ---------------------------------------------------------------------------
// S5.T3 — rowSpan cell straddling a page break (emit spanningCells)
// ---------------------------------------------------------------------------

/**
 * 2-col table whose col-0 cell A spans both body rows and has a 2-block (2-line)
 * interior; col-1 has a 1-line cell per row.  cols are 50/50 via columnWidths.
 *
 *   ┌─────────────┬──────┐
 *   │ A (rowSpan2 │  B   │ row0
 *   │  2 blocks)  ├──────┤
 *   │             │  C   │ row1
 *   └─────────────┴──────┘
 */
function blockLine(key: string): ElementBox {
  return createElementBox(key, { display: "block" }, [createTextBox(`${key}-t`, {}, "x")]);
}

/** col-0 cell A spans both rows; `aLines` block children give A its interior height. */
function buildRowSpanTable(aLines: readonly string[], cLines: readonly string[]): ElementBox {
  const cellA = createElementBox(
    "cellA",
    { display: "table-cell" },
    aLines.map(blockLine),
    { rowSpan: 2 },
  );
  const cellB = createElementBox("cellB", { display: "table-cell" }, [blockLine("b0")]);
  const cellC = createElementBox("cellC", { display: "table-cell" }, cLines.map(blockLine));
  const row0 = createElementBox("row-0", { display: "table-row" }, [cellA, cellB]);
  const row1 = createElementBox("row-1", { display: "table-row" }, [cellC]);
  // Force 50/50 columns so intrinsic sizing doesn't affect the geometry. Pass the
  // metadata through createElementBox so the result is a properly frozen ElementBox.
  const table = createElementBox(
    "table",
    { display: "table" },
    [row0, row1],
    { columnWidths: [0.5, 0.5] },
  );
  const cascaded = cascadePass(table);
  if (cascaded.type !== "element") throw new Error("cascadePass returned non-element");
  return cascaded;
}

describe("Table FC fragmentation — rowSpan cell crossing the break (S5)", () => {
  it("fragments the spanning cell's interior and emits a spanningCells continuation", () => {
    // A's interior is 2 blocks (32 tall); B and C are single-line (16). With
    // rowHeights [16,16], A's content SPILLS past the break → non-null interior token.
    const table = buildRowSpanTable(["a0", "a1"], ["c0"]);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    // rowHeights = [16, 16] (B and C are single-line; A's 32-tall interior is
    // covered by the two 16 rows so §17.5.3 adds no deficit). availableBlockSize
    // 20 fits row0 (16) but not row0+row1 (32) → break after row0, INSIDE A's span.
    const { box, breakToken } = layoutTable(table, 0, 0, ctx, shaper, {
      availableBlockSize: 20, pageIndex: 0, resumeFrom: null,
    });

    expect(box).not.toBeNull();
    expect(breakToken).not.toBeNull();
    if (breakToken === null || breakToken.type !== "table") {
      throw new Error("expected a TableBreakToken");
    }
    expect(breakToken.resumeAtRow).toBe(1);

    // A straddles the break: its origin (row 0) is placed but its span reaches
    // row 1, which resumes next page.
    const spanning = breakToken.spanningCells ?? [];
    expect(spanning.length).toBe(1);
    const cont = spanning[0];
    expect(cont.cellId).toBe("cellA");
    expect(cont.gridRow).toBe(0);
    expect(cont.gridCol).toBe(0);
    expect(cont.rowSpan).toBe(2);
    expect(cont.colSpan).toBe(1);
    // Its interior split: the second block resumes next page.
    expect(cont.interiorBreakToken).not.toBeNull();

    // A's placed box is trimmed to the placed portion (one row tall = 16), NOT
    // the full merged 32 that would overflow the page.
    if (box === null) throw new Error("expected a table box");
    const placedRow0 = box.children[0];
    if (placedRow0.type !== "table-row") throw new Error("expected a table-row");
    const placedA = placedRow0.children.find((c) => c.key === "cellA");
    if (placedA === undefined || placedA.type !== "table-cell") {
      throw new Error("cell A not found in placed row");
    }
    expect(placedA.blockSize).toBe(16);
    // The placed fragment carries only the first block.
    expect(placedA.children.length).toBe(1);
  });

  it("emits a null-interior continuation when the cell's content fits but its box still spans the break (empty tail)", () => {
    // A's interior is a single line (16) — it fits entirely within row 0. But A
    // spans rows 0–1 and row 1 is 32 tall (cellC has 2 blocks), so A's MERGED box
    // (16 + 32 = 48) still extends past a break taken after row 0. The cell must
    // be trimmed AND a continuation emitted (so resume keeps col 0 occupied),
    // with interiorBreakToken === null because there is no remaining content.
    const table = buildRowSpanTable(["a0"], ["c0", "c1"]);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    // rowHeights = [16, 32]; availableBlockSize 20 fits row0 (16) but not
    // row0+row1 (48) → break after row0, inside A's span.
    const { box, breakToken } = layoutTable(table, 0, 0, ctx, shaper, {
      availableBlockSize: 20, pageIndex: 0, resumeFrom: null,
    });

    if (breakToken === null || breakToken.type !== "table") {
      throw new Error("expected a TableBreakToken");
    }
    expect(breakToken.resumeAtRow).toBe(1);

    const spanning = breakToken.spanningCells ?? [];
    expect(spanning.length).toBe(1);
    const cont = spanning[0];
    expect(cont.cellId).toBe("cellA");
    expect(cont.rowSpan).toBe(2);
    // Content fit in the placed row → no remaining interior to lay out.
    expect(cont.interiorBreakToken).toBeNull();

    // A's box is still trimmed to the placed portion (16), not the merged 48.
    if (box === null) throw new Error("expected a table box");
    const placedRow0 = box.children[0];
    if (placedRow0.type !== "table-row") throw new Error("expected a table-row");
    const placedA = placedRow0.children.find((c) => c.key === "cellA");
    if (placedA === undefined || placedA.type !== "table-cell") {
      throw new Error("cell A not found in placed row");
    }
    expect(placedA.blockSize).toBe(16);
    // The whole interior fit, so the trimmed cell carries its one block.
    expect(placedA.children.length).toBe(1);
  });
});
