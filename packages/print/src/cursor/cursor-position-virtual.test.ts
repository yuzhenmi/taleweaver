// packages/core/src/cursor/cursor-position-virtual.test.ts
//
// Virtualized-layout Phase 3, Task 3. `resolvePixelPosition` must accept a
// `VirtualLayoutTree` and resolve the caret by materializing only the cursor's
// page (+ a neighbor at the cross-page soft-wrap edge) — never the whole
// document. The assembled-positioned-tree path is the ORACLE: the
// virtual path must return the SAME PixelPosition.
//
// Design: docs/superpowers/specs/2026-05-24-virtualized-layout-design.md
// Plan:   docs/superpowers/plans/2026-05-24-virtualized-layout-phase3.md

import { describe, it, expect, beforeEach } from "vitest";
import { resolvePixelPosition } from "./cursor-position";
import { render } from "@taleweaver/core";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import { layoutTree } from "../layout/dispatch";
import { positionTreeForTest } from "../test-utils/position-tree";
import { getLineIndex } from "./line-flatten";
import { createMockShaper } from "@taleweaver/core";
import type { TextShaper } from "@taleweaver/core";
import type { PageConfig } from "../layout/page-config";
import type { VirtualLayoutTree } from "../layout/virtual-layout-tree";
import {
  __getGetPageDriverCountForTest,
  __resetGetPageDriverCountForTest,
} from "../layout/virtual-layout-tree";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
} from "@taleweaver/core";
import { createPosition, getBlock, inlineContentLength } from "@taleweaver/core";
import type { BlockId, State } from "@taleweaver/core";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const SHAPER_CHAR_W = 8;
const SHAPER_LINE_H = 16;

/**
 * Page config: small content area so a multi-line paragraph spans pages. With
 * no margins, the content block-size == pageBlockSize. At 16px line-height a
 * 96px page holds 6 lines.
 */
function pageConfig(pageBlockSize = 96, pageInlineSize = 320, pageGap = 24): PageConfig {
  return {
    pageInlineSize,
    pageBlockSize,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap,
  };
}

interface Built {
  state: State;
  virtual: VirtualLayoutTree;
  shaper: TextShaper;
}

/**
 * Build a flat document of `paragraphTexts.length` paragraphs under the doc
 * root and lay it out paginated. Returns the UNMATERIALIZED virtual tree (so
 * driver-count tests measure cold queries). Callers that want the oracle call
 * `positionTreeForTest(built.virtual)` themselves.
 */
function buildDoc(paragraphTexts: readonly string[], cfg: PageConfig): Built {
  const blockIds = paragraphTexts.map((_, i) => `p${i}`);
  const state = buildState({
    rootId: "doc",
    blocks: [
      buildBlock({
        id: "doc",
        type: "document",
        firstChildId: blockIds[0],
        lastChildId: blockIds[blockIds.length - 1],
      }),
      ...paragraphTexts.map((t, i) =>
        buildBlock({
          id: nth(blockIds, i, "blockId"),
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: i > 0 ? blockIds[i - 1] : undefined,
          nextSiblingId: i < blockIds.length - 1 ? blockIds[i + 1] : undefined,
          inlineContent: inlineContent([text(t)]),
        }),
      ),
    ],
  });
  const root = render(
    state,
    createDefaultComponentRegistry(),
    createDefaultAttrRegistry(),
  ).root;
  const shaper = createMockShaper(SHAPER_CHAR_W, SHAPER_LINE_H);
  const lt = layoutTree(root, cfg.pageInlineSize, shaper, cfg);
  if (lt.type !== "virtual-root") {
    throw new Error("expected a VirtualLayoutTree (paginated supported doc)");
  }
  return { state, virtual: lt, shaper };
}

/**
 * A single paragraph whose text wraps across several pages. The mock shaper
 * wraps at the page inline-size (320px / 8px = 40 chars/line) ONLY at break
 * opportunities, so the text is space-separated words to create them.
 */
