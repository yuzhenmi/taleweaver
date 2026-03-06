import { describe, it, expect } from "vitest";
import type { LayoutBox, PageLayoutBox } from "./layout-node";
import type { TextLayoutBox } from "./text-layout-box";
import { createMockMeasurer } from "./text-measurer";
import { layoutTree, layoutTreeIncremental } from "./layout-engine";
import {
  createBlockNode,
  createTableNode,
  createTextRenderNode,
} from "../render/render-node";
import type { TableLayoutBox } from "./table-layout-box";
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

  it("breaks a long word that exceeds available width at character boundaries", () => {
    // Container width = 40px, each char = 8px → 5 chars per line
    // "abcdefgh" = 8 chars = 64px > 40px → must break
    const text = createTextRenderNode("t1", "abcdefgh", {});
    const para = createBlockNode("p1", {}, [text]);
    const doc = createBlockNode("doc", {}, [para]);

    const layout = layoutTree(doc, 40, measurer);
    const paraBox = layout.children[0];

    // Should break into 2 lines: "abcde" (40px) and "fgh" (24px)
    expect(paraBox.children).toHaveLength(2);
    expect(expectTextBox(paraBox.children[0].children[0]).text).toBe("abcde");
    expect(expectTextBox(paraBox.children[1].children[0]).text).toBe("fgh");
  });

  it("breaks a very long word across multiple lines", () => {
    // Container width = 24px → 3 chars per line
    // "abcdefg" = 7 chars → lines: "abc", "def", "g"
    const text = createTextRenderNode("t1", "abcdefg", {});
    const para = createBlockNode("p1", {}, [text]);
    const doc = createBlockNode("doc", {}, [para]);

    const layout = layoutTree(doc, 24, measurer);
    const paraBox = layout.children[0];

    expect(paraBox.children).toHaveLength(3);
    expect(expectTextBox(paraBox.children[0].children[0]).text).toBe("abc");
    expect(expectTextBox(paraBox.children[1].children[0]).text).toBe("def");
    expect(expectTextBox(paraBox.children[2].children[0]).text).toBe("g");
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

function expectPageBox(box: LayoutBox): PageLayoutBox {
  if (box.type !== "page")
    throw new Error(`Expected page layout box, got "${box.type}"`);
  return box;
}

describe("Pagination", () => {
  it("produces no page boxes when pageHeight is omitted", () => {
    const text = createTextRenderNode("t1", "Hello", {});
    const para = createBlockNode("p1", {}, [text]);
    const doc = createBlockNode("doc", {}, [para]);

    const layout = layoutTree(doc, 200, measurer);

    // No page boxes anywhere in the tree
    expect(layout.type).toBe("block");
    expect(layout.children.every((c) => c.type !== "page")).toBe(true);
  });

  it("wraps all content in a single page when it fits", () => {
    const text = createTextRenderNode("t1", "Hello", {});
    const para = createBlockNode("p1", {}, [text]);
    const doc = createBlockNode("doc", {}, [para]);

    // pageHeight=100, content is only 16px tall
    const layout = layoutTree(doc, 200, measurer, 100);

    expect(layout.type).toBe("block"); // document
    expect(layout.children).toHaveLength(1);
    const page = expectPageBox(layout.children[0]);
    expect(page.type).toBe("page");
    expect(page.y).toBe(0);
    expect(page.height).toBe(100);
    // The paragraph is inside the page
    expect(page.children).toHaveLength(1);
    expect(page.children[0].type).toBe("block");
  });

  it("distributes blocks across pages when content exceeds page height", () => {
    // Two paragraphs, each 16px tall. pageHeight = 20 → one per page.
    const t1 = createTextRenderNode("t1", "First", {});
    const t2 = createTextRenderNode("t2", "Second", {});
    const p1 = createBlockNode("p1", {}, [t1]);
    const p2 = createBlockNode("p2", {}, [t2]);
    const doc = createBlockNode("doc", {}, [p1, p2]);

    const layout = layoutTree(doc, 200, measurer, 20);

    expect(layout.children).toHaveLength(2);
    const page0 = expectPageBox(layout.children[0]);
    const page1 = expectPageBox(layout.children[1]);

    expect(page0.children).toHaveLength(1); // p1
    expect(page1.children).toHaveLength(1); // p2
  });

  it("all pages have y = 0 (per-page coordinate space)", () => {
    const t1 = createTextRenderNode("t1", "First", {});
    const t2 = createTextRenderNode("t2", "Second", {});
    const p1 = createBlockNode("p1", {}, [t1]);
    const p2 = createBlockNode("p2", {}, [t2]);
    const doc = createBlockNode("doc", {}, [p1, p2]);

    const layout = layoutTree(doc, 200, measurer, 20);

    const page0 = expectPageBox(layout.children[0]);
    const page1 = expectPageBox(layout.children[1]);
    expect(page0.y).toBe(0);
    expect(page1.y).toBe(0);
  });

  it("positions content within pages relative to the page (y starts at 0)", () => {
    const t1 = createTextRenderNode("t1", "First", {});
    const t2 = createTextRenderNode("t2", "Second", {});
    const p1 = createBlockNode("p1", {}, [t1]);
    const p2 = createBlockNode("p2", {}, [t2]);
    const doc = createBlockNode("doc", {}, [p1, p2]);

    const layout = layoutTree(doc, 200, measurer, 20);

    const page1 = expectPageBox(layout.children[1]);
    // p2 should start at y=0 within page 1
    expect(page1.children[0].y).toBe(0);
  });

  it("keeps oversized block on its page (no infinite loop)", () => {
    // One paragraph with 2 lines → 32px tall. pageHeight = 10.
    // Block is first on page and exceeds page height → stays.
    const text = createTextRenderNode("t1", "hello world", {});
    const para = createBlockNode("p1", {}, [text]);
    const doc = createBlockNode("doc", {}, [para]);

    // 80px wide → "hello " on line 1, "world" on line 2 → 32px
    const layout = layoutTree(doc, 80, measurer, 10);

    expect(layout.children).toHaveLength(1);
    const page = expectPageBox(layout.children[0]);
    expect(page.children).toHaveLength(1);
    // The block stays even though it's taller than the page
    expect(page.children[0].type).toBe("block");
  });

  it("works with padded blocks", () => {
    // Padded paragraph: paddingTop=10, content=16, paddingBottom=10 → height=36
    const t1 = createTextRenderNode("t1", "First", {});
    const t2 = createTextRenderNode("t2", "Second", {});
    const p1 = createBlockNode("p1", { paddingTop: 10, paddingBottom: 10 }, [t1]);
    const p2 = createBlockNode("p2", {}, [t2]);
    const doc = createBlockNode("doc", {}, [p1, p2]);

    // pageHeight=40: p1 is 36px, fits on page 0. p1 + p2 = 52px, so p2 goes to page 1.
    const layout = layoutTree(doc, 200, measurer, 40);

    expect(layout.children).toHaveLength(2);
    const page0 = expectPageBox(layout.children[0]);
    const page1 = expectPageBox(layout.children[1]);
    expect(page0.children).toHaveLength(1); // p1
    expect(page1.children).toHaveLength(1); // p2
  });
});

describe("Pagination with margins", () => {
  const margins = { top: 96, bottom: 96, left: 72, right: 72 };

  it("positions content at (marginLeft, marginTop) within page", () => {
    const text = createTextRenderNode("t1", "Hello", {});
    const para = createBlockNode("p1", {}, [text]);
    const doc = createBlockNode("doc", {}, [para]);

    // containerWidth=816, pageHeight=1056
    const layout = layoutTree(doc, 816, measurer, 1056, margins);

    const page = expectPageBox(layout.children[0]);
    expect(page.width).toBe(816);
    expect(page.height).toBe(1056);

    // Paragraph should be positioned at margins
    const paraBox = page.children[0];
    expect(paraBox.x).toBe(72); // marginLeft
    expect(paraBox.y).toBe(96); // marginTop
  });

  it("uses content width for line wrapping (containerWidth - left - right)", () => {
    // contentWidth = 816 - 72 - 72 = 672
    // 672 / 8 = 84 chars fit per line
    // "a" repeated 85 times → should wrap to 2 lines
    const longText = createTextRenderNode("t1", "a ".repeat(42) + "b", {});
    const para = createBlockNode("p1", {}, [longText]);
    const doc = createBlockNode("doc", {}, [para]);

    const layout = layoutTree(doc, 816, measurer, 1056, margins);
    const page = expectPageBox(layout.children[0]);
    const paraBox = page.children[0];

    // Should have multiple lines since text exceeds content width
    expect(paraBox.children.length).toBeGreaterThan(1);
  });

  it("distributes blocks across pages by content height (pageHeight - top - bottom)", () => {
    // contentHeight = 1056 - 96 - 96 = 864
    // Each para is 16px tall. 864/16 = 54 paras fit per page.
    // Create 55 paragraphs → should overflow to page 2
    const paras = Array.from({ length: 55 }, (_, i) => {
      const t = createTextRenderNode(`t${i}`, `Para ${i}`, {});
      return createBlockNode(`p${i}`, {}, [t]);
    });
    const doc = createBlockNode("doc", {}, paras);

    const layout = layoutTree(doc, 816, measurer, 1056, margins);

    expect(layout.children.length).toBe(2);
    const page0 = expectPageBox(layout.children[0]);
    const page1 = expectPageBox(layout.children[1]);

    expect(page0.children.length).toBe(54); // 54 * 16 = 864 = contentHeight
    expect(page1.children.length).toBe(1);
  });

  it("blocks on page 1 start at y = margins.top", () => {
    // Two paragraphs that exceed content height on one page
    // contentHeight = 100 - 20 - 20 = 60, para height = 16
    // 4 paras = 64px > 60px → 3 on page 0, 1 on page 1
    const smallMargins = { top: 20, bottom: 20, left: 10, right: 10 };
    const paras = Array.from({ length: 4 }, (_, i) => {
      const t = createTextRenderNode(`t${i}`, `P${i}`, {});
      return createBlockNode(`p${i}`, {}, [t]);
    });
    const doc = createBlockNode("doc", {}, paras);

    const layout = layoutTree(doc, 200, measurer, 100, smallMargins);

    const page1 = expectPageBox(layout.children[1]);
    // First block on page 1 should start at marginTop
    expect(page1.children[0].y).toBe(20);
  });

  it("all pages have y = 0 (per-page coordinate space)", () => {
    const smallMargins = { top: 10, bottom: 10, left: 5, right: 5 };
    const paras = Array.from({ length: 3 }, (_, i) => {
      const t = createTextRenderNode(`t${i}`, `P${i}`, {});
      return createBlockNode(`p${i}`, {}, [t]);
    });
    const doc = createBlockNode("doc", {}, paras);

    // contentHeight = 30 - 10 - 10 = 10, each para = 16px → one per page
    const layout = layoutTree(doc, 200, measurer, 30, smallMargins);

    expect(layout.children.length).toBe(3);
    expect(layout.children[0].y).toBe(0);
    expect(layout.children[1].y).toBe(0);
    expect(layout.children[2].y).toBe(0);
  });

  it("document height = pageCount * pageHeight", () => {
    const smallMargins = { top: 10, bottom: 10, left: 5, right: 5 };
    const paras = Array.from({ length: 3 }, (_, i) => {
      const t = createTextRenderNode(`t${i}`, `P${i}`, {});
      return createBlockNode(`p${i}`, {}, [t]);
    });
    const doc = createBlockNode("doc", {}, paras);

    const layout = layoutTree(doc, 200, measurer, 30, smallMargins);
    expect(layout.height).toBe(90); // 3 pages * 30
  });

  it("without margins: behavior unchanged (backward compat)", () => {
    const t1 = createTextRenderNode("t1", "First", {});
    const t2 = createTextRenderNode("t2", "Second", {});
    const p1 = createBlockNode("p1", {}, [t1]);
    const p2 = createBlockNode("p2", {}, [t2]);
    const doc = createBlockNode("doc", {}, [p1, p2]);

    const layout = layoutTree(doc, 200, measurer, 20);

    const page0 = expectPageBox(layout.children[0]);
    const page1 = expectPageBox(layout.children[1]);
    // Without margins, content starts at y=0
    expect(page0.children[0].y).toBe(0);
    expect(page1.children[0].y).toBe(0);
    // Page width = docBox.width (no margins)
    expect(page0.width).toBe(200);
  });
});

describe("Block margins", () => {
  it("adds inter-block spacing from block margins", () => {
    // Two blocks with blockMarginBottom/blockMarginTop
    // measurer: lineHeight = 16px
    // blockMarginBottom=0.5 → 0.5 * 16 = 8px, blockMarginTop=0.25 → 0.25 * 16 = 4px
    // Max gap = max(8, 4) = 8px
    const t1 = createTextRenderNode("t1", "First", {});
    const t2 = createTextRenderNode("t2", "Second", {});
    const p1 = createBlockNode("p1", { blockMarginBottom: 0.5 }, [t1]);
    const p2 = createBlockNode("p2", { blockMarginTop: 0.25 }, [t2]);
    const doc = createBlockNode("doc", {}, [p1, p2]);

    const layout = layoutTree(doc, 200, measurer);

    const para1 = layout.children[0];
    const para2 = layout.children[1];

    expect(para1.y).toBe(0);
    expect(para1.height).toBe(16);
    // p2 should be offset by the block margin gap (8px)
    expect(para2.y).toBe(16 + 8);
  });

  it("block margin does not add extra space when line margins already exceed it", () => {
    // lineMarginBottom=0.5 → 8px, lineMarginTop=0.5 → 8px
    // Line margins collapse: overlap = min(8, 8) = 8, lineGap = 8 + 8 - 8 = 8
    // blockMarginBottom=0.25 → 4px, blockMarginTop=0.25 → 4px
    // blockGap = max(4, 4) = 4. Since lineGap (8) >= blockGap (4), extraSpace = 0
    const t1 = createTextRenderNode("t1", "First", {});
    const t2 = createTextRenderNode("t2", "Second", {});
    const p1 = createBlockNode("p1", { lineMarginBottom: 0.5, blockMarginBottom: 0.25 }, [t1]);
    const p2 = createBlockNode("p2", { lineMarginTop: 0.5, blockMarginTop: 0.25 }, [t2]);
    const doc = createBlockNode("doc", {}, [p1, p2]);

    const layout = layoutTree(doc, 200, measurer);

    const para1 = layout.children[0];
    const para2 = layout.children[1];

    // Line margins: p1 bottom margin = 8px (included in line), p2 top margin = 8px
    // overlap = 8, so childY -= 8 after stacking
    // Block margin gap doesn't add more since line margins already cover it
    // p1 height = 16 + 8 (line marginBottom on last line)
    // p2 starts at p1.y + p1.height - overlap = 0 + 24 - 8 = 16
    // Then extraSpace = max(0, 4 - 8) = 0
    expect(para1.y).toBe(0);
    expect(para2.y).toBe(16);
  });

  it("block margin acts as minimum gap when line margins are smaller", () => {
    // lineMarginBottom=0.1 → 1.6px, lineMarginTop=0.1 → 1.6px
    // overlap = min(1.6, 1.6) = 1.6, lineGap = 1.6 + 1.6 - 1.6 = 1.6
    // blockMarginBottom=0.5 → 8px, blockMarginTop=0.5 → 8px
    // blockGap = max(8, 8) = 8. extraSpace = max(0, 8 - 1.6) = 6.4
    const t1 = createTextRenderNode("t1", "First", {});
    const t2 = createTextRenderNode("t2", "Second", {});
    const p1 = createBlockNode("p1", { lineMarginBottom: 0.1, blockMarginBottom: 0.5 }, [t1]);
    const p2 = createBlockNode("p2", { lineMarginTop: 0.1, blockMarginTop: 0.5 }, [t2]);
    const doc = createBlockNode("doc", {}, [p1, p2]);

    const layout = layoutTree(doc, 200, measurer);

    const para1 = layout.children[0];
    const para2 = layout.children[1];

    // p1 height = 16 + 1.6 (last line marginBottom)
    // p2 starts at p1.y + p1.height - overlap + extraSpace
    //   = 0 + 17.6 - 1.6 + 6.4 = 22.4
    expect(para1.y).toBe(0);
    expect(para2.y).toBeCloseTo(22.4, 5);
  });

  it("without block margins behavior is unchanged", () => {
    const t1 = createTextRenderNode("t1", "First", {});
    const t2 = createTextRenderNode("t2", "Second", {});
    const p1 = createBlockNode("p1", {}, [t1]);
    const p2 = createBlockNode("p2", {}, [t2]);
    const doc = createBlockNode("doc", {}, [p1, p2]);

    const layout = layoutTree(doc, 200, measurer);

    expect(layout.children[0].y).toBe(0);
    expect(layout.children[0].height).toBe(16);
    expect(layout.children[1].y).toBe(16);
  });
});

describe("List marker layout", () => {
  it("passes marker through from render node to layout box", () => {
    const text = createTextRenderNode("t1", "Item", {});
    const para = createBlockNode("p1", {}, [text]);
    const listItem = createBlockNode("li1", { paddingLeft: 24 }, [para], "\u2022");
    const list = createBlockNode("list1", {}, [listItem]);
    const doc = createBlockNode("doc", {}, [list]);

    const layout = layoutTree(doc, 200, measurer);

    // list > list-item
    const listBox = layout.children[0];
    const listItemBox = listBox.children[0];
    expect(listItemBox.type).toBe("block");
    if (listItemBox.type === "block") {
      expect(listItemBox.marker).toBe("\u2022");
    }
  });

  it("does not set marker on blocks without marker", () => {
    const text = createTextRenderNode("t1", "Hello", {});
    const para = createBlockNode("p1", {}, [text]);
    const doc = createBlockNode("doc", {}, [para]);

    const layout = layoutTree(doc, 200, measurer);

    const paraBox = layout.children[0];
    if (paraBox.type === "block") {
      expect(paraBox.marker).toBeUndefined();
    }
  });
});

describe("Incremental layout for lists", () => {
  it("text Y position stays stable when inserting characters into a list item", () => {
    const registry = createRegistry(defaultComponents);
    const state1 = createNode("doc", "document", {}, [
      createNode("list-1", "list", { listType: "unordered" }, [
        createNode("li-1", "list-item", {}, [
          createNode("p1", "paragraph", {}, [createTextNode("t1", "hello")]),
        ]),
      ]),
    ]);

    const rendered1 = renderTree(state1, registry);
    const layout1 = layoutTree(rendered1, 200, measurer);

    // Find the text box Y position in the initial layout
    function findTextBox(box: LayoutBox): LayoutBox | null {
      if (box.type === "text") return box;
      for (const child of box.children) {
        const found = findTextBox(child);
        if (found) return found;
      }
      return null;
    }

    function getAbsoluteY(layout: LayoutBox, targetKey: string, parentY = 0): number | null {
      const absY = parentY + layout.y;
      if (layout.type === "text" && layout.key.startsWith(targetKey)) return absY;
      for (const child of layout.children) {
        const found = getAbsoluteY(child, targetKey, absY);
        if (found !== null) return found;
      }
      return null;
    }

    const initialY = getAbsoluteY(layout1, "t1");
    expect(initialY).not.toBeNull();

    // Insert a character
    const change = insertText(state1, createPosition([0, 0, 0, 0], 5), "!");
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

    const afterY = getAbsoluteY(layout2, "t1");
    expect(afterY).toBe(initialY);

    // Insert another character
    const change2 = insertText(change.newState, createPosition([0, 0, 0, 0], 6), "!");
    const rendered3 = renderTreeIncremental(
      change2.newState,
      change.newState,
      rendered2,
      registry,
    );
    const layout3 = layoutTreeIncremental(
      rendered3,
      rendered2,
      layout2,
      200,
      measurer,
    );

    const afterY2 = getAbsoluteY(layout3, "t1");
    expect(afterY2).toBe(initialY);
  });

  it("text Y stays stable without paragraph wrapper (handleToggleList state)", () => {
    // handleToggleList puts text directly under list-item (no paragraph)
    const registry = createRegistry(defaultComponents);
    const state1 = createNode("doc", "document", {}, [
      createNode("list-1", "list", { listType: "unordered" }, [
        createNode("li-1", "list-item", {}, [
          createTextNode("t1", "hello"),
        ]),
      ]),
    ]);

    const rendered1 = renderTree(state1, registry);
    const layout1 = layoutTree(rendered1, 200, measurer);

    function getAbsoluteY(layout: LayoutBox, targetKey: string, parentY = 0): number | null {
      const absY = parentY + layout.y;
      if (layout.type === "text" && layout.key.startsWith(targetKey)) return absY;
      for (const child of layout.children) {
        const found = getAbsoluteY(child, targetKey, absY);
        if (found !== null) return found;
      }
      return null;
    }

    const initialY = getAbsoluteY(layout1, "t1");
    expect(initialY).not.toBeNull();

    // Insert characters one at a time (path [0, 0, 0] = doc > list > list-item > text)
    let prevState = state1;
    let prevRendered = rendered1;
    let prevLayout = layout1;

    for (let i = 0; i < 5; i++) {
      const change = insertText(prevState, createPosition([0, 0, 0], 5 + i), "!");
      const rendered = renderTreeIncremental(change.newState, prevState, prevRendered, registry);
      const layout = layoutTreeIncremental(rendered, prevRendered, prevLayout, 200, measurer);

      const textY = getAbsoluteY(layout, "t1");
      expect(textY).toBe(initialY);

      prevState = change.newState;
      prevRendered = rendered;
      prevLayout = layout;
    }
  });

  it("text Y stays stable with pagination when inserting into a list item", () => {
    const registry = createRegistry(defaultComponents);
    const margins = { top: 96, bottom: 96, left: 72, right: 72 };
    const state1 = createNode("doc", "document", {}, [
      createNode("list-1", "list", { listType: "unordered" }, [
        createNode("li-1", "list-item", {}, [
          createNode("p1", "paragraph", {}, [createTextNode("t1", "hello")]),
        ]),
      ]),
    ]);

    const rendered1 = renderTree(state1, registry);
    const layout1 = layoutTree(rendered1, 816, measurer, 1056, margins);

    function getAbsoluteY(layout: LayoutBox, targetKey: string, parentY = 0): number | null {
      const absY = parentY + layout.y;
      if (layout.type === "text" && layout.key.startsWith(targetKey)) return absY;
      for (const child of layout.children) {
        const found = getAbsoluteY(child, targetKey, absY);
        if (found !== null) return found;
      }
      return null;
    }

    const initialY = getAbsoluteY(layout1, "t1");
    expect(initialY).not.toBeNull();

    // Insert a character
    const change = insertText(state1, createPosition([0, 0, 0, 0], 5), "!");
    const rendered2 = renderTreeIncremental(change.newState, state1, rendered1, registry);
    const layout2 = layoutTreeIncremental(rendered2, rendered1, layout1, 816, measurer, 1056, margins);

    const afterY = getAbsoluteY(layout2, "t1");
    expect(afterY).toBe(initialY);

    // Insert another character
    const change2 = insertText(change.newState, createPosition([0, 0, 0, 0], 6), "!");
    const rendered3 = renderTreeIncremental(change2.newState, change.newState, rendered2, registry);
    const layout3 = layoutTreeIncremental(rendered3, rendered2, layout2, 816, measurer, 1056, margins);

    const afterY2 = getAbsoluteY(layout3, "t1");
    expect(afterY2).toBe(initialY);
  });

  it("preserves marker through incremental layout", () => {
    const registry = createRegistry(defaultComponents);
    const state1 = createNode("doc", "document", {}, [
      createNode("list-1", "list", { listType: "unordered" }, [
        createNode("li-1", "list-item", {}, [
          createNode("p1", "paragraph", {}, [createTextNode("t1", "hello")]),
        ]),
      ]),
    ]);

    const rendered1 = renderTree(state1, registry);
    const layout1 = layoutTree(rendered1, 200, measurer);

    // Verify marker exists initially
    const listBox1 = layout1.children[0];
    const listItemBox1 = listBox1.children[0];
    expect(listItemBox1.type).toBe("block");
    if (listItemBox1.type === "block") {
      expect(listItemBox1.marker).toBe("\u2022");
    }

    // Insert a character and do incremental layout
    const change = insertText(state1, createPosition([0, 0, 0, 0], 5), "!");
    const rendered2 = renderTreeIncremental(change.newState, state1, rendered1, registry);
    const layout2 = layoutTreeIncremental(rendered2, rendered1, layout1, 200, measurer);

    // Marker should still be present after incremental layout
    const listBox2 = layout2.children[0];
    const listItemBox2 = listBox2.children[0];
    expect(listItemBox2.type).toBe("block");
    if (listItemBox2.type === "block") {
      expect(listItemBox2.marker).toBe("\u2022");
    }
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

function expectTableBox(box: LayoutBox): TableLayoutBox {
  if (box.type !== "table")
    throw new Error(`Expected table layout box, got "${box.type}"`);
  return box;
}

describe("Table layout", () => {
  it("lays out a 2x2 table with cells positioned horizontally", () => {
    // 2 cols: 1/3, 2/3 of 300px → 100px, 200px
    const cell00 = createBlockNode("c00", {}, [createTextRenderNode("t00", "A", {})]);
    const cell01 = createBlockNode("c01", {}, [createTextRenderNode("t01", "B", {})]);
    const row0 = createBlockNode("r0", {}, [cell00, cell01]);
    const cell10 = createBlockNode("c10", {}, [createTextRenderNode("t10", "C", {})]);
    const cell11 = createBlockNode("c11", {}, [createTextRenderNode("t11", "D", {})]);
    const row1 = createBlockNode("r1", {}, [cell10, cell11]);
    const table = createTableNode("g1", {}, [row0, row1], [1/3, 2/3], [0, 0]);
    const doc = createBlockNode("doc", {}, [table]);

    const layout = layoutTree(doc, 300, measurer);
    const tableBox = expectTableBox(layout.children[0]);

    expect(tableBox.type).toBe("table");
    // Resolved to pixels: 1/3 * 300 = 100, 2/3 * 300 = 200
    expect(tableBox.columnWidths).toEqual([100, 200]);

    // Row 0
    const rowBox0 = tableBox.children[0];
    expect(rowBox0.y).toBe(0);
    // Cell 0,0 at x=0 with width=100
    expect(rowBox0.children[0].x).toBe(0);
    expect(rowBox0.children[0].width).toBe(100);
    // Cell 0,1 at x=100 with width=200
    expect(rowBox0.children[1].x).toBe(100);
    expect(rowBox0.children[1].width).toBe(200);

    // Row 1 stacked below row 0
    const rowBox1 = tableBox.children[1];
    expect(rowBox1.y).toBe(rowBox0.height);
  });

  it("auto row height equals tallest cell content", () => {
    // Cell with padding will be taller
    const cell0 = createBlockNode("c0", { paddingTop: 10, paddingBottom: 10 }, [
      createTextRenderNode("t0", "Tall", {}),
    ]);
    const cell1 = createBlockNode("c1", {}, [createTextRenderNode("t1", "Short", {})]);
    const row = createBlockNode("r0", {}, [cell0, cell1]);
    const table = createTableNode("g1", {}, [row], [0.5, 0.5], [0]);
    const doc = createBlockNode("doc", {}, [table]);

    const layout = layoutTree(doc, 200, measurer);
    const tableBox = expectTableBox(layout.children[0]);

    // cell0 height = 10 + 16 + 10 = 36, cell1 height = 16
    // auto row height = max(36, 16) = 36
    expect(tableBox.rowHeights[0]).toBe(36);
  });

  it("explicit row height is used when larger than content", () => {
    const cell = createBlockNode("c0", {}, [createTextRenderNode("t0", "Hi", {})]);
    const row = createBlockNode("r0", {}, [cell]);
    const table = createTableNode("g1", {}, [row], [1], [50]);
    const doc = createBlockNode("doc", {}, [table]);

    const layout = layoutTree(doc, 200, measurer);
    const tableBox = expectTableBox(layout.children[0]);

    // content height = 16, explicit = 50 → max = 50
    expect(tableBox.rowHeights[0]).toBe(50);
  });

  it("single-row single-column edge case", () => {
    const cell = createBlockNode("c0", {}, [createTextRenderNode("t0", "Only", {})]);
    const row = createBlockNode("r0", {}, [cell]);
    const table = createTableNode("g1", {}, [row], [1], [0]);
    const doc = createBlockNode("doc", {}, [table]);

    const layout = layoutTree(doc, 200, measurer);
    const tableBox = expectTableBox(layout.children[0]);

    expect(tableBox.children).toHaveLength(1);
    // Resolved: 1 * 200 = 200
    expect(tableBox.columnWidths).toEqual([200]);
    expect(tableBox.rowHeights).toEqual([16]);
    expect(tableBox.height).toBe(16);
  });
});
