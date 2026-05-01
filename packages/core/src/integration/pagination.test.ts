import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "../state/create-node";
import { renderTree } from "../render/render";
import { cascadePass } from "../cascade";
import { layoutTree } from "../layout/dispatch";
import { createMockShaper } from "../layout/mock-shaper";
import { createRegistry, defaultComponents } from "../components";
import type { PageConfig } from "../layout/page-config";

const PAGE_CONFIG: PageConfig = {
  pageInlineSize: 800,
  pageBlockSize:  500,                // small for test purposes
  pageMargins:    { blockStart: 50, blockEnd: 50, inlineStart: 50, inlineEnd: 50 },
  pageGap:        20,
};

describe("pagination end-to-end", () => {
  it("produces no PageBoxes when pageConfig is omitted", () => {
    const reg = createRegistry([...defaultComponents]);
    const t = createTextNode("t1", "Hello world");
    const p = createNode("p1", "paragraph", {}, [t]);
    const doc = createNode("doc", "document", {}, [p]);

    const rendered = renderTree(doc, reg);
    const cascaded = cascadePass(rendered);
    const layout = layoutTree(cascaded, 800, createMockShaper(8, 16));

    expect(layout.type).toBe("block");
    if (layout.type !== "block") throw new Error("?");
    // No pagination — the root contains the paragraph directly.
    expect(layout.children.length).toBeGreaterThan(0);
    expect(layout.children[0].type).not.toBe("page");
  });

  it("produces PageBoxes when pageConfig is supplied and content exceeds one page", () => {
    const reg = createRegistry([...defaultComponents]);
    // Build many paragraphs so content overflows one page.
    // Each paragraph at ~16px line height with default font.
    // Page content height = 500 - 50 - 50 = 400 px → ~25 lines per page.
    // 100 paragraphs of one line each = 100 lines = ~4 pages.
    const paragraphs = [];
    for (let i = 0; i < 100; i++) {
      const t = createTextNode(`text-${i}`, `Paragraph ${i}`);
      const p = createNode(`para-${i}`, "paragraph", {}, [t]);
      paragraphs.push(p);
    }
    const doc = createNode("doc", "document", {}, paragraphs);

    const rendered = renderTree(doc, reg);
    const cascaded = cascadePass(rendered);
    const layout = layoutTree(cascaded, 800, createMockShaper(8, 16), PAGE_CONFIG);

    expect(layout.type).toBe("block");
    if (layout.type !== "block") throw new Error("?");
    // Root's children should all be PageBoxes when paginated.
    for (const child of layout.children) {
      expect(child.type).toBe("page");
    }
    // Should be more than one page.
    expect(layout.children.length).toBeGreaterThan(1);
  });

  it("page block-offsets respect pageGap", () => {
    const reg = createRegistry([...defaultComponents]);
    const paragraphs = [];
    for (let i = 0; i < 50; i++) {
      const t = createTextNode(`text-${i}`, `Para ${i}`);
      paragraphs.push(createNode(`p-${i}`, "paragraph", {}, [t]));
    }
    const doc = createNode("doc", "document", {}, paragraphs);

    const layout = layoutTree(
      cascadePass(renderTree(doc, reg)),
      800,
      createMockShaper(8, 16),
      PAGE_CONFIG,
    );

    if (layout.type !== "block") throw new Error("?");
    // Page 0 starts at blockOffset 0.
    expect(layout.children[0].blockOffset).toBe(0);
    // Page 1 starts at pageBlockSize + pageGap.
    if (layout.children.length >= 2) {
      expect(layout.children[1].blockOffset).toBe(
        PAGE_CONFIG.pageBlockSize + PAGE_CONFIG.pageGap,
      );
    }
  });
});
