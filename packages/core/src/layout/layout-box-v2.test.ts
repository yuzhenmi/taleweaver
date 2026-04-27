import { describe, it, expect } from "vitest";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import {
  type LayoutBox, type BlockBox, type LineBox, type TextRunBox,
  createBlockBox, createLineBox, createTextRunBox,
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
