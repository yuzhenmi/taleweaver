import { describe, it, expect } from "vitest";
import { INITIAL_COMPUTED_STYLE, type ComputedStyle } from "@taleweaver/core";
import type { BlockId } from "@taleweaver/core";
import { computeUsedStyle } from "./used-style";
import {
  type LayoutBox, type BlockBox, type LineBox, type TextRunBox,
  createBlockBox, createLineBox, createTextRunBox, createInlineBox, createInlineBlockBox, createMarkerBox,
  createTableBox, createTableRowBox, createTableCellBox, createMultiColumnBox,
  withInlineOffset, withBlockOffset, withOffsets, withBidiLevel,
  withPhysicalInlineOffset,
  assertLayoutBoxConsistent,
} from "./layout-box";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const cs = INITIAL_COMPUTED_STYLE;
const us = computeUsedStyle(cs, 100, "indefinite");

describe("BlockBox", () => {
  it("constructs and freezes", () => {
    const b = createBlockBox("k", 0, 0, 100, 50, "horizontal-tb", "ltr", cs, us, [], 100);
    expect(b.type).toBe("block");
    expect(b.x).toBe(0);
    expect(b.width).toBe(100);
    expect(Object.isFrozen(b)).toBe(true);
  });
});

describe("LineBox", () => {
  it("constructs with text-run children", () => {
    const tr = createTextRunBox("t", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, "hello", 5, 50);
    const line = createLineBox("l", 0, 0, 100, 16, "horizontal-tb", "ltr", cs, us, [tr], 16, 100, "owner" as BlockId, 0, 5, true);
    expect(line.type).toBe("line");
    expect(line.children).toHaveLength(1);
  });
});

describe("TextRunBox sourceDisplayLengths", () => {
  it("carries sourceDisplayLengths when the trailing arg is provided", () => {
    const tr = createTextRunBox("t", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, "hi", 2, 50, [1, 2]);
    expect(tr.sourceDisplayLengths).toEqual([1, 2]);
  });

  it("leaves sourceDisplayLengths undefined when the trailing arg is omitted", () => {
    const tr = createTextRunBox("t", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, "hi", 2, 50);
    expect(tr.sourceDisplayLengths).toBeUndefined();
  });

  it("preserves sourceDisplayLengths through withInlineOffset (no silent strip on rebuild)", () => {
    const tr = createTextRunBox("t", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, "hi", 2, 50, [1, 2]);
    const moved = withInlineOffset(tr, 75, /* containingInlineSize */ 200);
    expect(moved.type).toBe("text-run");
    if (moved.type !== "text-run") throw new Error("?");
    expect(moved.inlineOffset).toBe(75);
    expect(moved.sourceDisplayLengths).toEqual([1, 2]);
  });
});

describe("TextRunBox clusterWidths + sourceStart (bidi-split fields)", () => {
  it("round-trips clusterWidths and sourceStart from the factory", () => {
    const tr = createTextRunBox(
      "t", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, "hi", 2, 50,
      /* sourceDisplayLengths */ undefined,
      /* clusterWidths */ [25, 25],
      /* sourceStart */ 7,
    );
    expect(tr.clusterWidths).toEqual([25, 25]);
    expect(tr.sourceStart).toBe(7);
  });

  it("leaves clusterWidths and sourceStart undefined when omitted", () => {
    const tr = createTextRunBox("t", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, "hi", 2, 50);
    expect(tr.clusterWidths).toBeUndefined();
    expect(tr.sourceStart).toBeUndefined();
  });

  it("PRESERVES clusterWidths and sourceStart through withInlineOffset (I1 regression guard)", () => {
    const widths = [25, 25];
    const tr = createTextRunBox(
      "t", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, "hi", 2, 50,
      undefined, widths, 7,
    );
    const moved = withInlineOffset(tr, 75, /* containingInlineSize */ 200);
    expect(moved.type).toBe("text-run");
    if (moved.type !== "text-run") throw new Error("?");
    expect(moved.inlineOffset).toBe(75);
    // Identity preservation — the rebuild must pass the SAME references through.
    expect(moved.clusterWidths).toBe(tr.clusterWidths);
    expect(moved.sourceStart).toBe(tr.sourceStart);
  });

  it("PRESERVES clusterWidths and sourceStart through withBlockOffset (I1 regression guard)", () => {
    const widths = [25, 25];
    const tr = createTextRunBox(
      "t", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, "hi", 2, 50,
      undefined, widths, 7,
    );
    const moved = withBlockOffset(tr, 99, /* containingInlineSize */ 200);
    expect(moved.type).toBe("text-run");
    if (moved.type !== "text-run") throw new Error("?");
    expect(moved.blockOffset).toBe(99);
    expect(moved.clusterWidths).toBe(tr.clusterWidths);
    expect(moved.sourceStart).toBe(tr.sourceStart);
  });
});

