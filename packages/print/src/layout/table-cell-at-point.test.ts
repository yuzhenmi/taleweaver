import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { createMockShaper } from "@taleweaver/core";
import { layoutTable } from "./table-fc";
import { makeRootContext } from "./layout-context";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { locateTableCellAtPoint } from "./table-cell-at-point";
import type { TableBox } from "./layout-box";

const shaper = createMockShaper(8, 16);

/** Lay out a table and return its TableBox (fixed column fractions over `width`). */
function layoutTableBox(node: ReturnType<typeof createElementBox>, width: number): TableBox {
  const cascaded = cascadePass(node);
  if (cascaded.type !== "element") throw new Error("?");
  const result = layoutTable(cascaded, 0, 0, makeRootContext(cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE, width), shaper, undefined);
  if (result.box === null) throw new Error("null");
  return result.box;
}

describe("locateTableCellAtPoint (P8.S4b positioned-tree cell locator)", () => {
  // layoutTable output is already positioned (createBoxBase bakes physical x/y),
  // so the TableBox itself is a valid non-paginated root at origin (0,0).
  it("locates the owning cell by physical rect — incl. a rowSpan cell's lower region", () => {
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
    // cols [200,200], rows [16,16]. A spans col0 rows 0–1 → physical rect [0,0,200,32].
    expect(locateTableCellAtPoint(table, 50, 8)?.cell.key).toBe("a");
    expect(locateTableCellAtPoint(table, 250, 8)?.cell.key).toBe("b");
    expect(locateTableCellAtPoint(table, 250, 24)?.cell.key).toBe("c");
    // Lower region (y=24 is in row 1's band) → the spanning cell A, and its
    // returned origin is the TOP row's origin (0,0) — NOT row 1's — so the next
    // increment's line-filter spans the full merged region.
    const locA = locateTableCellAtPoint(table, 50, 24);
    expect(locA?.cell.key).toBe("a");
    expect(locA?.absX).toBe(0);
    expect(locA?.absY).toBe(0);
    // A non-spanning cell's origin is its own physical top-left.
    const locC = locateTableCellAtPoint(table, 250, 24);
    expect(locC?.absX).toBe(200);
    expect(locC?.absY).toBe(16);
  });

  it("returns null for a point outside the table", () => {
    const a = createElementBox("a", { display: "table-cell" }, [createTextBox("ta", {}, "a")]);
    const b = createElementBox("b", { display: "table-cell" }, [createTextBox("tb", {}, "b")]);
    const table = layoutTableBox(
      createElementBox("t", { display: "table" }, [
        createElementBox("r0", { display: "table-row" }, [a, b]),
      ], { columnWidths: [0.5, 0.5] }),
      400,
    );
    expect(locateTableCellAtPoint(table, 50, 9999)).toBeNull(); // below the table
    expect(locateTableCellAtPoint(table, 9999, 8)).toBeNull(); // right of the table
  });
});
