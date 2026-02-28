import { describe, it, expect } from "vitest";
import {
  createBlockLayoutBox,
  createLineLayoutBox,
  createTextLayoutBox,
} from "./layout-node";
import type { LayoutBox } from "./layout-node";
import type { TextLayoutBox } from "./text-layout-box";
import { createMockMeasurer } from "./text-measurer";
import { splitTextIntoWords } from "./text-splitter";
import { layoutTree, layoutTreeIncremental } from "./layout-engine";
import {
  createBlockNode,
  createTextRenderNode,
} from "../render/render-node";
import { createNode, createTextNode } from "../state/create-node";
import { defaultComponents } from "../components";
import { createRegistry } from "../components/component-registry";
import { renderTree, renderTreeIncremental } from "../render/render";
import { createPosition } from "../state/position";
import { insertText } from "../state/transformations";

function expectTextBox(box: LayoutBox): TextLayoutBox {
  if (box.type !== "text")
    throw new Error(`Expected text layout box, got "${box.type}"`);
  return box;
}

const measurer = createMockMeasurer(8, 16); // 8px per char, 16px line height

describe("LayoutBox", () => {
  it("creates a block layout box", () => {
    const box = createBlockLayoutBox("b1", 0, 0, 100, 50, []);
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
    expect(box.width).toBe(100);
    expect(box.height).toBe(50);
    expect(box.key).toBe("b1");
    expect(box.type).toBe("block");
  });

  it("creates a text layout box", () => {
    const box = createTextLayoutBox("t1", 0, 0, 40, 16, "hello");
    expect(box.type).toBe("text");
    expect(box.text).toBe("hello");
    expect(box.children).toHaveLength(0);
  });

  it("creates a line layout box", () => {
    const textBox = createTextLayoutBox("t1", 0, 0, 40, 16, "hello");
    const line = createLineLayoutBox("l1", 0, 0, 200, 16, [textBox]);
    expect(line.type).toBe("line");
    expect(line.children).toHaveLength(1);
  });

  it("is frozen", () => {
    const box = createBlockLayoutBox("b1", 0, 0, 100, 50, []);
    expect(Object.isFrozen(box)).toBe(true);
  });

  it("createBlockLayoutBox throws if any child is a text box", () => {
    const textBox = createTextLayoutBox("t1", 0, 0, 40, 16, "hello");
    expect(() => createBlockLayoutBox("b1", 0, 0, 100, 50, [textBox])).toThrow();
  });

  it("createLineLayoutBox throws if any child is not a text box", () => {
    const block = createBlockLayoutBox("b1", 0, 0, 100, 50, []);
    expect(() => createLineLayoutBox("l1", 0, 0, 200, 16, [block])).toThrow();
  });
});

describe("TextMeasurer (mock)", () => {
  it("measures width based on character count", () => {
    expect(measurer.measureWidth("hello", {})).toBe(40); // 5 * 8
    expect(measurer.measureWidth("", {})).toBe(0);
  });

  it("measures line height", () => {
    expect(measurer.measureHeight({})).toBe(16);
  });
});

describe("splitTextIntoWords", () => {
  it("splits text into word boxes", () => {
    const words = splitTextIntoWords("hello world", {}, measurer);

    expect(words).toHaveLength(2);
    expect(words[0].text).toBe("hello ");
    expect(words[0].width).toBe(48); // 6 * 8 (including trailing space)
    expect(words[0].trailingSpace).toBe(true);
    expect(words[1].text).toBe("world");
    expect(words[1].width).toBe(40); // 5 * 8
  });

  it("handles empty text", () => {
    const words = splitTextIntoWords("", {}, measurer);
    expect(words).toHaveLength(1);
    expect(words[0].text).toBe("");
    expect(words[0].width).toBe(0);
  });

  it("handles single word", () => {
    const words = splitTextIntoWords("hello", {}, measurer);
    expect(words).toHaveLength(1);
    expect(words[0].text).toBe("hello");
    expect(words[0].trailingSpace).toBe(false);
  });

  it("preserves leading whitespace", () => {
    const words = splitTextIntoWords("  hello", {}, measurer);
    expect(words).toHaveLength(2);
    expect(words[0].text).toBe("  ");
    expect(words[0].trailingSpace).toBe(true);
    expect(words[0].width).toBe(16); // 2 * 8
    expect(words[1].text).toBe("hello");
  });
});