function buildSpanningParagraph(numChars: number, cfg: PageConfig): Built {
  // "word word word ..." — short words give frequent break opportunities so the
  // run wraps cleanly. numChars chars => ~numChars/40 lines; at 6 lines/page
  // that spans several pages.
  const words: string[] = [];
  let len = 0;
  while (len < numChars) {
    words.push("xxxx");
    len += 5; // "xxxx" + space
  }
  return buildDoc([words.join(" ")], cfg);
}

beforeEach(() => {
  __resetGetPageDriverCountForTest();
});

describe("resolvePixelPosition (virtual tree) — oracle equivalence", () => {
  it("flat multi-page doc: every paragraph's caret matches the materialized path", () => {
    // 20 short paragraphs of one line each. At 6 lines/page (no inter-block
    // margin in the mock pipeline) this spans multiple pages.
    const texts = Array.from({ length: 20 }, (_, i) => `para ${i} hello`);
    const cfg = pageConfig();
    const { state, virtual, shaper } = buildDoc(texts, cfg);
    const positioned = positionTreeForTest(virtual);
    expect(virtual.plan.entries.length).toBeGreaterThan(1);

    for (let i = 0; i < texts.length; i++) {
      const blockId = `p${i}` as BlockId;
      for (const offset of [0, 3, nth(texts, i, "text").length]) {
        const pos = createPosition(blockId, offset);
        const got = resolvePixelPosition(state, pos, virtual, shaper);
        const oracle = resolvePixelPosition(state, pos, positioned, shaper);
        expect(got, `p${i} offset ${offset}`).toEqual(oracle);
      }
    }
  });

  it("spanning paragraph: caret at offsets across all pages matches the oracle", () => {
    const cfg = pageConfig();
    const { state, virtual, shaper } = buildSpanningParagraph(600, cfg);
    const positioned = positionTreeForTest(virtual);
    expect(virtual.plan.entries.length).toBeGreaterThan(2);

    // The paragraph's total inline length (offsets are state-model offsets).
    const blk = getBlock(state, "p0" as BlockId);
    const total = blk?.inlineContent ? inlineContentLength(blk.inlineContent) : 0;
    // Sample offsets spread across the whole paragraph (start, interiors, end).
    for (const offset of [0, 1, 40, 41, 200, Math.floor(total / 2), total - 1, total]) {
      const pos = createPosition("p0" as BlockId, offset);
      const got = resolvePixelPosition(state, pos, virtual, shaper);
      const oracle = resolvePixelPosition(state, pos, positioned, shaper);
      expect(got, `offset ${offset}`).toEqual(oracle);
    }
  });
});

