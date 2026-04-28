import { describe, it, expect } from "vitest";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import {
  type LayoutBox, type BlockBox, type LineBox, type TextRunBox,
  type InlineBox, type InlineBlockBox, type MarkerBox,
  createBlockBox, createLineBox, createTextRunBox, createInlineBox, createInlineBlockBox, createMarkerBox,
} from "./layout-box-v2";

const cs = INITIAL_COMPUTED_STYLE;

describe("BlockBox", () => {
  it("constructs and freezes", () => {
    const b = createBlockBox("k", 0, 0, 100, 50, cs, []);
    expect(b.type).toBe("block");
    expect(b.x).toBe(0);
    expect(b.width).toBe(100);
    expect(Object.isFrozen(b)).toBe(true);
  });
});

describe("LineBox", () => {
  it("constructs with text-run children", () => {
    const tr = createTextRunBox("t", 0, 0, 50, 16, cs, "hello");
    const line = createLineBox("l", 0, 0, 100, 16, cs, [tr]);
    expect(line.type).toBe("line");
    expect(line.children).toHaveLength(1);
  });
});

describe("LayoutBox union narrowing", () => {
  it("narrows by type", () => {
    const items: LayoutBox[] = [
      createBlockBox("a", 0, 0, 10, 10, cs, []),
      createLineBox("b", 0, 0, 10, 10, cs, []),
      createTextRunBox("c", 0, 0, 10, 10, cs, "x"),
    ];
    expect(items.filter((b): b is BlockBox => b.type === "block")).toHaveLength(1);
    expect(items.filter((b): b is LineBox => b.type === "line")).toHaveLength(1);
    expect(items.filter((b): b is TextRunBox => b.type === "text-run")).toHaveLength(1);
  });
});

describe("InlineBox", () => {
  it("constructs with children, fragmentEdge for first/last fragment", () => {
    const tr = createTextRunBox("t", 0, 0, 50, 16, cs, "x");
    const inline = createInlineBox("i", 0, 0, 50, 16, cs, [tr], "first");
    expect(inline.type).toBe("inline");
    expect(inline.fragmentEdge).toBe("first");
    expect(inline.children).toHaveLength(1);
  });

  it("supports four fragmentEdge values", () => {
    const tr = createTextRunBox("t", 0, 0, 50, 16, cs, "x");
    const first   = createInlineBox("a", 0, 0, 50, 16, cs, [tr], "first");
    const middle  = createInlineBox("b", 0, 0, 50, 16, cs, [tr], "middle");
    const last    = createInlineBox("c", 0, 0, 50, 16, cs, [tr], "last");
    const only    = createInlineBox("d", 0, 0, 50, 16, cs, [tr], "only");
    expect([first, middle, last, only].map(b => b.fragmentEdge)).toEqual(["first", "middle", "last", "only"]);
  });
});

describe("InlineBlockBox", () => {
  it("constructs with children", () => {
    const tr = createTextRunBox("t", 0, 0, 50, 16, cs, "x");
    const inlineBlock = createInlineBlockBox("ib", 0, 0, 50, 16, cs, [tr]);
    expect(inlineBlock.type).toBe("inline-block");
    expect(inlineBlock.children).toHaveLength(1);
  });
});

describe("MarkerBox", () => {
  it("constructs with text content", () => {
    const m = createMarkerBox("m", -20, 0, 18, 16, cs, "•");
    expect(m.type).toBe("marker");
    expect(m.text).toBe("•");
  });
});
