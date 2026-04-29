import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "../render/render-node-v2";
import { cascadePass } from "../cascade";
import { layoutBlock } from "../layout/bfc";
import { layoutTable } from "../layout/table-fc";
import { createMockShaper } from "../layout/mock-shaper";
import { makeRootContext } from "../layout/layout-context";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import type { LayoutBox } from "../layout/layout-box-v2";

const shaper = createMockShaper(10, 16);

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
    const out = layoutBlock(cascaded, 0, 0, ctx, shaper);

    expect(out.type).toBe("block");
    if (out.type !== "block") throw new Error();
    // Doc's children: line(s) for "intro", then paragraph block, then line(s) for "outro"
    expect(out.children[0].type).toBe("line");
    expect(out.children.some(c => c.type === "block" && c.key === "p")).toBe(true);
    // Last child should be a line (for "outro")
    expect(out.children[out.children.length - 1].type).toBe("line");
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
    const out = layoutTable(cascaded, 0, 0, ctx, shaper);

    expect(out.type).toBe("table");
    // Should have a single (anonymous) row containing both cells.
    expect(out.children).toHaveLength(1);
    const row = out.children[0];
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
    const out = layoutTable(cascaded, 0, 0, ctx, shaper);

    expect(out.type).toBe("table");
    // The row should contain at least one cell (anonymous) wrapping the paragraph.
    const rowBox = findBoxByKey(out, "r");
    expect(rowBox).not.toBeNull();
    if (!rowBox || rowBox.type !== "table-row") throw new Error();
    expect(rowBox.children.length).toBeGreaterThanOrEqual(1);
    // The cell (anonymous) should contain the paragraph.
    const firstCell = rowBox.children[0];
    expect(firstCell.type).toBe("table-cell");
  });
});