describe("resolvePixelPosition (virtual tree) — cross-page soft-wrap edge", () => {
  it("offset at the soft-wrap end of a page's last line snaps to the next page's first line", () => {
    const cfg = pageConfig();
    const { state, virtual, shaper } = buildSpanningParagraph(600, cfg);
    const positioned = positionTreeForTest(virtual);

    // Find a page boundary: the offset that is the inlineOffsetEnd of some
    // page's last own-line AND the inlineOffsetStart of the next page's first
    // own-line. The oracle (doc-wide soft-wrap preference) snaps the caret onto
    // the next visual line — which is on the NEXT page. The virtual path must
    // agree (and must NOT pin it to the bottom of the earlier page).
    const page0 = virtual.getPage(0);
    const page1 = virtual.getPage(1);
    const p0Lines = getLineIndex(page0).byBlock.get("p0" as BlockId) ?? [];
    const p1Lines = getLineIndex(page1).byBlock.get("p0" as BlockId) ?? [];
    expect(p0Lines.length).toBeGreaterThan(0);
    expect(p1Lines.length).toBeGreaterThan(0);

    const boundaryOffset = nth(p0Lines, p0Lines.length - 1, "p0 last line").line.inlineOffsetEnd;
    expect(nth(p1Lines, 0, "p1 first line").line.inlineOffsetStart).toBe(boundaryOffset);

    const pos = createPosition("p0" as BlockId, boundaryOffset);
    const got = resolvePixelPosition(state, pos, virtual, shaper);
    const oracle = resolvePixelPosition(state, pos, positioned, shaper);
    expect(got).not.toBeNull();
    if (got === null) return;
    // The caret lands on page 1, not page 0.
    expect(got.pageIndex).toBe(1);
    // And it equals the oracle exactly.
    expect(got).toEqual(oracle);
  });

  it("caretAffinity 'before' pins the caret to page N's last line (cross-page #474 B2)", () => {
    const cfg = pageConfig();
    const { state, virtual, shaper } = buildSpanningParagraph(600, cfg);

    const page0 = virtual.getPage(0);
    const page1 = virtual.getPage(1);
    const p0Lines = getLineIndex(page0).byBlock.get("p0" as BlockId) ?? [];
    const p1Lines = getLineIndex(page1).byBlock.get("p0" as BlockId) ?? [];
    expect(p0Lines.length).toBeGreaterThan(0);
    expect(p1Lines.length).toBeGreaterThan(0);
    const boundaryOffset = nth(p0Lines, p0Lines.length - 1, "p0 last line").line.inlineOffsetEnd;
    expect(nth(p1Lines, 0, "p1 first line").line.inlineOffsetStart).toBe(boundaryOffset);

    const pos = createPosition("p0" as BlockId, boundaryOffset);
    // Default snaps to page 1 (above). "before" must stay on page 0's last line.
    const before = resolvePixelPosition(state, pos, virtual, shaper, undefined, "before");
    expect(before).not.toBeNull();
    if (before === null) return;
    expect(before.pageIndex).toBe(0);
    // Pin it to page 0's LAST line specifically (not just "some line on page 0"):
    // y equals the bottom-most own-line's absoluteY (page 0 → page-relative == absolute).
    expect(before.y).toBe(nth(p0Lines, p0Lines.length - 1, "p0 last line").absoluteY);
  });
});