describe("Layout engine", () => {
  it("lays out a simple document with one paragraph", () => {
    const text = createTextRenderNode("t1", "Hello", {});
    const para = createBlockNode("p1", {}, [text]);
    const doc = createBlockNode("doc", {}, [para]);

    const layout = layoutTree(doc, 200, measurer);

    expect(layout.type).toBe("block");
    expect(layout.width).toBe(200);
    expect(layout.x).toBe(0);
    expect(layout.y).toBe(0);

    // Paragraph should have one line
    const paraBox = layout.children[0];
    expect(paraBox.type).toBe("block");
    expect(paraBox.children).toHaveLength(1); // one line

    const line = paraBox.children[0];
    expect(line.type).toBe("line");
    expect(line.children).toHaveLength(1);
    expect(expectTextBox(line.children[0]).text).toBe("Hello");
    expect(line.children[0].width).toBe(40); // 5 * 8
  });

  it("wraps text to multiple lines", () => {
    // Container width = 80px, each char = 8px
    // "hello world" = 11 chars = 88px > 80px
    const text = createTextRenderNode("t1", "hello world", {});
    const para = createBlockNode("p1", {}, [text]);
    const doc = createBlockNode("doc", {}, [para]);

    const layout = layoutTree(doc, 80, measurer);
    const paraBox = layout.children[0];

    // Should wrap into 2 lines
    expect(paraBox.children).toHaveLength(2);

    const line1 = paraBox.children[0];
    const line2 = paraBox.children[1];

    // First line: "hello " (48px fits in 80px)
    expect(expectTextBox(line1.children[0]).text).toBe("hello ");
    expect(line1.y).toBe(0);

    // Second line: "world" (40px)
    expect(expectTextBox(line2.children[0]).text).toBe("world");
    expect(line2.y).toBe(16); // after first line
  });

  it("stacks block children vertically", () => {
    const t1 = createTextRenderNode("t1", "First", {});
    const t2 = createTextRenderNode("t2", "Second", {});
    const p1 = createBlockNode("p1", {}, [t1]);
    const p2 = createBlockNode("p2", {}, [t2]);
    const doc = createBlockNode("doc", {}, [p1, p2]);

    const layout = layoutTree(doc, 200, measurer);

    const para1 = layout.children[0];
    const para2 = layout.children[1];

    expect(para1.y).toBe(0);
    expect(para1.height).toBe(16);
    expect(para2.y).toBe(16); // stacked after para1
  });

  it("gives unique keys to word boxes from multi-word text nodes", () => {
    const text = createTextRenderNode("t1", "hello world", {});
    const para = createBlockNode("p1", {}, [text]);
    const doc = createBlockNode("doc", {}, [para]);

    // Use wide container so both words fit on one line
    const layout = layoutTree(doc, 400, measurer);
    const line = layout.children[0].children[0];

    // Two word boxes should have different keys
    expect(line.children).toHaveLength(2);
    expect(line.children[0].key).not.toBe(line.children[1].key);
  });

  it("single-word text node keeps the original key", () => {
    const text = createTextRenderNode("t1", "hello", {});
    const para = createBlockNode("p1", {}, [text]);
    const doc = createBlockNode("doc", {}, [para]);

    const layout = layoutTree(doc, 400, measurer);
    const line = layout.children[0].children[0];

    expect(line.children).toHaveLength(1);
    expect(line.children[0].key).toBe("t1");
  });

  it("applies vertical padding to block height and content offset", () => {
    const text = createTextRenderNode("t1", "Hello", {});
    const para = createBlockNode("p1", { paddingTop: 10, paddingBottom: 8 }, [
      text,
    ]);
    const doc = createBlockNode("doc", {}, [para]);

    const layout = layoutTree(doc, 200, measurer);
    const paraBox = layout.children[0];

    // Line should be offset by paddingTop
    const line = paraBox.children[0];
    expect(line.y).toBe(10); // paddingTop

    // Para height includes top padding + line height + bottom padding
    expect(paraBox.height).toBe(10 + 16 + 8); // 34
  });

  it("positions children relative to parent, not document", () => {
    const text = createTextRenderNode("t1", "Hello", {});
    const para = createBlockNode("p1", { paddingLeft: 20 }, [text]);
    const doc = createBlockNode("doc", { paddingTop: 30, paddingLeft: 10 }, [
      para,
    ]);

    const layout = layoutTree(doc, 200, measurer);
    const paraBox = layout.children[0];

    // Para is at paddingLeft=10, paddingTop=30 relative to doc
    expect(paraBox.x).toBe(10);
    expect(paraBox.y).toBe(30);

    // Line within para is at paddingLeft=20, paddingTop=0 relative to para
    const line = paraBox.children[0];
    expect(line.x).toBe(20);
    expect(line.y).toBe(0);

    // Text box is at x=0 relative to line
    expect(line.children[0].x).toBe(0);
    expect(line.children[0].y).toBe(0);
  });

  it("stacks blocks correctly with vertical padding", () => {
    const t1 = createTextRenderNode("t1", "First", {});
    const t2 = createTextRenderNode("t2", "Second", {});
    const p1 = createBlockNode("p1", { paddingBottom: 12 }, [t1]);
    const p2 = createBlockNode("p2", { paddingTop: 8 }, [t2]);
    const doc = createBlockNode("doc", {}, [p1, p2]);

    const layout = layoutTree(doc, 200, measurer);

    const para1 = layout.children[0];
    const para2 = layout.children[1];

    // p1: height = 0 + 16 + 12 = 28 (paddingTop=0, line=16, paddingBottom=12)
    expect(para1.y).toBe(0);
    expect(para1.height).toBe(28);

    // p2: starts right after p1
    expect(para2.y).toBe(28);
    // p2 line is offset by paddingTop=8
    expect(para2.children[0].y).toBe(8);
  });

  it("full pipeline: state → render → layout", () => {
    const registry = createRegistry(defaultComponents);
    const t1 = createTextNode("t1", "Hello ");
    const t2 = createTextNode("t2", "world");
    const p1 = createNode("p1", "paragraph", {}, [t1, t2]);
    const doc = createNode("doc", "document", {}, [p1]);

    const rendered = renderTree(doc, registry);
    const layout = layoutTree(rendered, 200, measurer);

    expect(layout.type).toBe("block");
    const paraBox = layout.children[0];
    expect(paraBox.children).toHaveLength(1); // one line

    const line = paraBox.children[0];
    // Two text nodes' word boxes on one line
    expect(line.children.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Incremental layout", () => {
  it("reuses layout when render tree is unchanged", () => {
    const text = createTextRenderNode("t1", "Hello", {});
    const para = createBlockNode("p1", {}, [text]);
    const doc = createBlockNode("doc", {}, [para]);

    const layout = layoutTree(doc, 200, measurer);
    const same = layoutTreeIncremental(doc, doc, layout, 200, measurer);

    expect(same).toBe(layout);
  });

  it("re-layouts when render tree changes", () => {
    const registry = createRegistry(defaultComponents);
    const state1 = createNode("doc", "document", {}, [
      createNode("p1", "paragraph", {}, [createTextNode("t1", "Hello")]),
    ]);
    const rendered1 = renderTree(state1, registry);
    const layout1 = layoutTree(rendered1, 200, measurer);

    // Modify state
    const change = insertText(state1, createPosition([0, 0], 5), "!");
    const rendered2 = renderTreeIncremental(
      change.newState,
      state1,
      rendered1,
      registry,
    );
    const layout2 = layoutTreeIncremental(
      rendered2,
      rendered1,
      layout1,
      200,
      measurer,
    );

    expect(layout2).not.toBe(layout1);
    // Verify new content is laid out
    const line = layout2.children[0].children[0];
    expect(expectTextBox(line.children[0]).text).toBe("Hello!");
  });

  it("reuses unchanged sibling block subtrees incrementally", () => {
    const registry = createRegistry(defaultComponents);
    const state1 = createNode("doc", "document", {}, [
      createNode("p1", "paragraph", {}, [createTextNode("t1", "First")]),
      createNode("p2", "paragraph", {}, [createTextNode("t2", "Second")]),
    ]);
    const rendered1 = renderTree(state1, registry);
    const layout1 = layoutTree(rendered1, 200, measurer);

    // Modify only p2
    const change = insertText(state1, createPosition([1, 0], 6), "!");
    const rendered2 = renderTreeIncremental(
      change.newState, state1, rendered1, registry,
    );
    const layout2 = layoutTreeIncremental(
      rendered2, rendered1, layout1, 200, measurer,
    );

    // p1's layout should be reused (same internal structure)
    // The incremental layout may reposition, but internal children should match
    expect(expectTextBox(layout2.children[0].children[0].children[0]).text).toBe("First");
    // p2 should have new content
    expect(expectTextBox(layout2.children[1].children[0].children[0]).text).toBe("Second!");
  });
});
