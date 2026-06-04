import { describe, it, expect } from "vitest";
import {
  type RenderNode, type ElementBox, type TextBox,
  createElementBox, createTextBox,
} from "./render-node";

describe("ElementBox", () => {
  it("constructs with key, style, children", () => {
    const box = createElementBox("k1", { display: "block" }, []);
    expect(box.type).toBe("element");
    expect(box.key).toBe("k1");
    expect(box.style.display).toBe("block");
    expect(box.children).toEqual([]);
  });

  it("accepts metadata", () => {
    const box = createElementBox("k1", {}, [], {
      image: { src: "x.png", width: 10, height: 20 },
    });
    expect(box.metadata).toEqual({
      image: { src: "x.png", width: 10, height: 20 },
    });
  });

  it("freezes the result", () => {
    const box = createElementBox("k1", {}, []);
    expect(Object.isFrozen(box)).toBe(true);
    expect(Object.isFrozen(box.children)).toBe(true);
    expect(Object.isFrozen(box.style)).toBe(true);
  });
});

describe("TextBox", () => {
  it("constructs with key, style, text", () => {
    const box = createTextBox("k1", {}, "hello");
    expect(box.type).toBe("text");
    expect(box.text).toBe("hello");
  });

  it("freezes the result", () => {
    const box = createTextBox("k1", {}, "hi");
    expect(Object.isFrozen(box)).toBe(true);
  });
});

describe("RenderNode union", () => {
  it("can be narrowed by .type", () => {
    const nodes: RenderNode[] = [
      createElementBox("a", {}, []),
      createTextBox("b", {}, "x"),
    ];
    const elements = nodes.filter((n): n is ElementBox => n.type === "element");
    const texts = nodes.filter((n): n is TextBox => n.type === "text");
    expect(elements).toHaveLength(1);
    expect(texts).toHaveLength(1);
  });
});