describe("InlineBlockBox sourceStart", () => {
  it("round-trips sourceStart from the factory", () => {
    const tr = createTextRunBox("t", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, "x", 1, 50);
    const ib = createInlineBlockBox("ib", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, [tr], 50, /* sourceStart */ 13);
    expect(ib.sourceStart).toBe(13);
  });

  it("leaves sourceStart undefined when omitted", () => {
    const tr = createTextRunBox("t", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, "x", 1, 50);
    const ib = createInlineBlockBox("ib", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, [tr], 50);
    expect(ib.sourceStart).toBeUndefined();
  });

  it("PRESERVES sourceStart through withInlineOffset and withBlockOffset", () => {
    const tr = createTextRunBox("t", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, "x", 1, 50);
    const ib = createInlineBlockBox("ib", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, [tr], 50, 13);
    const movedI = withInlineOffset(ib, 75, 200);
    const movedB = withBlockOffset(ib, 99, 200);
    expect(movedI.type).toBe("inline-block");
    expect(movedB.type).toBe("inline-block");
    if (movedI.type !== "inline-block" || movedB.type !== "inline-block") throw new Error("?");
    expect(movedI.sourceStart).toBe(13);
    expect(movedB.sourceStart).toBe(13);
  });
});

describe("LayoutBox union narrowing", () => {
  it("narrows by type", () => {
    const items: LayoutBox[] = [
      createBlockBox("a", 0, 0, 10, 10, "horizontal-tb", "ltr", cs, us, [], 10),
      createLineBox("b", 0, 0, 10, 10, "horizontal-tb", "ltr", cs, us, [], 10, 10, "owner" as BlockId, 0, 0, true),
      createTextRunBox("c", 0, 0, 10, 10, "horizontal-tb", "ltr", cs, us, "x", 1, 10),
    ];
    expect(items.filter((b): b is BlockBox => b.type === "block")).toHaveLength(1);
    expect(items.filter((b): b is LineBox => b.type === "line")).toHaveLength(1);
    expect(items.filter((b): b is TextRunBox => b.type === "text-run")).toHaveLength(1);
  });
});

describe("InlineBox", () => {
  it("constructs with children, fragmentEdge for first/last fragment", () => {
    const tr = createTextRunBox("t", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, "x", 1, 50);
    const inline = createInlineBox("i", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, [tr], "first", "ancestor-key", 50);
    expect(inline.type).toBe("inline");
    expect(inline.fragmentEdge).toBe("first");
    expect(inline.children).toHaveLength(1);
  });

  it("supports four fragmentEdge values", () => {
    const tr = createTextRunBox("t", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, "x", 1, 50);
    const first   = createInlineBox("a", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, [tr], "first", "anc", 50);
    const middle  = createInlineBox("b", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, [tr], "middle", "anc", 50);
    const last    = createInlineBox("c", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, [tr], "last", "anc", 50);
    const only    = createInlineBox("d", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, [tr], "only", "anc", 50);
    expect([first, middle, last, only].map(b => b.fragmentEdge)).toEqual(["first", "middle", "last", "only"]);
  });
});

describe("InlineBlockBox", () => {
  it("constructs with children", () => {
    const tr = createTextRunBox("t", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, "x", 1, 50);
    const inlineBlock = createInlineBlockBox("ib", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, [tr], 50);
    expect(inlineBlock.type).toBe("inline-block");
    expect(inlineBlock.children).toHaveLength(1);
  });
});

describe("MarkerBox", () => {
  it("constructs with text content", () => {
    const m = createMarkerBox("m", -20, 0, 18, 16, "horizontal-tb", "ltr", cs, us, "•", 18);
    expect(m.type).toBe("marker");
    expect(m.text).toBe("•");
  });
});

describe("Table layout boxes", () => {
  it("TableBox has columnPxWidths + P8 grid (occupancy/columnCount/cellBoxById)", () => {
    const cell = createTableCellBox(
      "c", 0, 0, 100, 30, "horizontal-tb", "ltr", cs, us, [],
      { gridRow: 0, gridCol: 0, rowSpan: 1, colSpan: 1 }, 100,
    );
    const row = createTableRowBox("r", 0, 0, 500, 30, "horizontal-tb", "ltr", cs, us, [cell], 500);
    const t = createTableBox(
      "t", 0, 0, 500, 200, "horizontal-tb", "ltr", cs, us, [row], [200, 300],
      { occupancy: [["c" as BlockId, null]], columnCount: 2 }, 500,
    );
    expect(t.type).toBe("table");
    expect(t.columnPxWidths).toEqual([200, 300]);
    expect(t.columnCount).toBe(2);
    expect(t.occupancy).toEqual([["c", null]]);
    expect(t.cellBoxById.get("c" as BlockId)).toBe(cell);
  });

  it("TableRowBox holds cells", () => {
    const r = createTableRowBox("r", 0, 0, 500, 50, "horizontal-tb", "ltr", cs, us, [], 500);
    expect(r.type).toBe("table-row");
  });

  it("TableCellBox holds content + carries its grid placement (P8)", () => {
    const c = createTableCellBox(
      "c", 0, 0, 100, 30, "horizontal-tb", "ltr", cs, us, [],
      { gridRow: 1, gridCol: 2, rowSpan: 2, colSpan: 3 }, 100,
    );
    expect(c.type).toBe("table-cell");
    expect({ gridRow: c.gridRow, gridCol: c.gridCol, rowSpan: c.rowSpan, colSpan: c.colSpan })
      .toEqual({ gridRow: 1, gridCol: 2, rowSpan: 2, colSpan: 3 });
  });
});

