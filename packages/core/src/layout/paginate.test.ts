import { describe, it, expect } from "vitest";
import { paginateRoot } from "./paginate";
import { createBlockBox } from "./layout-box-v2";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import { computeUsedStyle } from "./used-style";
import type { BlockBox } from "./layout-box-v2";
import type { PageConfig } from "./page-config";

const cs = INITIAL_COMPUTED_STYLE;
const us = computeUsedStyle(cs, 800, "indefinite");

const PAGE_CONFIG: PageConfig = {
  pageInlineSize: 800,
  pageBlockSize:  600,
  pageMargins:    { blockStart: 50, blockEnd: 50, inlineStart: 50, inlineEnd: 50 },
  pageGap:        20,
};

// Helper: a paragraph-shaped block at a given blockOffset and blockSize.
function makeParagraph(key: string, blockOffset: number, blockSize: number): BlockBox {
  return createBlockBox(
    key, 50, blockOffset,
    700, blockSize,
    "horizontal-tb", "ltr", cs, us,
    [], 800,
  );
}

// Helper: a root BlockBox containing N paragraphs of given blockSizes, stacked vertically.
function makeRoot(paragraphSizes: readonly number[]): BlockBox {
  const children: BlockBox[] = [];
  let y = 0;
  for (let i = 0; i < paragraphSizes.length; i++) {
    children.push(makeParagraph(`p-${i}`, y, paragraphSizes[i]));
    y += paragraphSizes[i];
  }
  return createBlockBox(
    "doc", 0, 0,
    800, y,
    "horizontal-tb", "ltr", cs, us,
    children, 800,
  );
}

describe("paginateRoot", () => {
  it("places a single small paragraph on one page", () => {
    const root = makeRoot([100]);
    const result = paginateRoot(root, PAGE_CONFIG);

    expect(result.type).toBe("block");
    expect(result.children).toHaveLength(1);
    expect(result.children[0].type).toBe("page");
    if (result.children[0].type !== "page") throw new Error("expected page");
    expect(result.children[0].children).toHaveLength(1);
    expect(result.children[0].children[0].blockOffset).toBe(0);
  });

  it("splits paragraphs across two pages when they overflow one page's content area", () => {
    // Page content area = 600 - 50 - 50 = 500.
    // Three paragraphs of 200 each: first two fit on page 1 (400 of 500 used);
    // third pushes to page 2.
    const root = makeRoot([200, 200, 200]);
    const result = paginateRoot(root, PAGE_CONFIG);

    expect(result.children).toHaveLength(2);
    if (result.children[0].type !== "page" || result.children[1].type !== "page") throw new Error("expected pages");
    expect(result.children[0].children).toHaveLength(2);
    expect(result.children[1].children).toHaveLength(1);
  });

  it("places page block-offsets with pageGap between pages", () => {
    const root = makeRoot([400, 400]);
    const result = paginateRoot(root, PAGE_CONFIG);

    expect(result.children).toHaveLength(2);
    if (result.children[0].type !== "page" || result.children[1].type !== "page") throw new Error("expected pages");
    expect(result.children[0].blockOffset).toBe(0);
    expect(result.children[1].blockOffset).toBe(PAGE_CONFIG.pageBlockSize + PAGE_CONFIG.pageGap);
  });

  it("places a single oversized block on its own page (overflows past page bottom)", () => {
    // Page content area = 500; one paragraph of 800 doesn't fit.
    const root = makeRoot([800]);
    const result = paginateRoot(root, PAGE_CONFIG);

    expect(result.children).toHaveLength(1);
    if (result.children[0].type !== "page") throw new Error("expected page");
    expect(result.children[0].children).toHaveLength(1);
    expect(result.children[0].children[0].blockSize).toBe(800);
  });

  it("preserves block keys for placed blocks", () => {
    const root = makeRoot([100, 100]);
    const result = paginateRoot(root, PAGE_CONFIG);

    if (result.children[0].type !== "page") throw new Error("expected page");
    expect(result.children[0].children[0].key).toBe("p-0");
    expect(result.children[0].children[1].key).toBe("p-1");
  });

  it("emits a single blank page for an empty rootBlock.children", () => {
    const root = makeRoot([]);
    const result = paginateRoot(root, PAGE_CONFIG);

    expect(result.type).toBe("block");
    expect(result.children).toHaveLength(1);
    expect(result.children[0].type).toBe("page");
    if (result.children[0].type !== "page") throw new Error("expected page");
    expect(result.children[0].children).toHaveLength(0);
    expect(result.children[0].pageIndex).toBe(0);
  });

  it("throws when pageMargins exceed pageBlockSize", () => {
    const badConfig: PageConfig = {
      pageInlineSize: 800,
      pageBlockSize:  100,
      pageMargins:    { blockStart: 60, blockEnd: 60, inlineStart: 50, inlineEnd: 50 },  // 60+60 > 100
      pageGap:        20,
    };
    const root = makeRoot([100]);
    expect(() => paginateRoot(root, badConfig)).toThrow(/Invalid PageConfig/);
  });
});
