import { describe, it, expect } from "vitest";
import { INITIAL_COMPUTED_STYLE, type ComputedStyle } from "../styles";
import type { BlockId } from "../state";
import { computeUsedStyle } from "./used-style";
import {
  type LayoutBox, type BlockBox, type LineBox, type TextRunBox,
  createBlockBox, createLineBox, createTextRunBox, createInlineBox, createInlineBlockBox, createMarkerBox,
  createTableBox, createTableRowBox, createTableCellBox,
  withInlineOffset, withBlockOffset, withOffsets,
  assertLayoutBoxConsistent,
} from "./layout-box";

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
  it("TableBox has columnPxWidths", () => {
    const t = createTableBox("t", 0, 0, 500, 200, "horizontal-tb", "ltr", cs, us, [], [200, 300], 500);
    expect(t.type).toBe("table");
    expect(t.columnPxWidths).toEqual([200, 300]);
  });

  it("TableRowBox holds cells", () => {
    const r = createTableRowBox("r", 0, 0, 500, 50, "horizontal-tb", "ltr", cs, us, [], 500);
    expect(r.type).toBe("table-row");
  });

  it("TableCellBox holds content", () => {
    const c = createTableCellBox("c", 0, 0, 100, 30, "horizontal-tb", "ltr", cs, us, [], 100);
    expect(c.type).toBe("table-cell");
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

    const tb = createTableBox("tb", 0, 0, 500, 200, "horizontal-tb", "ltr", cs, us, [], [200, 300], 500);
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
});