describe("MultiColumnBox (multi-column slice 2)", () => {
  const makeColumn = (key: string, inlineOffset: number): BlockBox =>
    createBlockBox(key, inlineOffset, 0, 240, 400, "horizontal-tb", "ltr", cs, us, [], 500);

  it("assembles N column BlockBoxes, freezes, and carries type:multicolumn", () => {
    const col0 = makeColumn("c0", 0);
    const col1 = makeColumn("c1", 260);
    const mc = createMultiColumnBox(
      "mc", 0, 0, 500, 400, "horizontal-tb", "ltr", cs, us, [col0, col1], null, 500,
    );
    expect(mc.type).toBe("multicolumn");
    expect(mc.columns).toHaveLength(2);
    expect(mc.columns[0]).toBe(col0);
    expect(mc.columns[1]).toBe(col1);
    expect(Object.isFrozen(mc)).toBe(true);
    expect(Object.isFrozen(mc.columns)).toBe(true);
    // Identity physical for LTR h-tb.
    expect(mc.x).toBe(0);
    expect(mc.width).toBe(500);
  });

  it("rebuildBoxWithOffsets (via withOffsets) repositions the container, preserves type + columns + frozen", () => {
    const col0 = makeColumn("c0", 0);
    const col1 = makeColumn("c1", 260);
    const mc = createMultiColumnBox(
      "mc", 5, 7, 500, 400, "horizontal-tb", "ltr", cs, us, [col0, col1], null, 500,
    );
    const moved = withOffsets(mc, 12, 34, 500);
    if (moved.type !== "multicolumn") throw new Error("expected multicolumn after rebuild");
    // Container repositioned…
    expect(moved.inlineOffset).toBe(12);
    expect(moved.blockOffset).toBe(34);
    expect(moved.x).toBe(12);
    expect(moved.y).toBe(34);
    // …columns carried through (parent-relative, like table children)…
    expect(moved.columns).toHaveLength(2);
    expect(nth(moved.columns, 0, "column").key).toBe("c0");
    expect(nth(moved.columns, 1, "column").key).toBe("c1");
    expect(nth(moved.columns, 0, "column").inlineOffset).toBe(0);
    expect(nth(moved.columns, 1, "column").inlineOffset).toBe(260);
    // …the column-rule carries through (null here)…
    expect(moved.columnRule).toBeNull();
    // …and the result stays frozen.
    expect(Object.isFrozen(moved)).toBe(true);
    expect(Object.isFrozen(moved.columns)).toBe(true);
  });

  it("rebuildBoxWithOffsets preserves a non-null columnRule across the reposition", () => {
    const col0 = makeColumn("c0", 0);
    const col1 = makeColumn("c1", 260);
    const rule = { width: 2, style: "solid" as const, color: "#abc" };
    const mc = createMultiColumnBox(
      "mc", 5, 7, 500, 400, "horizontal-tb", "ltr", cs, us, [col0, col1], rule, 500,
    );
    const moved = withOffsets(mc, 12, 34, 500);
    if (moved.type !== "multicolumn") throw new Error("expected multicolumn after rebuild");
    // The rule survives the offset rebuild (else a bidi reorder / reposition would
    // silently drop the column-rule).
    expect(moved.columnRule).toEqual(rule);
  });
});

