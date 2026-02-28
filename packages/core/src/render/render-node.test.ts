import { describe, it, expect } from "vitest";
import {
  createBlockNode,
  createInlineNode,
  createTextRenderNode,
  type RenderNode,
} from "./render-node";
import type { TextRenderNode } from "./text-render-node";

function expectTextRender(node: RenderNode): TextRenderNode {
  if (node.type !== "text")
    throw new Error(`Expected text render node, got "${node.type}"`);
  return node;
}

describe("RenderNode", () => {
  it("creates a block node", () => {
    const child = createTextRenderNode("t1", "hello", { fontSize: 16 });
    const block = createBlockNode("p1", { marginTop: 8 }, [child]);

    expect(block.type).toBe("block");
    expect(block.key).toBe("p1");
    expect(block.styles.marginTop).toBe(8);
    expect(block.children).toHaveLength(1);
    expect(block.children[0]).toBe(child);
  });

  it("creates an inline node", () => {
    const text = createTextRenderNode("t1", "bold", { fontWeight: "bold" });
    const inline = createInlineNode("s1", {}, [text]);

    expect(inline.type).toBe("inline");
    expect(expectTextRender(inline.children[0]).text).toBe("bold");
  });

  it("createInlineNode throws if any child is a block", () => {
    const block = createBlockNode("b1", {}, []);
    expect(() => createInlineNode("s1", {}, [block])).toThrow();
  });

  it("creates a text node with content", () => {
    const text = createTextRenderNode("t1", "hello world", {
      fontFamily: "serif",
      fontSize: 14,
    });

    expect(text.type).toBe("text");
    expect(text.text).toBe("hello world");
    expect(text.styles.fontFamily).toBe("serif");
    expect(text.children).toHaveLength(0);
  });

  it("nodes are frozen", () => {
    const text = createTextRenderNode("t1", "hi", {});
    expect(Object.isFrozen(text)).toBe(true);
    expect(Object.isFrozen(text.styles)).toBe(true);
    expect(Object.isFrozen(text.children)).toBe(true);
  });
});
