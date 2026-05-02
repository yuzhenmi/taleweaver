// packages/core/src/integration/pagination-fragmentation.test.ts
import { describe, it, expect } from "vitest";
import { paginatedHarness } from "../test-utils/paginated-harness";
import type { PageConfig } from "../layout/page-config";
import type { RenderNode } from "../render/render-node-v2";
import type { LayoutBox } from "../layout/layout-box-v2";
import type { PageBox } from "../layout/page-box";

const PAGE: PageConfig = {
  pageInlineSize: 600,
  pageBlockSize: 200,
  pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
  pageGap: 24,
};

// Mock shaper: createMockShaper(8, 16) → each char is 8px wide, 16px tall.
// PAGE.pageInlineSize = 600. So each line fits 600/8 = 75 characters.
// Each "word " is 5 chars → 75/5 = 15 words per line.
// PAGE.pageBlockSize = 200; 200/16 = 12.5 → 12 lines per page.

function buildParagraph(words: number): RenderNode {
  const text = "word ".repeat(words).trim();
  return {
    type: "element" as const,
    key: "p",
    style: { display: "block" },
    children: [{ type: "text" as const, key: "t", style: {}, text }],
  };
}

function buildDocumentRoot(children: readonly RenderNode[]): RenderNode {
  return {
    type: "element" as const,
    key: "doc",
    style: { display: "block" },
    children,
  };
}

function countLinesIn(page: PageBox): number {
  function walkBox(box: LayoutBox): number {
    if (box.type === "line") return 1;
    if (box.type === "text-run" || box.type === "marker") return 0;
    if ("children" in box) {
      let total = 0;
      for (const c of box.children as readonly LayoutBox[]) {
        total += walkBox(c);
      }
      return total;
    }
    return 0;
  }
  let total = 0;
  for (const child of page.children) {
    total += walkBox(child);
  }
  return total;
}

describe("pagination integration — within-block fragmentation", () => {
  it("fragments a tall paragraph across two pages", () => {
    // 20 lines * 15 words/line = 300 words.
    // page fits 12 lines → 20-line paragraph must span at least 2 pages.
    const para = buildParagraph(20 * 15);
    const root = buildDocumentRoot([para]);
    const result = paginatedHarness(root, PAGE);
    expect(result.pages.length).toBeGreaterThanOrEqual(2);
    const totalLines = result.pages.reduce((sum, p) => sum + countLinesIn(p), 0);
    expect(totalLines).toBe(20);
  });

  it("respects break-before: page on a body paragraph", () => {
    const para1 = buildParagraph(15); // 1 line
    const para2: RenderNode = {
      type: "element" as const,
      key: "p2",
      style: { display: "block", breakBefore: "page" },
      children: [
        {
          type: "text" as const,
          key: "t2",
          style: {},
          text: "word ".repeat(15).trim(),
        },
      ],
    };
    const root = buildDocumentRoot([para1, para2]);
    const result = paginatedHarness(root, PAGE);
    // break-before: page forces para2 onto a new page regardless of remaining space.
    expect(result.pages).toHaveLength(2);
  });

  it("empty document produces one blank page", () => {
    const root = buildDocumentRoot([]);
    const result = paginatedHarness(root, PAGE);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].children).toHaveLength(0);
  });

  it("honors widows constraint", () => {
    // 14-line paragraph. Page fits 12 lines.
    // With widows=5: second page must have at least 5 lines.
    const para: RenderNode = {
      type: "element" as const,
      key: "p",
      style: { display: "block", widows: 5 },
      children: [
        {
          type: "text" as const,
          key: "t",
          style: {},
          text: "word ".repeat(14 * 15).trim(),
        },
      ],
    };
    const root = buildDocumentRoot([para]);
    const result = paginatedHarness(root, PAGE);
    // Total lines must be 14 regardless of distribution.
    const totalLines = result.pages.reduce((sum, p) => sum + countLinesIn(p), 0);
    expect(totalLines).toBe(14);
    // Content must be split across pages.
    expect(result.pages.length).toBeGreaterThanOrEqual(2);
    if (result.pages.length >= 2) {
      // With widows=5, second page must have at least 5 lines.
      const p1Lines = countLinesIn(result.pages[1]);
      expect(p1Lines).toBeGreaterThanOrEqual(5);
    }
  });
});
