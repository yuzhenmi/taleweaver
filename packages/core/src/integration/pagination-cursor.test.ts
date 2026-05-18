import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "../state/create-node-legacy";
import { renderTree } from "../render/render-legacy";
import { cascadePass } from "../cascade";
import { layoutTree } from "../layout/dispatch";
import { createMockShaper } from "../layout/mock-shaper";
import { createRegistry, defaultComponents } from "../components";
import { resolvePixelPosition } from "../editor/cursor-position-legacy";
import { computeSelectionRects } from "../editor/selection-geometry-legacy";
import { resolvePositionFromPixel } from "../editor/hit-test-legacy";
import { moveToLine } from "../editor/line-navigation-legacy";
import { createPosition, createSpan } from "../state/position";
import type { PageConfig } from "../layout/page-config";
import type { StateNode } from "../state/state-node-legacy";
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

// ─────────────────────────────────────────────────────────────────────────────
// Fixture: whole-block placement (50 single-line paragraphs).
// Page content height = 400px; each paragraph = 16px line + 8px bottom-margin
// = 24px. Floor(400/24) = 16 full paragraphs + para-16 at y=384 (just fits).
// Page 0 = p-0..p-16 (17 paragraphs), Page 1 = p-17..p-33, Page 2 = p-34..p-49.
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// G.2 — line navigation orders lines globally across pages (cross-page arrow-down)
// ─────────────────────────────────────────────────────────────────────────────

