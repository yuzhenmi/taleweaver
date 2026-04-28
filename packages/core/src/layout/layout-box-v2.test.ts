import { describe, it, expect } from "vitest";
import { INITIAL_COMPUTED_STYLE, type ComputedStyle } from "../styles";
import {
  type LayoutBox, type BlockBox, type LineBox, type TextRunBox,
  createBlockBox, createLineBox, createTextRunBox, createInlineBox, createInlineBlockBox, createMarkerBox,
  createTableBox, createTableRowBox, createTableCellBox,
} from "./layout-box-v2";

const cs = INITIAL_COMPUTED_STYLE;

describe("BlockBox", () => {
  it("constructs and freezes", () => {
    const b = createBlockBox("k", 0, 0, 100, 50, "horizontal-tb", "ltr", cs, []);
    expect(b.type).toBe("block");
    expect(b.x).toBe(0);
    expect(b.width).toBe(100);
    expect(Object.isFrozen(b)).toBe(true);
  });
});

describe("LineBox", () => {
  it("constructs with text-run children", () => {
    const tr = createTextRunBox("t", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, "hello");
    const line = createLineBox("l", 0, 0, 100, 16, "horizontal-tb", "ltr", cs, [tr]);
    expect(line.type).toBe("line");
    expect(line.children).toHaveLength(1);
  });
});

describe("LayoutBox union narrowing", () => {
  it("narrows by type", () => {
    const items: LayoutBox[] = [
      createBlockBox("a", 0, 0, 10, 10, "horizontal-tb", "ltr", cs, []),
      createLineBox("b", 0, 0, 10, 10, "horizontal-tb", "ltr", cs, []),
      createTextRunBox("c", 0, 0, 10, 10, "horizontal-tb", "ltr", cs, "x"),
    ];
    expect(items.filter((b): b is BlockBox => b.type === "block")).toHaveLength(1);
    expect(items.filter((b): b is LineBox => b.type === "line")).toHaveLength(1);
    expect(items.filter((b): b is TextRunBox => b.type === "text-run")).toHaveLength(1);
  });
});

describe("InlineBox", () => {
  it("constructs with children, fragmentEdge for first/last fragment", () => {
    const tr = createTextRunBox("t", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, "x");
    const inline = createInlineBox("i", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, [tr], "first");
    expect(inline.type).toBe("inline");
    expect(inline.fragmentEdge).toBe("first");
    expect(inline.children).toHaveLength(1);
  });

  it("supports four fragmentEdge values", () => {
    const tr = createTextRunBox("t", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, "x");
    const first   = createInlineBox("a", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, [tr], "first");
    const middle  = createInlineBox("b", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, [tr], "middle");
    const last    = createInlineBox("c", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, [tr], "last");
    const only    = createInlineBox("d", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, [tr], "only");
    expect([first, middle, last, only].map(b => b.fragmentEdge)).toEqual(["first", "middle", "last", "only"]);
  });
});

describe("InlineBlockBox", () => {
  it("constructs with children", () => {
    const tr = createTextRunBox("t", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, "x");
    const inlineBlock = createInlineBlockBox("ib", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, [tr]);
    expect(inlineBlock.type).toBe("inline-block");
    expect(inlineBlock.children).toHaveLength(1);
  });
});

describe("MarkerBox", () => {
  it("constructs with text content", () => {
    const m = createMarkerBox("m", -20, 0, 18, 16, "horizontal-tb", "ltr", cs, "•");
    expect(m.type).toBe("marker");
    expect(m.text).toBe("•");
  });
});

describe("Table layout boxes", () => {
  it("TableBox has columnPxWidths", () => {
    const t = createTableBox("t", 0, 0, 500, 200, "horizontal-tb", "ltr", cs, [], [200, 300]);
    expect(t.type).toBe("table");
    expect(t.columnPxWidths).toEqual([200, 300]);
  });

  it("TableRowBox holds cells", () => {
    const r = createTableRowBox("r", 0, 0, 500, 50, "horizontal-tb", "ltr", cs, []);
    expect(r.type).toBe("table-row");
  });

  it("TableCellBox holds content", () => {
    const c = createTableCellBox("c", 0, 0, 100, 30, "horizontal-tb", "ltr", cs, []);
    expect(c.type).toBe("table-cell");
  });
});

describe("Logical-to-physical mapping", () => {
  it("derives identity physical for LTR horizontal-tb", () => {
    const testCs: ComputedStyle = INITIAL_COMPUTED_STYLE;
    const b = createBlockBox(
      "k", 10, 20, 100, 50, "horizontal-tb", "ltr", testCs, [],
    );
    expect(b.inlineOffset).toBe(10);
    expect(b.blockOffset).toBe(20);
    expect(b.inlineSize).toBe(100);
    expect(b.blockSize).toBe(50);
    expect(b.x).toBe(10);
    expect(b.y).toBe(20);
    expect(b.width).toBe(100);
    expect(b.height).toBe(50);
  });
});
