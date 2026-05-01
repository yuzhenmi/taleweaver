import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "../state/create-node";
import { renderTree } from "../render/render";
import { cascadePass } from "../cascade";
import { layoutTree } from "../layout/dispatch";
import { createMockShaper } from "../layout/mock-shaper";
import { createRegistry, defaultComponents } from "../components";
import { resolvePixelPosition } from "../editor/cursor-position";
import { computeSelectionRects } from "../editor/selection-geometry";
import { createPosition, createSpan } from "../state/position";
import type { PageConfig } from "../layout/page-config";
import type { StateNode } from "../state/state-node";
import type { LayoutBox } from "../layout/layout-node";

const PAGE_CONFIG: PageConfig = {
  pageInlineSize: 800,
  pageBlockSize: 500,
  pageMargins: { blockStart: 50, blockEnd: 50, inlineStart: 50, inlineEnd: 50 },
  pageGap: 20,
};

// Page content height = 500 - 50 - 50 = 400px. Line height = 16px. Lines per page = 25.
// With 50 single-line paragraphs: page 0 = paragraphs 0-24, page 1 = paragraphs 25-49.

const shaper = createMockShaper(8, 16);

function buildFixture(): { state: StateNode; layout: LayoutBox } {
  const reg = createRegistry([...defaultComponents]);
  const paragraphs: StateNode[] = [];
  for (let i = 0; i < 50; i++) {
    const t = createTextNode(`text-${i}`, `Line ${i}`);
    paragraphs.push(createNode(`p-${i}`, "paragraph", {}, [t]));
  }
  const doc = createNode("doc", "document", {}, paragraphs);

  const layout = layoutTree(
    cascadePass(renderTree(doc, reg)),
    800,
    shaper,
    PAGE_CONFIG,
  );

  return { state: doc, layout };
}

describe("paginated cursor / selection geometry", () => {
  it("resolvePixelPosition returns page-relative y and correct pageIndex on page 2", () => {
    const { state, layout } = buildFixture();

    if (layout.type !== "block") throw new Error("expected block root");
    expect(layout.children.length).toBeGreaterThan(1);

    // Paragraph 30 is on page 1 (0-indexed). Path is [30, 0] (doc → para 30 → text node).
    const pos = createPosition([30, 0], 0);
    const pixel = resolvePixelPosition(state, pos, layout, shaper);

    expect(pixel.pageIndex).toBe(1);
    expect(pixel.y).toBeGreaterThanOrEqual(0);
    expect(pixel.y).toBeLessThan(PAGE_CONFIG.pageBlockSize);
    expect(pixel.x).toBeGreaterThanOrEqual(0);
  });

  it("computeSelectionRects returns rects with the correct pageIndex per page", () => {
    const { state, layout } = buildFixture();

    // Span paragraphs 28..32 — all on page 1.
    const span = createSpan(
      createPosition([28, 0], 0),
      createPosition([32, 0], 0),
    );
    const rects = computeSelectionRects(state, span, layout, shaper, 800);
    expect(rects.length).toBeGreaterThan(0);
    for (const rect of rects) {
      expect(rect.pageIndex).toBe(1);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeLessThan(PAGE_CONFIG.pageBlockSize);
    }
  });
});
