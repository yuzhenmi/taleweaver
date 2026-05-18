// packages/core/src/layout/paginate.test.ts
//
// P1.B: paginateRoot is now a per-page coordinator that drives layoutBlock;
// it is exercised end-to-end via layoutTree so that proper cascaded ElementBox
// nodes flow through the pipeline.
import { describe, it, expect } from "vitest";
import { layoutTree } from "./dispatch";
import { createNode, createTextNode } from "../state/create-node-legacy";
import { renderTree } from "../render/render-legacy";
import { cascadePass } from "../cascade";
import { createMockShaper } from "./mock-shaper";
import { createRegistry, defaultComponents } from "../components";
import type { PageConfig } from "./page-config";

const PAGE_CONFIG: PageConfig = {
  pageInlineSize: 800,
  pageBlockSize:  600,
  pageMargins:    { blockStart: 50, blockEnd: 50, inlineStart: 50, inlineEnd: 50 },
  pageGap:        20,
};

// Page content block size = 600 - 50 - 50 = 500px.

const reg = createRegistry([...defaultComponents]);

/** Build a cascaded render tree for a document with the given paragraphs. */
function buildDoc(paragraphTexts: readonly string[]) {
  const children = paragraphTexts.map((text, i) => {
    const t = createTextNode(`t-${i}`, text);
    return createNode(`p-${i}`, "paragraph", {}, [t]);
  });
  const doc = createNode("doc", "document", {}, children);
  return cascadePass(renderTree(doc, reg));
}

describe("paginateRoot (P1.B coordinator)", () => {
  it("places a single short paragraph on one page", () => {
    // One paragraph → all content fits on one page.
    const root = buildDoc(["Hello world"]);
    const result = layoutTree(root, 800, createMockShaper(8, 16), PAGE_CONFIG);

    expect(result.type).toBe("block");
    if (result.type !== "block") throw new Error("expected block");
    expect(result.children).toHaveLength(1);
    expect(result.children[0].type).toBe("page");
  });

  it("splits many paragraphs across multiple pages when content overflows", () => {
    // mockShaper line height = 16px. Page content = 500px → ~31 lines per page.
    // 200 paragraphs (one line each at 16px) → > 1 page guaranteed.
    const texts = Array.from({ length: 200 }, (_, i) => `Paragraph ${i}`);
    const root = buildDoc(texts);
    const result = layoutTree(root, 800, createMockShaper(8, 16), PAGE_CONFIG);

    expect(result.type).toBe("block");
    if (result.type !== "block") throw new Error("expected block");
    expect(result.children.length).toBeGreaterThan(1);
    for (const child of result.children) {
      expect(child.type).toBe("page");
    }
  });

  it("places page block-offsets with pageGap between pages", () => {
    // Enough content to fill at least 2 pages.
    const texts = Array.from({ length: 200 }, (_, i) => `Para ${i}`);
    const root = buildDoc(texts);
    const result = layoutTree(root, 800, createMockShaper(8, 16), PAGE_CONFIG);

    expect(result.type).toBe("block");
    if (result.type !== "block") throw new Error("expected block");
    expect(result.children.length).toBeGreaterThanOrEqual(2);
    expect(result.children[0].blockOffset).toBe(0);
    expect(result.children[1].blockOffset).toBe(PAGE_CONFIG.pageBlockSize + PAGE_CONFIG.pageGap);
  });

  it("emits a single blank page for an empty document", () => {
    // Document with no paragraphs → empty layout → should still produce one blank page.
    const root = buildDoc([]);
    const result = layoutTree(root, 800, createMockShaper(8, 16), PAGE_CONFIG);

    expect(result.type).toBe("block");
    if (result.type !== "block") throw new Error("expected block");
    expect(result.children).toHaveLength(1);
    expect(result.children[0].type).toBe("page");
    if (result.children[0].type !== "page") throw new Error("expected page");
    expect(result.children[0].pageIndex).toBe(0);
    // Empty doc: PageBox holds a single wrapping content-area BlockBox (the
    // BFC's output, positioned at the page's margin offset). The wrapping
    // block has no flow children — that's what "empty page" means.
    expect(result.children[0].children).toHaveLength(1);
    const contentArea = result.children[0].children[0];
    expect(contentArea.type).toBe("block");
    if (contentArea.type !== "block") throw new Error("expected wrapping block");
    expect(contentArea.children).toHaveLength(0);
  });

  it("produces no PageBoxes when pageConfig is omitted", () => {
    const root = buildDoc(["Hello world"]);
    const result = layoutTree(root, 800, createMockShaper(8, 16));

    expect(result.type).toBe("block");
    if (result.type !== "block") throw new Error("expected block");
    expect(result.children.length).toBeGreaterThan(0);
    expect(result.children[0].type).not.toBe("page");
  });

  it("throws when pageMargins exceed pageBlockSize", () => {
    const badConfig: PageConfig = {
      pageInlineSize: 800,
      pageBlockSize:  100,
      pageMargins:    { blockStart: 60, blockEnd: 60, inlineStart: 50, inlineEnd: 50 },
      pageGap:        20,
    };
    const root = buildDoc(["Hello"]);
    expect(() => layoutTree(root, 800, createMockShaper(8, 16), badConfig)).toThrow(/Invalid PageConfig/);
  });

  it("pageIndex increments for each page", () => {
    const texts = Array.from({ length: 200 }, (_, i) => `Para ${i}`);
    const root = buildDoc(texts);
    const result = layoutTree(root, 800, createMockShaper(8, 16), PAGE_CONFIG);

    expect(result.type).toBe("block");
    if (result.type !== "block") throw new Error("expected block");
    for (let i = 0; i < result.children.length; i++) {
      const child = result.children[i];
      if (child.type !== "page") throw new Error("expected page");
      expect(child.pageIndex).toBe(i);
    }
  });
});