describe("pagination — arrow-down across page boundary (whole-block placement)", () => {
  it("moves cursor from end of last line on page 0 to start of first line on page 1", () => {
    const { state, layout } = buildFixture();
    // p-16 is the last paragraph on page 0 (path [16, 0], text "Line 16", 7 chars).
    const posAtEndOfPage0 = createPosition([16, 0], 7);
    const result = moveToLine(state, posAtEndOfPage0, layout, shaper, "down", null);
    expect(result).not.toBeNull();
    if (result === null) return;
    // Should land on p-17, the first paragraph on page 1.
    expect(result.position.path).toEqual([17, 0]);
    // resolvePixelPosition for the new position should report pageIndex 1.
    const pixel = resolvePixelPosition(state, result.position, layout, shaper);
    expect(pixel.pageIndex).toBe(1);
    expect(pixel.y).toBeGreaterThanOrEqual(0);
    expect(pixel.y).toBeLessThan(PAGE_CONFIG.pageBlockSize);
  });

  it("moves cursor from start of first line on page 1 back to end of last line on page 0", () => {
    const { state, layout } = buildFixture();
    // p-17 is the first paragraph on page 1.
    const posAtStartOfPage1 = createPosition([17, 0], 0);
    const result = moveToLine(state, posAtStartOfPage1, layout, shaper, "up", null);
    expect(result).not.toBeNull();
    if (result === null) return;
    // Should land somewhere on p-16 (page 0).
    expect(result.position.path).toEqual([16, 0]);
    const pixel = resolvePixelPosition(state, result.position, layout, shaper);
    expect(pixel.pageIndex).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G.2 — line navigation across page boundary with within-block fragmentation
// Fixture: 1 paragraph, 30 words "aaaaaaaaaa".
// charWidth=8, lineHeight=16. The narrow page (content area = 160px) forces
// 1 word per line: 10 chars × 8 = 80px < 160px; 2 words = 168px > 160px.
// Page content height = 400px → 25 lines/page.
// Page 0: lines 0-24 (words 0-24), Page 1: lines 25-29 (words 25-29).
// Word N starts at text offset N*11 (each word = 10 chars + 1 space).
// ─────────────────────────────────────────────────────────────────────────────

const NARROW_PAGE_CONFIG: PageConfig = {
  // pageInlineSize - margins.inlineStart - margins.inlineEnd = content area
  // 260 - 50 - 50 = 160 (matches the 1-word-per-line expectation)
  pageInlineSize: 260,
  pageBlockSize: 500,
  pageMargins: { blockStart: 50, blockEnd: 50, inlineStart: 50, inlineEnd: 50 },
  pageGap: 20,
};

function buildFragmentedParaFixture(): { state: StateNode; layout: LayoutBox } {
  const reg = createRegistry([...defaultComponents]);
  const words = Array.from({ length: 30 }, () => "aaaaaaaaaa");
  const text = words.join(" "); // 30 words × 10 chars + 29 spaces = 329 chars
  const t = createTextNode("txt", text);
  const p = createNode("para", "paragraph", {}, [t]);
  const doc = createNode("doc", "document", {}, [p]);
  const layout = layoutTree(
    cascadePass(renderTree(doc, reg)),
    NARROW_PAGE_CONFIG.pageInlineSize,
    shaper,
    NARROW_PAGE_CONFIG,
  );
  return { state: doc, layout };
}

describe("pagination — arrow-down across page boundary (within-block fragmentation)", () => {
  it("moves cursor from last line of page 0 to first line of page 1 in a fragmented paragraph", () => {
    const { state, layout } = buildFragmentedParaFixture();
    // Word 24 (last on page 0) starts at offset 24*11=264.
    // Position cursor at start of word 24 (offset 264).
    const posLastLineP0 = createPosition([0, 0], 264);
    const pixelBefore = resolvePixelPosition(state, posLastLineP0, layout, shaper);
    expect(pixelBefore.pageIndex).toBe(0);

    const result = moveToLine(state, posLastLineP0, layout, shaper, "down", null);
    expect(result).not.toBeNull();
    if (result === null) return;

    // New position should be on page 1.
    const pixelAfter = resolvePixelPosition(state, result.position, layout, shaper);
    expect(pixelAfter.pageIndex).toBe(1);
    expect(pixelAfter.y).toBeGreaterThanOrEqual(0);
    expect(pixelAfter.y).toBeLessThan(PAGE_CONFIG.pageBlockSize);
  });

  it("moves cursor from first line of page 1 back to last line of page 0 in a fragmented paragraph", () => {
    const { state, layout } = buildFragmentedParaFixture();
    // Word 25 (first on page 1) starts at offset 25*11=275.
    const posFirstLineP1 = createPosition([0, 0], 275);
    const pixelBefore = resolvePixelPosition(state, posFirstLineP1, layout, shaper);
    expect(pixelBefore.pageIndex).toBe(1);

    const result = moveToLine(state, posFirstLineP1, layout, shaper, "up", null);
    expect(result).not.toBeNull();
    if (result === null) return;

    // New position should be on page 0.
    const pixelAfter = resolvePixelPosition(state, result.position, layout, shaper);
    expect(pixelAfter.pageIndex).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G.3 — cursor resolution / selection / hit-test across fragmented paragraphs
// ─────────────────────────────────────────────────────────────────────────────

describe("pagination — cursor resolution across fragmented paragraph", () => {
  it("returns pageIndex=0 for cursor in the prefix half of a fragmented paragraph", () => {
    const { state, layout } = buildFragmentedParaFixture();
    // Word 0 is on page 0. Offset 0 = start of the paragraph.
    const pos = createPosition([0, 0], 0);
    const pixel = resolvePixelPosition(state, pos, layout, shaper);
    expect(pixel.pageIndex).toBe(0);
    expect(pixel.y).toBeGreaterThanOrEqual(0);
    expect(pixel.y).toBeLessThan(PAGE_CONFIG.pageBlockSize);
  });

  it("returns pageIndex=1 for cursor in the suffix half of a fragmented paragraph", () => {
    const { state, layout } = buildFragmentedParaFixture();
    // Word 25 is on page 1. Offset 275 = 25 * 11 chars.
    const pos = createPosition([0, 0], 275);
    const pixel = resolvePixelPosition(state, pos, layout, shaper);
    expect(pixel.pageIndex).toBe(1);
    expect(pixel.y).toBeGreaterThanOrEqual(0);
    expect(pixel.y).toBeLessThan(PAGE_CONFIG.pageBlockSize);
  });
});

describe("pagination — selection across page boundary", () => {
  it("emits per-line rects on both pages for a selection spanning the boundary (whole-block)", () => {
    const { state, layout } = buildFixture();
    // Selection from p-15 (page 0, y=360) to p-18 (page 1, y=24).
    // This spans the page boundary between p-16 (last on page 0) and p-17 (first on page 1).
    const span = createSpan(
      createPosition([15, 0], 0),
      createPosition([18, 0], 0),
    );
    const rects = computeSelectionRects(state, span, layout, shaper, 800);
    expect(rects.length).toBeGreaterThan(0);
    const page0Rects = rects.filter((r) => r.pageIndex === 0);
    const page1Rects = rects.filter((r) => r.pageIndex === 1);
    expect(page0Rects.length).toBeGreaterThan(0);
    expect(page1Rects.length).toBeGreaterThan(0);
    // All rects should have page-relative y within bounds.
    for (const r of rects) {
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeLessThan(PAGE_CONFIG.pageBlockSize);
    }
  });

  it("emits per-line rects on both pages for a selection spanning the boundary (within-block fragmentation)", () => {
    const { state, layout } = buildFragmentedParaFixture();
    // Selection from word 23 (page 0) to word 26 (page 1).
    // Word 23: offset 23*11=253; word 26: offset 26*11=286.
    const span = createSpan(
      createPosition([0, 0], 253),
      createPosition([0, 0], 286),
    );
    const rects = computeSelectionRects(state, span, layout, shaper, 160);
    expect(rects.length).toBeGreaterThan(0);
    const page0Rects = rects.filter((r) => r.pageIndex === 0);
    const page1Rects = rects.filter((r) => r.pageIndex === 1);
    expect(page0Rects.length).toBeGreaterThan(0);
    expect(page1Rects.length).toBeGreaterThan(0);
    for (const r of rects) {
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeLessThan(PAGE_CONFIG.pageBlockSize);
    }
  });
});

describe("pagination — hit-test on fragmented paragraph", () => {
  it("returns correct state-tree position when clicking a line on page 1 of a fragmented paragraph", () => {
    const { state, layout } = buildFragmentedParaFixture();
    // Page 1 contains words 25-29. Line 0 of page 1 (word 25) is at y=0.
    // Click at (x=0, y=0, pageIndex=1) should resolve to the start of word 25.
    // Word 25 starts at text offset 25*11=275.
    const pos = resolvePositionFromPixel(state, layout, shaper, 0, 0, 1);
    expect(pos).not.toBeNull();
    if (pos === null) return;
    expect(pos.path).toEqual([0, 0]);
    // Offset should be at or near the start of word 25 (offset 275).
    expect(pos.offset).toBeGreaterThanOrEqual(275);
    expect(pos.offset).toBeLessThan(286); // before word 26
  });

  it("returns correct state-tree position when clicking a line on page 0 of a fragmented paragraph", () => {
    const { state, layout } = buildFragmentedParaFixture();
    // Page 0, line 0 (word 0) at y=0. Click at (x=0, y=0, pageIndex=0).
    const pos = resolvePositionFromPixel(state, layout, shaper, 0, 0, 0);
    expect(pos).not.toBeNull();
    if (pos === null) return;
    expect(pos.path).toEqual([0, 0]);
    expect(pos.offset).toBe(0);
  });
});
