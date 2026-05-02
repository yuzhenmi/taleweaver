// packages/core/src/layout/__tests__/table-fc-fragmentation.test.ts
import { describe, it, expect } from "vitest";
import type { FragmentationContext } from "../fragmentation";
import { layoutTable } from "../table-fc";
import { makeRootContext } from "../layout-context";
import { INITIAL_COMPUTED_STYLE } from "../../styles";
import { createMockShaper } from "../mock-shaper";
import { cascadePass } from "../../cascade";
import { createElementBox, createTextBox } from "../../render/render-node-v2";
import type { ElementBox } from "../../render/render-node-v2";

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