describe("resolvePixelPosition (virtual tree) — materializes only the cursor page", () => {
  it("a caret on a single-page block positions exactly ONE page (not all)", () => {
    const texts = Array.from({ length: 30 }, (_, i) => `para ${i}`);
    const cfg = pageConfig();
    const { state, virtual, shaper } = buildDoc(texts, cfg);
    const totalPages = virtual.plan.entries.length;
    expect(totalPages).toBeGreaterThan(3);

    // Caret on a block well into the document (not page 0).
    const lastBlock = `p${texts.length - 1}` as BlockId;
    const targetPage = virtual.plan.pageIndexOfBlock(lastBlock);
    expect(targetPage).toBeGreaterThan(0);

    __resetGetPageDriverCountForTest();
    const pos = createPosition(lastBlock, 2);
    const got = resolvePixelPosition(state, pos, virtual, shaper);
    expect(got).not.toBeNull();

    // Exactly one per-page layoutBlock driver call — page `targetPage` only.
    // NOT `totalPages` (which positioning the whole document would drive).
    expect(__getGetPageDriverCountForTest()).toBe(1);
    expect(__getGetPageDriverCountForTest()).toBeLessThan(totalPages);
  });

  it("a caret on a block whose FIRST page is N>0 materializes only the block's own page(s) — never pages 0..N-1", () => {
    // ~10 short single-line paragraphs. At 6 lines/page (no inter-block margin
    // in the mock pipeline) page 0 holds the first 6 paragraphs and page 1 holds
    // the rest, so the LAST paragraph's FIRST page is page 1 (NOT page 0). This
    // is the gap that hid the backward-walk-floor blocker: with the floor at
    // page 0 (the document start), a caret at offset 0 on this paragraph would
    // decrement off the block's own page onto page 0 — materializing an
    // unrelated page (perf) and risking resolution against a different block's
    // offset-0 line (correctness). The floor at the block's first page prevents
    // both.
    const texts = Array.from({ length: 10 }, (_, i) => `para ${i}`);
    const cfg = pageConfig();
    const lastBlock = `p${texts.length - 1}` as BlockId;
    const lastOffset = nth(texts, texts.length - 1, "text").length;

    // (1) Oracle-equivalence: build a tree, materialize it for the oracle, and
    // assert the virtual path deep-equals the positioned-tree oracle for BOTH
    // offset 0 and an interior offset on the off-page-0 block.
    {
      const { state, virtual, shaper } = buildDoc(texts, cfg);
      const positioned = positionTreeForTest(virtual);
      expect(virtual.plan.entries.length).toBeGreaterThan(1);

      // The block's whole-block-progress (last) page AND its first page are both
      // page 1+ — it's a single-line block, so first === last and both are > 0.
      const span = virtual.plan.pageSpanOfBlock(lastBlock);
      expect(span).not.toBeNull();
      if (span === null) return;
      expect(span.first).toBeGreaterThan(0);
      expect(span.last).toBe(span.first);
      expect(virtual.plan.pageIndexOfBlock(lastBlock)).toBe(span.last);

      for (const offset of [0, lastOffset]) {
        const pos = createPosition(lastBlock, offset);
        const got = resolvePixelPosition(state, pos, virtual, shaper);
        const oracle = resolvePixelPosition(state, pos, positioned, shaper);
        expect(got, `offset ${offset}`).toEqual(oracle);
      }
    }

    // (2) Driver-count: on a FRESH unmaterialized tree (the oracle above
    // populated its memo, so counting there would read 0), a caret at offset 0
    // AND at an interior offset must drive layout for exactly the block's own
    // page(s) — here ONE — never pages 0..N-1. A floor-at-0 backward walk would
    // have materialized `span.first` extra pages.
    for (const offset of [0, lastOffset]) {
      const fresh = buildDoc(texts, cfg);
      const span = fresh.virtual.plan.pageSpanOfBlock(lastBlock);
      expect(span).not.toBeNull();
      if (span === null) return;
      const ownPageCount = span.last - span.first + 1;

      __resetGetPageDriverCountForTest();
      const pos = createPosition(lastBlock, offset);
      const got = resolvePixelPosition(fresh.state, pos, fresh.virtual, fresh.shaper);
      expect(got).not.toBeNull();
      // Exactly the block's own page span — and strictly fewer than the
      // `span.first` pages 0..N-1 a floor-at-0 walk would have materialized.
      expect(__getGetPageDriverCountForTest(), `offset ${offset} driver count`).toBe(ownPageCount);
      expect(__getGetPageDriverCountForTest()).toBeLessThanOrEqual(span.first);
    }
  });

  it("a multi-page-spanning block resolves a near-end caret by materializing few pages (NOT all)", () => {
    // pageIndexOfBlock returns the block's LAST page; the back-walk stops at the
    // first page whose own-lines start at/before the offset. For a caret near
    // the block's END, that's the last page (or one before) — materializing far
    // fewer pages than positioning the whole document would. (A caret near the block's START
    // of a long paragraph materializes more, bounded by the block's page-span,
    // never the document — but that is off the typing/Enter hot path.)
    const cfg = pageConfig();
    const totalSpan = buildSpanningParagraph(600, cfg).virtual.plan.entries.length;
    expect(totalSpan).toBeGreaterThan(2);

    const fresh = buildSpanningParagraph(600, cfg);
    __resetGetPageDriverCountForTest();
    // Offset near the END of the paragraph (last page).
    const pos = createPosition("p0" as BlockId, 595);
    const got = resolvePixelPosition(fresh.state, pos, fresh.virtual, fresh.shaper);
    expect(got).not.toBeNull();
    // The back-walk starts at the last page and the offset is on it ⇒ 1 page.
    expect(__getGetPageDriverCountForTest()).toBe(1);
    expect(__getGetPageDriverCountForTest()).toBeLessThan(totalSpan);
  });
});
