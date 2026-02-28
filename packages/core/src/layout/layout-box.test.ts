import { describe, it, expect } from "vitest";
import { createBlockLayoutBox } from "./block-layout-box";
import { createLineLayoutBox } from "./line-layout-box";
import { createTextLayoutBox } from "./text-layout-box";

describe("createTextLayoutBox", () => {
  it("creates a text layout box with correct properties", () => {
    const box = createTextLayoutBox("t1", 10, 20, 80, 16, "hello");
    expect(box.key).toBe("t1");
    expect(box.type).toBe("text");
    expect(box.x).toBe(10);
    expect(box.y).toBe(20);
    expect(box.width).toBe(80);
    expect(box.height).toBe(16);
    expect(box.text).toBe("hello");
    expect(box.children).toHaveLength(0);
  });

  it("freezes the returned box", () => {
    const box = createTextLayoutBox("t1", 0, 0, 10, 10, "a");
    expect(Object.isFrozen(box)).toBe(true);
  });

  it("freezes the children array", () => {
    const box = createTextLayoutBox("t1", 0, 0, 10, 10, "a");
    expect(Object.isFrozen(box.children)).toBe(true);
  });
});

describe("createLineLayoutBox", () => {
  it("creates a line layout box with text children", () => {
    const text = createTextLayoutBox("t1", 0, 0, 40, 16, "hello");
    const line = createLineLayoutBox("line1", 0, 0, 100, 16, [text]);
    expect(line.key).toBe("line1");
    expect(line.type).toBe("line");
    expect(line.children).toHaveLength(1);
    expect(line.children[0]).toBe(text);
  });

  it("freezes the returned box", () => {
    const line = createLineLayoutBox("line1", 0, 0, 100, 16, []);
    expect(Object.isFrozen(line)).toBe(true);
  });

  it("freezes the children array", () => {
    const text = createTextLayoutBox("t1", 0, 0, 40, 16, "hi");
    const line = createLineLayoutBox("line1", 0, 0, 100, 16, [text]);
    expect(Object.isFrozen(line.children)).toBe(true);
  });

  it("copies children array defensively", () => {
    const text = createTextLayoutBox("t1", 0, 0, 40, 16, "hi");
    const children = [text];
    const line = createLineLayoutBox("line1", 0, 0, 100, 16, children);
    children.push(createTextLayoutBox("t2", 0, 0, 40, 16, "bye"));
    expect(line.children).toHaveLength(1);
  });

  it("throws if child is a block box", () => {
    const block = createBlockLayoutBox("b1", 0, 0, 100, 50, []);
    expect(() =>
      createLineLayoutBox("line1", 0, 0, 100, 16, [block]),
    ).toThrow(/can only contain text children/);
  });

  it("throws if child is a line box", () => {
    const innerLine = createLineLayoutBox("inner", 0, 0, 100, 16, []);
    expect(() =>
      createLineLayoutBox("line1", 0, 0, 100, 16, [innerLine]),
    ).toThrow(/can only contain text children/);
  });
});

describe("createBlockLayoutBox", () => {
  it("creates a block layout box with line children", () => {
    const line = createLineLayoutBox("line1", 0, 0, 100, 16, []);
    const block = createBlockLayoutBox("b1", 0, 0, 100, 16, [line]);
    expect(block.key).toBe("b1");
    expect(block.type).toBe("block");
    expect(block.children).toHaveLength(1);
    expect(block.children[0]).toBe(line);
  });

  it("accepts nested block children", () => {
    const innerBlock = createBlockLayoutBox("inner", 0, 0, 100, 50, []);
    const outer = createBlockLayoutBox("outer", 0, 0, 100, 100, [innerBlock]);
    expect(outer.children).toHaveLength(1);
  });

  it("freezes the returned box", () => {
    const block = createBlockLayoutBox("b1", 0, 0, 100, 50, []);
    expect(Object.isFrozen(block)).toBe(true);
  });

  it("freezes the children array", () => {
    const block = createBlockLayoutBox("b1", 0, 0, 100, 50, []);
    expect(Object.isFrozen(block.children)).toBe(true);
  });

  it("copies children array defensively", () => {
    const line = createLineLayoutBox("line1", 0, 0, 100, 16, []);
    const children = [line];
    const block = createBlockLayoutBox("b1", 0, 0, 100, 50, children);
    children.push(createLineLayoutBox("line2", 0, 0, 100, 16, []));
    expect(block.children).toHaveLength(1);
  });

  it("throws if child is a text box", () => {
    const text = createTextLayoutBox("t1", 0, 0, 40, 16, "hello");
    expect(() =>
      createBlockLayoutBox("b1", 0, 0, 100, 50, [text]),
    ).toThrow(/cannot directly contain text child/);
  });
});