describe("Logical-to-physical mapping", () => {
  it("derives identity physical for LTR horizontal-tb", () => {
    const testCs: ComputedStyle = INITIAL_COMPUTED_STYLE;
    const testUs = computeUsedStyle(testCs, 100, "indefinite");
    const b = createBlockBox(
      "k", 10, 20, 100, 50, "horizontal-tb", "ltr", testCs, testUs, [], 100,
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
  const testUs = computeUsedStyle(testCs, 500, "indefinite");
  // Place a 100px box at inline-offset 30 in a 500px-inline-size container.
  // RTL: physical x = 500 - 30 - 100 = 370
  const b = createBlockBox(
    "k", 30, 0, 100, 50, "horizontal-tb", "rtl", testCs, testUs, [],
    /* containingInlineSize */ 500,
    /* metadata */ undefined,
  );
  expect(b.inlineOffset).toBe(30);
  expect(b.x).toBe(370);
  expect(b.y).toBe(0);
  expect(b.width).toBe(100);
  expect(b.height).toBe(50);
});

it("LTR horizontal-tb is unaffected by containingInlineSize", () => {
  const testCs: ComputedStyle = INITIAL_COMPUTED_STYLE;
  const testUs = computeUsedStyle(testCs, 500, "indefinite");
  const b = createBlockBox(
    "k", 30, 0, 100, 50, "horizontal-tb", "ltr", testCs, testUs, [],
    /* containingInlineSize */ 500,
    /* metadata */ undefined,
  );
  expect(b.x).toBe(30);
});

describe("withInlineOffset", () => {
  it("updates inlineOffset and re-derives physical x; preserves blockOffset/y and all other fields", () => {
    const tr = createTextRunBox("t-child", 0, 0, 10, 16, "horizontal-tb", "ltr", cs, us, "x", 1, 50);
    const orig = createBlockBox("k", 10, 20, 100, 50, "horizontal-tb", "ltr", cs, us, [tr], 200);
    const moved = withInlineOffset(orig, 75, /* containingInlineSize */ 200);
    expect(moved.type).toBe("block");
    expect(moved.inlineOffset).toBe(75);
    expect(moved.blockOffset).toBe(20);
    expect(moved.x).toBe(75);
    expect(moved.y).toBe(20);
    expect(moved.inlineSize).toBe(100);
    expect(moved.blockSize).toBe(50);
    if (moved.type !== "block") throw new Error("?");
    expect(moved.children).toHaveLength(1);
    expect(moved.children[0]).toBe(tr); // children preserved by reference
    expect(moved.computedStyle).toEqual(orig.computedStyle);
    expect(moved.usedStyle).toEqual(orig.usedStyle);
    expect(Object.isFrozen(moved)).toBe(true);
  });

  it("RTL re-derives physical x from the new inlineOffset and containingInlineSize", () => {
    const orig = createBlockBox("k", 30, 0, 100, 50, "horizontal-tb", "rtl", cs, us, [], 500);
    // 500 - 30 - 100 = 370
    expect(orig.x).toBe(370);
    const moved = withInlineOffset(orig, 50, 500);
    // 500 - 50 - 100 = 350
    expect(moved.inlineOffset).toBe(50);
    expect(moved.x).toBe(350);
  });
});

describe("withPhysicalInlineOffset (P4-C bidi reorder: physical/identity positioning)", () => {
  it("forces direction:'ltr' so x === inlineOffset even when the source box was rtl", () => {
    // An RTL-positioned text-run: its physical x is mirrored.
    const orig = createTextRunBox("t", 30, 0, 100, 16, "horizontal-tb", "rtl", cs, us, "x", 1, 500);
    expect(orig.x).toBe(500 - 30 - 100); // 370, mirrored
    // Reposition physically at inlineOffset 50: identity → x === inlineOffset.
    const moved = withPhysicalInlineOffset(orig, 50, 500);
    expect(moved.type).toBe("text-run");
    expect(moved.inlineOffset).toBe(50);
    expect(moved.x).toBe(50); // NOT mirrored — direction forced ltr
    expect(moved.direction).toBe("ltr");
    // CSS direction preserved on computedStyle (the page paragraph is still rtl).
    expect(moved.computedStyle).toEqual(orig.computedStyle);
    if (moved.type !== "text-run") throw new Error("?");
    expect(moved.text).toBe("x");
  });

  it("preserves bidiLevel / clusterWidths / sourceStart on a text-run", () => {
    const orig = createTextRunBox(
      "t", 0, 0, 30, 16, "horizontal-tb", "rtl", cs, us, "abc", 3, 500,
      /* sourceDisplayLengths */ undefined, /* clusterWidths */ [10, 10, 10],
      /* sourceStart */ 7, /* bidiLevel */ 1,
    );
    const moved = withPhysicalInlineOffset(orig, 12, 500);
    if (moved.type !== "text-run") throw new Error("?");
    expect(moved.x).toBe(12);
    expect(moved.bidiLevel).toBe(1);
    expect(moved.clusterWidths).toEqual([10, 10, 10]);
    expect(moved.sourceStart).toBe(7);
  });

  it("handles inline / inline-block / marker; recursively identity-positions an InlineBox", () => {
    const inner = createTextRunBox("in", 0, 0, 10, 16, "horizontal-tb", "rtl", cs, us, "x", 1, 500);
    const inline = createInlineBox("em", 5, 0, 10, 16, "horizontal-tb", "rtl", cs, us, [inner], "only", "em", 500);
    const movedInline = withPhysicalInlineOffset(inline, 40, 500);
    expect(movedInline.direction).toBe("ltr");
    expect(movedInline.x).toBe(40);

    const ib = createInlineBlockBox("ib", 0, 0, 10, 16, "horizontal-tb", "rtl", cs, us, [], 500, 3);
    const movedIb = withPhysicalInlineOffset(ib, 22, 500);
    expect(movedIb.direction).toBe("ltr");
    expect(movedIb.x).toBe(22);
    if (movedIb.type !== "inline-block") throw new Error("?");
    expect(movedIb.sourceStart).toBe(3);

    const marker = createMarkerBox("m", 0, 0, 10, 16, "horizontal-tb", "rtl", cs, us, "1.", 500);
    const movedMarker = withPhysicalInlineOffset(marker, 9, 500);
    expect(movedMarker.direction).toBe("ltr");
    expect(movedMarker.x).toBe(9);
  });

  it("throws on a non-reorder-reachable box type (block)", () => {
    const block = createBlockBox("b", 0, 0, 100, 50, "horizontal-tb", "ltr", cs, us, [], 200);
    expect(() => withPhysicalInlineOffset(block, 10, 200)).toThrow(/not reorder-reachable/);
  });
});

describe("withBlockOffset", () => {
  it("updates blockOffset and re-derives physical y; preserves inlineOffset/x and all other fields", () => {
    const tr = createTextRunBox("t-child", 0, 0, 10, 16, "horizontal-tb", "ltr", cs, us, "x", 1, 50);
    const orig = createBlockBox("k", 10, 20, 100, 50, "horizontal-tb", "ltr", cs, us, [tr], 200);
    const moved = withBlockOffset(orig, 99, /* containingInlineSize */ 200);
    expect(moved.type).toBe("block");
    expect(moved.inlineOffset).toBe(10);
    expect(moved.blockOffset).toBe(99);
    expect(moved.x).toBe(10);
    expect(moved.y).toBe(99);
    expect(moved.inlineSize).toBe(100);
    expect(moved.blockSize).toBe(50);
    if (moved.type !== "block") throw new Error("?");
    expect(moved.children).toHaveLength(1);
    expect(moved.children[0]).toBe(tr);
    expect(moved.computedStyle).toEqual(orig.computedStyle);
    expect(moved.usedStyle).toEqual(orig.usedStyle);
    expect(Object.isFrozen(moved)).toBe(true);
  });

  it("preserves type-specific fields (inline-block children, table columnPxWidths, line baseline)", () => {
    const tr = createTextRunBox("t-child", 0, 0, 10, 16, "horizontal-tb", "ltr", cs, us, "x", 1, 50);
    const line = createLineBox("l", 5, 5, 100, 16, "horizontal-tb", "ltr", cs, us, [tr], 12, 100, "owner" as BlockId, 0, 1, false);
    const movedLine = withBlockOffset(line, 40, 100);
    if (movedLine.type !== "line") throw new Error("?");
    expect(movedLine.baseline).toBe(12);

    const ib = createInlineBlockBox("ib", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, [tr], 50);
    const movedIb = withBlockOffset(ib, 7, 50);
    if (movedIb.type !== "inline-block") throw new Error("?");
    expect(movedIb.blockOffset).toBe(7);
    expect(movedIb.children).toHaveLength(1);

    const tb = createTableBox(
      "tb", 0, 0, 500, 200, "horizontal-tb", "ltr", cs, us, [], [200, 300],
      { occupancy: [], columnCount: 2 }, 500,
    );
    const movedTb = withBlockOffset(tb, 11, 500);
    if (movedTb.type !== "table") throw new Error("?");
    expect(movedTb.columnPxWidths).toEqual([200, 300]);

    const inl = createInlineBox("i", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, [tr], "middle", "anc-key", 50);
    const movedInl = withBlockOffset(inl, 3, 50);
    if (movedInl.type !== "inline") throw new Error("?");
    expect(movedInl.fragmentEdge).toBe("middle");
    expect(movedInl.ancestorKey).toBe("anc-key");
  });
});

describe("withOffsets", () => {
  it("updates both logical offsets and re-derives physical fields", () => {
    const orig = createBlockBox("k", 0, 0, 100, 50, "horizontal-tb", "ltr", cs, us, [], 500);
    const moved = withOffsets(orig, 12, 34, 500);
    expect(moved.inlineOffset).toBe(12);
    expect(moved.blockOffset).toBe(34);
    expect(moved.x).toBe(12);
    expect(moved.y).toBe(34);
  });

  it("RTL: re-derives x from new inlineOffset, y from new blockOffset", () => {
    const orig = createBlockBox("k", 0, 0, 100, 50, "horizontal-tb", "rtl", cs, us, [], 500);
    const moved = withOffsets(orig, 30, 22, 500);
    // 500 - 30 - 100 = 370
    expect(moved.inlineOffset).toBe(30);
    expect(moved.blockOffset).toBe(22);
    expect(moved.x).toBe(370);
    expect(moved.y).toBe(22);
  });

  // POSITIONING slice 3 (F9) — `absoluteChildren` must SURVIVE the reposition
  // clone, exactly like `relativeOffset` (the slice-2 Critical regression
  // pattern): a dropped clone here would silently lose the abs subtree on cache
  // reuse / reposition. Abs children are positioned in the box's OWN frame, so
  // they carry through verbatim — the clone re-derives only the box's own offsets.
  it("PRESERVES absoluteChildren through withOffsets and withBlockOffset", () => {
    const absChild = createBlockBox("abs", 5, 8, 40, 20, "horizontal-tb", "ltr", cs, us, [], 100);
    const orig = createBlockBox(
      "k", 0, 0, 100, 50, "horizontal-tb", "ltr", cs, us, [], 500,
      /* metadata */ undefined,
      /* containingBlockSize */ undefined,
      /* relativeOffset */ undefined,
      /* absoluteChildren */ [absChild],
    );
    expect(orig.absoluteChildren).toHaveLength(1);

    const movedOffsets = withOffsets(orig, 12, 34, 500);
    expect(movedOffsets.absoluteChildren).toHaveLength(1);
    const movedOffsetsAbs0 = nth(movedOffsets.absoluteChildren ?? [], 0, "absolute child");
    expect(movedOffsetsAbs0.key).toBe("abs");
    // The abs child itself is unchanged (own-frame, parent-relative).
    expect(movedOffsetsAbs0.inlineOffset).toBe(5);
    expect(movedOffsetsAbs0.blockOffset).toBe(8);

    const movedBlock = withBlockOffset(orig, 77, 500);
    expect(movedBlock.absoluteChildren).toHaveLength(1);
    expect(nth(movedBlock.absoluteChildren ?? [], 0, "absolute child").key).toBe("abs");
  });
});

describe("bidiLevel (P4-C reorder field)", () => {
  it("round-trips bidiLevel through createTextRunBox (trailing optional arg)", () => {
    const tr = createTextRunBox(
      "t", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, "hi", 2, 50,
      /* sourceDisplayLengths */ undefined,
      /* clusterWidths */ [25, 25],
      /* sourceStart */ 7,
      /* bidiLevel */ 1,
    );
    expect(tr.bidiLevel).toBe(1);
  });

  it("leaves bidiLevel undefined when omitted (text-run / inline-block / marker)", () => {
    const tr = createTextRunBox("t", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, "hi", 2, 50);
    const ib = createInlineBlockBox("ib", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, [], 50);
    const mk = createMarkerBox("m", 0, 0, 20, 16, "horizontal-tb", "ltr", cs, us, "•", 50);
    expect(tr.bidiLevel).toBeUndefined();
    expect(ib.bidiLevel).toBeUndefined();
    expect(mk.bidiLevel).toBeUndefined();
  });

  it("round-trips bidiLevel through createInlineBlockBox and createMarkerBox", () => {
    const ib = createInlineBlockBox(
      "ib", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, [], 50,
      /* sourceStart */ 3, /* bidiLevel */ 1,
    );
    const mk = createMarkerBox("m", 0, 0, 20, 16, "horizontal-tb", "ltr", cs, us, "•", 50, /* bidiLevel */ 2);
    expect(ib.bidiLevel).toBe(1);
    expect(mk.bidiLevel).toBe(2);
  });

  it("withBidiLevel sets the level on a text-run leaf", () => {
    const tr = createTextRunBox("t", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, "hi", 2, 50);
    expect(tr.bidiLevel).toBeUndefined();
    const stamped = withBidiLevel(tr, 1, 50);
    expect(stamped.type).toBe("text-run");
    if (stamped.type !== "text-run") throw new Error("?");
    expect(stamped.bidiLevel).toBe(1);
    // Geometry preserved.
    expect(stamped.inlineOffset).toBe(0);
    expect(stamped.inlineSize).toBe(50);
  });

  it("withBidiLevel sets the level on inline-block and marker leaves", () => {
    const ib = createInlineBlockBox("ib", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, [], 50, 3);
    const mk = createMarkerBox("m", 0, 0, 20, 16, "horizontal-tb", "ltr", cs, us, "•", 50);
    const ibStamped = withBidiLevel(ib, 1, 50);
    const mkStamped = withBidiLevel(mk, 2, 50);
    if (ibStamped.type !== "inline-block" || mkStamped.type !== "marker") throw new Error("?");
    expect(ibStamped.bidiLevel).toBe(1);
    expect(ibStamped.sourceStart).toBe(3); // unrelated fields preserved
    expect(mkStamped.bidiLevel).toBe(2);
  });

  it("throws when withBidiLevel is given a non-leaf box (block)", () => {
    const b = createBlockBox("k", 0, 0, 100, 50, "horizontal-tb", "ltr", cs, us, [], 100);
    expect(() => withBidiLevel(b, 1, 100)).toThrow();
  });

  it("PRESERVES bidiLevel through withInlineOffset (preservation guard — painter needs it)", () => {
    const tr = createTextRunBox(
      "t", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, "hi", 2, 50,
      undefined, [25, 25], 7, /* bidiLevel */ 1,
    );
    const moved = withInlineOffset(tr, 75, /* containingInlineSize */ 200);
    expect(moved.type).toBe("text-run");
    if (moved.type !== "text-run") throw new Error("?");
    expect(moved.inlineOffset).toBe(75);
    expect(moved.bidiLevel).toBe(1);
  });

  it("PRESERVES bidiLevel through withBlockOffset (inline-block + marker)", () => {
    const ib = createInlineBlockBox("ib", 0, 0, 50, 16, "horizontal-tb", "ltr", cs, us, [], 50, 3, /* bidiLevel */ 1);
    const mk = createMarkerBox("m", 0, 0, 20, 16, "horizontal-tb", "ltr", cs, us, "•", 50, /* bidiLevel */ 2);
    const movedIb = withBlockOffset(ib, 99, 200);
    const movedMk = withBlockOffset(mk, 99, 200);
    if (movedIb.type !== "inline-block" || movedMk.type !== "marker") throw new Error("?");
    expect(movedIb.bidiLevel).toBe(1);
    expect(movedMk.bidiLevel).toBe(2);
  });
});

describe("assertLayoutBoxConsistent (C1 prevention)", () => {
  it("accepts a factory-built box", () => {
    const b = createBlockBox("k", 10, 20, 100, 50, "horizontal-tb", "ltr", cs, us, [], 200);
    expect(() => assertLayoutBoxConsistent(b, 200)).not.toThrow();
  });

  it("accepts a box produced by withInlineOffset / withBlockOffset / withOffsets", () => {
    const orig = createBlockBox("k", 10, 20, 100, 50, "horizontal-tb", "ltr", cs, us, [], 200);
    expect(() => assertLayoutBoxConsistent(withInlineOffset(orig, 5, 200), 200)).not.toThrow();
    expect(() => assertLayoutBoxConsistent(withBlockOffset(orig, 5, 200), 200)).not.toThrow();
    expect(() => assertLayoutBoxConsistent(withOffsets(orig, 5, 7, 200), 200)).not.toThrow();
  });

  it("throws when y was spread-patched but blockOffset is stale (A2 anti-pattern)", () => {
    const orig = createBlockBox("k", 10, 20, 100, 50, "horizontal-tb", "ltr", cs, us, [], 200);
    // Mimic the broken `Object.freeze({ ...c, y: 9999 })` pattern.
    const corrupt = Object.freeze({ ...orig, y: 9999 }) as LayoutBox;
    expect(() => assertLayoutBoxConsistent(corrupt, 200)).toThrow(/LayoutBox invariant violated/);
  });

  it("throws when x was spread-patched but inlineOffset is stale (A1 anti-pattern)", () => {
    const orig = createBlockBox("k", 10, 20, 100, 50, "horizontal-tb", "ltr", cs, us, [], 200);
    const corrupt = Object.freeze({ ...orig, x: 9999 }) as LayoutBox;
    expect(() => assertLayoutBoxConsistent(corrupt, 200)).toThrow(/LayoutBox invariant violated/);
  });

  it("throws when both x and y are spread-patched together (A1 combo)", () => {
    const orig = createBlockBox("k", 10, 20, 100, 50, "horizontal-tb", "ltr", cs, us, [], 200);
    const corrupt = Object.freeze({ ...orig, x: 9999, y: 8888 }) as LayoutBox;
    expect(() => assertLayoutBoxConsistent(corrupt, 200)).toThrow(/LayoutBox invariant violated/);
  });

  it("detects RTL inconsistency (spread-patched x must respect containingInlineSize)", () => {
    const orig = createBlockBox("k", 30, 0, 100, 50, "horizontal-tb", "rtl", cs, us, [], 500);
    // Factory derives x = 500 - 30 - 100 = 370.
    expect(orig.x).toBe(370);
    // Spread-patch x to a stale value.
    const corrupt = Object.freeze({ ...orig, x: 30 }) as LayoutBox;
    expect(() => assertLayoutBoxConsistent(corrupt, 500)).toThrow(/LayoutBox invariant violated/);
  });

  it("skips the block-axis check for vertical-rl (P3.1 physicalize-pass guarantee)", () => {
    // vertical-rl stores an un-mirrored x at factory time; the P3.1 pass later
    // mirrors it against the (then-known) containing block-size. After that
    // mirror, the stored x no longer matches a from-scratch un-mirrored recompute
    // — so the guard must skip the v-rl block-axis check rather than throw.
    const orig = createBlockBox("k", 10, 20, 100, 50, "vertical-rl", "ltr", cs, us, [], 500);
    // Factory stores the un-mirrored block-axis x = blockOffset.
    expect(orig.x).toBe(20);
    // Simulate the post-physicalize mirrored x (x = containingBlockSize − blockOffset − blockSize).
    const mirrored = Object.freeze({ ...orig, x: 800 - 20 - 50 }) as LayoutBox;
    expect(() => assertLayoutBoxConsistent(mirrored, 500)).not.toThrow();
  });

  it("still checks vertical-lr boxes (guard is tight to vertical-rl)", () => {
    const orig = createBlockBox("k", 10, 20, 100, 50, "vertical-lr", "ltr", cs, us, [], 500);
    // vertical-lr is fully derivable at factory time: x = blockOffset.
    expect(orig.x).toBe(20);
    expect(() => assertLayoutBoxConsistent(orig, 500)).not.toThrow();
    // A stale x must still be caught for v-lr.
    const corrupt = Object.freeze({ ...orig, x: 9999 }) as LayoutBox;
    expect(() => assertLayoutBoxConsistent(corrupt, 500)).toThrow(/LayoutBox invariant violated/);
  });
});

// POSITIONING slice 4 — `stackingContextRole` is computed DETERMINISTICALLY by the
// box factory from the box's computedStyle (a POSITIONED box with a non-`auto`
// z-index, OR opacity<1, OR a non-empty transform → "self"; absent otherwise),
// so every factory + clone/rebuild path carries it without separate threading.
describe("LayoutBox stackingContextRole (slice 4)", () => {
  function csWith(overrides: Partial<ComputedStyle>): ComputedStyle {
    return { ...INITIAL_COMPUTED_STYLE, ...overrides };
  }
  const usFor = (c: ComputedStyle) => computeUsedStyle(c, 100, "indefinite");

  it("a POSITIONED box with a numeric z-index is a stacking context (self)", () => {
    const c = csWith({ position: "relative", zIndex: 5 });
    const b = createBlockBox("k", 0, 0, 100, 50, "horizontal-tb", "ltr", c, usFor(c), [], 100);
    expect(b.stackingContextRole).toBe("self");
  });

  it("a STATIC box with a numeric z-index is NOT a stacking context (z ignored on static)", () => {
    // CSS 2.2 §9.9.1 — z-index has no effect on a static box; the position gate
    // in computeStackingContextRole must reject it.
    const c = csWith({ position: "static", zIndex: 5 });
    const b = createBlockBox("k", 0, 0, 100, 50, "horizontal-tb", "ltr", c, usFor(c), [], 100);
    expect(b.stackingContextRole).toBeUndefined();
  });

  it("a POSITIONED box with z-index:auto is NOT a stacking context", () => {
    const c = csWith({ position: "absolute", zIndex: "auto" });
    const b = createBlockBox("k", 0, 0, 100, 50, "horizontal-tb", "ltr", c, usFor(c), [], 100);
    expect(b.stackingContextRole).toBeUndefined();
  });

  it("opacity<1 makes a box a stacking context (forward-compat trigger)", () => {
    const c = csWith({ opacity: 0.5 });
    const b = createBlockBox("k", 0, 0, 100, 50, "horizontal-tb", "ltr", c, usFor(c), [], 100);
    expect(b.stackingContextRole).toBe("self");
  });

  it("a non-empty transform makes a box a stacking context (forward-compat trigger)", () => {
    const c = csWith({ transform: [{ fn: "scale", sx: 2, sy: 2 }] });
    const b = createBlockBox("k", 0, 0, 100, 50, "horizontal-tb", "ltr", c, usFor(c), [], 100);
    expect(b.stackingContextRole).toBe("self");
  });

  it("a default (unpositioned, opaque, untransformed) box has NO stacking-context role", () => {
    const b = createBlockBox("k", 0, 0, 100, 50, "horizontal-tb", "ltr", cs, us, [], 100);
    expect(b.stackingContextRole).toBeUndefined();
  });

  it("survives withOffsets / rebuild (deterministic from computedStyle, never dropped on clone)", () => {
    const c = csWith({ position: "relative", zIndex: 3 });
    const b = createBlockBox("k", 0, 0, 100, 50, "horizontal-tb", "ltr", c, usFor(c), [], 100);
    expect(b.stackingContextRole).toBe("self");
    const moved = withOffsets(b, 10, 20, 100);
    expect(moved.stackingContextRole).toBe("self");
  });
});

