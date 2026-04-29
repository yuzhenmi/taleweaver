import { describe, it, expect } from "vitest";
import { INITIAL_COMPUTED_STYLE, type ComputedStyle } from "../styles";
import { computeUsedStyle } from "./used-style";
import {
  type LayoutBox, type BlockBox, type LineBox, type TextRunBox,
  createBlockBox, createLineBox, createTextRunBox, createInlineBox, createInlineBlockBox, createMarkerBox,
  createTableBox, createTableRowBox, createTableCellBox,
} from "./layout-box-v2";

const cs = INITIAL_COMPUTED_STYLE;
const us = computeUsedStyle(cs, 100);

describe("BlockBox", () => {
  it("constructs and freezes", () => {
    const b = createBlockBox("k", 0, 0, 100, 50, "horizontal-tb", "ltr", cs, us, []);
    expect(b.type).toBe("block");
    expect(b.x).toBe(0);
    expect(b.width).toBe(100);
    expect(Object.isFrozen(b)).toBe(true);
  });
});

describe("LineBox", () => {
  it("constructs with text-run children", () => {
    const tr = createTextRunBox("t", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, "hello");
    const line = createLineBox("l", 0, 0, 100, 16, "horizontal-tb", "ltr", cs, us, [tr]);
    expect(line.type).toBe("line");
    expect(line.children).toHaveLength(1);
  });
});

describe("LayoutBox union narrowing", () => {
  it("narrows by type", () => {
    const items: LayoutBox[] = [
      createBlockBox("a", 0, 0, 10, 10, "horizontal-tb", "ltr", cs, us, []),
      createLineBox("b", 0, 0, 10, 10, "horizontal-tb", "ltr", cs, us, []),
      createTextRunBox("c", 0, 0, 10, 10, "horizontal-tb", "ltr", cs, us, "x"),
    ];
    expect(items.filter((b): b is BlockBox => b.type === "block")).toHaveLength(1);
    expect(items.filter((b): b is LineBox => b.type === "line")).toHaveLength(1);
    expect(items.filter((b): b is TextRunBox => b.type === "text-run")).toHaveLength(1);
  });
});

describe("InlineBox", () => {
  it("constructs with children, fragmentEdge for first/last fragment", () => {
    const tr = createTextRunBox("t", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, "x");
    const inline = createInlineBox("i", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, [tr], "first");
    expect(inline.type).toBe("inline");
    expect(inline.fragmentEdge).toBe("first");
    expect(inline.children).toHaveLength(1);
  });

  it("supports four fragmentEdge values", () => {
    const tr = createTextRunBox("t", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, "x");
    const first   = createInlineBox("a", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, [tr], "first");
    const middle  = createInlineBox("b", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, [tr], "middle");
    const last    = createInlineBox("c", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, [tr], "last");
    const only    = createInlineBox("d", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, [tr], "only");
    expect([first, middle, last, only].map(b => b.fragmentEdge)).toEqual(["first", "middle", "last", "only"]);
  });
});

describe("InlineBlockBox", () => {
  it("constructs with children", () => {
    const tr = createTextRunBox("t", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, "x");
    const inlineBlock = createInlineBlockBox("ib", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, [tr]);
    expect(inlineBlock.type).toBe("inline-block");
    expect(inlineBlock.children).toHaveLength(1);
  });
});

describe("MarkerBox", () => {
  it("constructs with text content", () => {
    const m = createMarkerBox("m", -20, 0, 18, 16, "horizontal-tb", "ltr", cs, us, "•");
    expect(m.type).toBe("marker");
    expect(m.text).toBe("•");
  });
});

describe("Table layout boxes", () => {
  it("TableBox has columnPxWidths", () => {
    const t = createTableBox("t", 0, 0, 500, 200, "horizontal-tb", "ltr", cs, us, [], [200, 300]);
    expect(t.type).toBe("table");
    expect(t.columnPxWidths).toEqual([200, 300]);
  });

  it("TableRowBox holds cells", () => {
    const r = createTableRowBox("r", 0, 0, 500, 50, "horizontal-tb", "ltr", cs, us, []);
    expect(r.type).toBe("table-row");
  });

  it("TableCellBox holds content", () => {
    const c = createTableCellBox("c", 0, 0, 100, 30, "horizontal-tb", "ltr", cs, us, []);
    expect(c.type).toBe("table-cell");
  });
});

describe("Logical-to-physical mapping", () => {
  it("derives identity physical for LTR horizontal-tb", () => {
    const testCs: ComputedStyle = INITIAL_COMPUTED_STYLE;
    const testUs = computeUsedStyle(testCs, 100);
    const b = createBlockBox(
      "k", 10, 20, 100, 50, "horizontal-tb", "ltr", testCs, testUs, [],
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

it("RTL horizontal-tb inverts physical x from inline-offset", () => {
  const testCs: ComputedStyle = INITIAL_COMPUTED_STYLE;
  const testUs = computeUsedStyle(testCs, 500);
  // Place a 100px box at inline-offset 30 in a 500px-inline-size container.
  // RTL: physical x = 500 - 30 - 100 = 370
  const b = createBlockBox(
    "k", 30, 0, 100, 50, "horizontal-tb", "rtl", testCs, testUs, [],
    /* metadata */ undefined,
    /* containingInlineSize */ 500,
  );
  expect(b.inlineOffset).toBe(30);
  expect(b.x).toBe(370);
  expect(b.y).toBe(0);
  expect(b.width).toBe(100);
  expect(b.height).toBe(50);
});

it("LTR horizontal-tb is unaffected by containingInlineSize", () => {
  const testCs: ComputedStyle = INITIAL_COMPUTED_STYLE;
  const testUs = computeUsedStyle(testCs, 500);
  const b = createBlockBox(
    "k", 30, 0, 100, 50, "horizontal-tb", "ltr", testCs, testUs, [],
    /* metadata */ undefined,
    /* containingInlineSize */ 500,
  );
  expect(b.x).toBe(30);
});
