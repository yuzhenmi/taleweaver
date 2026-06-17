import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { layoutBlock } from "../layout/bfc";
import { layoutTable } from "../layout/table-fc";
import { createMockShaper } from "@taleweaver/core";
import { makeRootContext } from "../layout/layout-context";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import type { LayoutBox } from "../layout/layout-box";

const shaper = createMockShaper(10, 16);

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

function findBoxByKey(box: LayoutBox, key: string): LayoutBox | null {
  if (box.key === key) return box;
  if ("children" in box) {
    for (const c of box.children) {
      const r = findBoxByKey(c, key);
      if (r) return r;
    }
  }
  return null;
}

describe("Anonymous box generation — end-to-end", () => {
  it("doc with mixed block + inline children produces line boxes between blocks", () => {
    const t1 = createTextBox("t1", { display: "inline" }, "intro");
    const para = createElementBox(
      "p", { display: "block" },
      [createTextBox("p-text", { display: "inline" }, "paragraph")],
    );
    const t2 = createTextBox("t2", { display: "inline" }, "outro");
    const doc = createElementBox("doc", { display: "block" }, [t1, para, t2]);
    const cascaded = cascadePass(doc);
    if (cascaded.type !== "element") throw new Error();

    const ctx = makeRootContext(cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE, 500);
    const outResult = layoutBlock(cascaded, 0, 0, ctx, shaper, undefined);
    if (outResult.box === null) throw new Error("layoutBlock returned null box");
    const out = outResult.box;

    expect(out.type).toBe("block");
    if (out.type !== "block") throw new Error();
    // Doc's children: line(s) for "intro", then paragraph block, then line(s) for "outro"
    expect(nth(out.children, 0, "first child").type).toBe("line");
    expect(out.children.some(c => c.type === "block" && c.key === "p")).toBe(true);
    // Last child should be a line (for "outro")
    expect(nth(out.children, out.children.length - 1, "last child").type).toBe("line");
  });

  it("table with bare table-cell direct children: cells appear in anonymous row", () => {
    const c1 = createElementBox(
      "c1", { display: "table-cell" },
      [createTextBox("t1", { display: "inline" }, "a")],
    );
    const c2 = createElementBox(
      "c2", { display: "table-cell" },
      [createTextBox("t2", { display: "inline" }, "b")],
    );
    const table = createElementBox("tbl", { display: "table" }, [c1, c2]);
    const cascaded = cascadePass(table);
    if (cascaded.type !== "element") throw new Error();

    const ctx = makeRootContext(cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE, 200);
    const tableResult = layoutTable(cascaded, 0, 0, ctx, shaper, undefined);
    if (tableResult.box === null) throw new Error("layoutTable returned null box; should be unreachable in B.3 (fragmentation not yet wired)");
    const out = tableResult.box;

    expect(out.type).toBe("table");
    // Should have a single (anonymous) row containing both cells.
    expect(out.children).toHaveLength(1);
    const row = nth(out.children, 0, "row");
    expect(row.type).toBe("table-row");
    if (row.type !== "table-row") throw new Error();
    expect(row.children.length).toBeGreaterThanOrEqual(2);
    // Both cells present
    expect(row.children.find(c => c.key === "c1")).toBeDefined();
    expect(row.children.find(c => c.key === "c2")).toBeDefined();
  });

  it("table-row with paragraph child: paragraph wrapped in anonymous cell", () => {
    const para = createElementBox(
      "p", { display: "block" },
      [createTextBox("t", { display: "inline" }, "hello")],
    );
    const row = createElementBox("r", { display: "table-row" }, [para]);
    const table = createElementBox("tbl", { display: "table" }, [row]);
    const cascaded = cascadePass(table);
    if (cascaded.type !== "element") throw new Error();

    const ctx = makeRootContext(cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE, 500);
    const tableResult = layoutTable(cascaded, 0, 0, ctx, shaper, undefined);
    if (tableResult.box === null) throw new Error("layoutTable returned null box; should be unreachable in B.3 (fragmentation not yet wired)");
    const out = tableResult.box;

    expect(out.type).toBe("table");
    // The row should contain at least one cell (anonymous) wrapping the paragraph.
    const rowBox = findBoxByKey(out, "r");
    expect(rowBox).not.toBeNull();
    if (!rowBox || rowBox.type !== "table-row") throw new Error();
    expect(rowBox.children.length).toBeGreaterThanOrEqual(1);
    // The cell (anonymous) should contain the paragraph.
    const firstCell = nth(rowBox.children, 0, "first cell");
    expect(firstCell.type).toBe("table-cell");
  });
});
