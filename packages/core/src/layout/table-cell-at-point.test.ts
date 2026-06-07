import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "../render/render-node";
import { cascadePass } from "../cascade";
import { createMockShaper } from "./mock-shaper";
import { layoutTable } from "./table-fc";
import { makeRootContext } from "./layout-context";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import { resolveTableCellAtPoint } from "./table-cell-at-point";
import type { TableBox } from "./layout-box";

const shaper = createMockShaper(8, 16);

/** Lay out a table and return its TableBox (fixed column fractions over `width`). */
function layoutTableBox(node: ReturnType<typeof createElementBox>, width: number): TableBox {
  const cascaded = cascadePass(node);
  if (cascaded.type !== "element") throw new Error("?");
  const result = layoutTable(cascaded, 0, 0, makeRootContext(cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE, width), shaper);
  if (result.box === null) throw new Error("null");
  return result.box;
}

describe("resolveTableCellAtPoint (P8.S4 occupancy reverse lookup)", () => {
  it("a point in the lower region of a rowSpan-2 cell resolves to the spanning cell", () => {
    // A (col0, rowSpan2) | B (col1, row0)
    //   ↑ spans down       C (col1, row1)
    // cols [200,200], rows [16,16]: row0 block [0,16), row1 block [16,32).
    const a = createElementBox("a", { display: "table-cell" }, [createTextBox("ta", {}, "a")], { rowSpan: 2 });
    const b = createElementBox("b", { display: "table-cell" }, [createTextBox("tb", {}, "b")]);
    const c = createElementBox("c", { display: "table-cell" }, [createTextBox("tc", {}, "c")]);
    const table = layoutTableBox(
      createElementBox("t", { display: "table" }, [
        createElementBox("r0", { display: "table-row" }, [a, b]),
        createElementBox("r1", { display: "table-row" }, [c]),
      ], { columnWidths: [0.5, 0.5] }),
      400,
    );

    // row0/col0 → A; row1/col0 (BELOW A's origin) → A (spans down, the key case).
    expect(resolveTableCellAtPoint(table, 50, 8)?.key).toBe("a");
    expect(resolveTableCellAtPoint(table, 50, 24)?.key).toBe("a");
    // col1 stays per-row: B in row0, C in row1.
    expect(resolveTableCellAtPoint(table, 250, 8)?.key).toBe("b");
    expect(resolveTableCellAtPoint(table, 250, 24)?.key).toBe("c");
  });

  it("a point anywhere across a colSpan-2 banner resolves to the banner", () => {
    // banner (colSpan2, row0) over a (col0) / b (col1) in row1.
    const banner = createElementBox("c0", { display: "table-cell" }, [createTextBox("t0", {}, "x")], { colSpan: 2 });
    const a = createElementBox("c1a", { display: "table-cell" }, [createTextBox("t1", {}, "y")]);
    const b = createElementBox("c1b", { display: "table-cell" }, [createTextBox("t2", {}, "z")]);
    const table = layoutTableBox(
      createElementBox("t", { display: "table" }, [
        createElementBox("r0", { display: "table-row" }, [banner]),
        createElementBox("r1", { display: "table-row" }, [a, b]),
      ], { columnWidths: [0.5, 0.5] }),
      400,
    );

    // Both columns in row0 belong to the banner; row1 splits a | b.
    expect(resolveTableCellAtPoint(table, 50, 8)?.key).toBe("c0");
    expect(resolveTableCellAtPoint(table, 250, 8)?.key).toBe("c0");
    expect(resolveTableCellAtPoint(table, 50, 24)?.key).toBe("c1a");
    expect(resolveTableCellAtPoint(table, 250, 24)?.key).toBe("c1b");
  });

  it("clamps out-of-band points to the nearest edge cell", () => {
    const a = createElementBox("a", { display: "table-cell" }, [createTextBox("ta", {}, "a")]);
    const b = createElementBox("b", { display: "table-cell" }, [createTextBox("tb", {}, "b")]);
    const table = layoutTableBox(
      createElementBox("t", { display: "table" }, [
        createElementBox("r0", { display: "table-row" }, [a, b]),
      ], { columnWidths: [0.5, 0.5] }),
      400,
    );
    expect(resolveTableCellAtPoint(table, -5, -5)?.key).toBe("a"); // above-left → first cell
    expect(resolveTableCellAtPoint(table, 9999, 9999)?.key).toBe("b"); // past end → last cell
  });

  it("1×1 grid: every point resolves to its own cell (byte-identical mapping)", () => {
    const a = createElementBox("a", { display: "table-cell" }, [createTextBox("ta", {}, "a")]);
    const b = createElementBox("b", { display: "table-cell" }, [createTextBox("tb", {}, "b")]);
    const c = createElementBox("c", { display: "table-cell" }, [createTextBox("tc", {}, "c")]);
    const d = createElementBox("d", { display: "table-cell" }, [createTextBox("td", {}, "d")]);
    const table = layoutTableBox(
      createElementBox("t", { display: "table" }, [
        createElementBox("r0", { display: "table-row" }, [a, b]),
        createElementBox("r1", { display: "table-row" }, [c, d]),
      ], { columnWidths: [0.5, 0.5] }),
      400,
    );
    expect(resolveTableCellAtPoint(table, 50, 8)?.key).toBe("a");
    expect(resolveTableCellAtPoint(table, 250, 8)?.key).toBe("b");
    expect(resolveTableCellAtPoint(table, 50, 24)?.key).toBe("c");
    expect(resolveTableCellAtPoint(table, 250, 24)?.key).toBe("d");
  });
});
