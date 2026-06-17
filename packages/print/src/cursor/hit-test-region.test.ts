// packages/core/src/cursor/hit-test-region.test.ts
//
// #331: clicking the body's empty TAIL (below the last body line, above the
// footer band) must clamp to the END OF THE BODY, NOT jump into the footer.
//
// Google Docs convention: a click in the footer BAND → footer; a click anywhere
// else — including the empty body tail above the footer — → the body (resolves
// to the nearest body line). Symmetrically, a click in the header band → header.
//
// Root cause: since C.2c T6 the per-page flat line index is
// [header lines, body lines, footer lines] in ascending-y order. `resolvePosition-
// FromPixel` step 3 picks the FIRST line whose bottom is below the click y. For a
// body-tail click that loop walks past the body lines and lands on the FOOTER
// line. The fix partitions the scanned lines into geometric BANDS by the click y.
//
// These tests build the fixture through the VIRTUAL path (same builder shape as
// line-navigation-context.test.ts): render → cascadePass → buildBlockFitMetas →
// measurePass → planWithEntries stamping headerBlockId/footerBlockId on page 0 →
// makeVirtualLayoutTree(..., cascadedTemplateContents) → assembled positioned tree.

import { describe, it, expect, beforeEach } from "vitest";
import { resolveHitPosition as resolvePositionFromPixel } from "../test-utils/hit-position";
import { getLineIndex } from "./line-flatten";
import { render } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import { buildBlockFitMetas } from "../layout/build-fit-metas";
import { measurePass, type PagePlan, type PagePlanEntry } from "../layout/measure-pass";
import { IMPLICIT_SECTION_PLAN } from "../layout/section-plan";
import { makeRootContext } from "../layout/layout-context";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { createMockShaper } from "@taleweaver/core";
import {
  makeVirtualLayoutTree,
  __resetGetPageDriverCountForTest,
} from "../layout/virtual-layout-tree";
import { positionTreeForTest } from "../test-utils/position-tree";
import type { ElementBox, RenderNode } from "@taleweaver/core";
import type { TextShaper } from "@taleweaver/core";
import type { PageConfig } from "../layout/page-config";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
} from "@taleweaver/core";
import { resolveBlock, selectionContextOf } from "@taleweaver/core";
import type { State, BlockId } from "@taleweaver/core";
import type { LayoutBox } from "../layout/layout-node";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const SHAPER_CHAR_W = 8;
const SHAPER_LINE_H = 16;

// CONTAINER body roots (parentId null) per #326; their paragraph CHILDREN carry
// the inline content / lines.
const HEADER_ROOT = "hdr-root" as BlockId;
const HEADER_P1 = "hdr-p1" as BlockId;
const FOOTER_ROOT = "ftr-root" as BlockId;
const FOOTER_P1 = "ftr-p1" as BlockId;

// A TALL page so a SHORT body (2-3 short paragraphs) leaves a visible GAP between
// the last body line and the footer band on page 0. The footer slot is laid into
// the bottom margin band, well below the body content.
function pageConfig(): PageConfig {
  return {
    pageInlineSize: 320,
    pageBlockSize: 400,
    pageMargins: { blockStart: 60, blockEnd: 60, inlineStart: 0, inlineEnd: 0 },
    pageGap: 24,
  };
}

interface Built {
  state: State;
  positioned: LayoutBox;
  shaper: TextShaper;
}

/**
 * Build a SINGLE-PAGE document with a SHORT multi-paragraph body, optionally a
 * header CONTAINER body and/or a footer CONTAINER body. Lay it out paginated, tag
 * page 0's plan entry with the header/footer container ids so the slots are
 * materialized, and return a positioned snapshot.
 */
function buildDoc(opts: {
  bodyParas: string[];
  headerPara?: string;
  footerPara?: string;
}): Built {
  const templateBlocks = [];
  if (opts.headerPara !== undefined) {
    templateBlocks.push(
      buildBlock({
        id: HEADER_ROOT,
        type: "template-body",
        firstChildId: HEADER_P1,
        lastChildId: HEADER_P1,
      }),
      buildBlock({
        id: HEADER_P1,
        type: "paragraph",
        parentId: HEADER_ROOT,
        inlineContent: inlineContent([text(opts.headerPara)]),
      }),
    );
  }
  if (opts.footerPara !== undefined) {
    templateBlocks.push(
      buildBlock({
        id: FOOTER_ROOT,
        type: "template-body",
        firstChildId: FOOTER_P1,
        lastChildId: FOOTER_P1,
      }),
      buildBlock({
        id: FOOTER_P1,
        type: "paragraph",
        parentId: FOOTER_ROOT,
        inlineContent: inlineContent([text(opts.footerPara)]),
      }),
    );
  }

  // Body: a document root holding paragraph children.
  const bodyBlocks = opts.bodyParas.map((t, i) => {
    const id = `bp${i}`;
    return buildBlock({
      id,
      type: "paragraph",
      parentId: "doc",
      prevSiblingId: i === 0 ? null : `bp${i - 1}`,
      nextSiblingId: i === opts.bodyParas.length - 1 ? null : `bp${i + 1}`,
      inlineContent: inlineContent([text(t)]),
    });
  });
  const state = buildState({
    rootId: "doc",
    blocks: [
      buildBlock({
        id: "doc",
        type: "document",
        firstChildId: "bp0",
        lastChildId: `bp${opts.bodyParas.length - 1}`,
      }),
      ...bodyBlocks,
    ],
    templateContents: templateBlocks,
  });

  const out = render(state, createDefaultComponentRegistry(), createDefaultAttrRegistry());
  const cascadedRoot = cascadePass(out.root);
  if (cascadedRoot.type !== "element") throw new Error("root cascade not element");

  const cascadedTemplateContents = new Map<BlockId, ElementBox>();
  for (const [id, node] of out.templateContents) {
    const c = cascadePass(node as RenderNode);
    if (c.type === "element") cascadedTemplateContents.set(id, c);
  }

  const cfg = pageConfig();
  const shaper = createMockShaper(SHAPER_CHAR_W, SHAPER_LINE_H);
  const pcis = cfg.pageInlineSize - cfg.pageMargins.inlineStart - cfg.pageMargins.inlineEnd;
  const metas = buildBlockFitMetas(cascadedRoot, shaper, undefined, pcis);
  const basePlan = measurePass(metas, cfg, IMPLICIT_SECTION_PLAN, cascadedRoot.children);
  const plan = planWithEntries(basePlan, (e) =>
    e.pageIndex === 0
      ? {
          ...e,
          ...(opts.headerPara !== undefined ? { headerBlockId: HEADER_ROOT } : {}),
          ...(opts.footerPara !== undefined ? { footerBlockId: FOOTER_ROOT } : {}),
        }
      : e,
  );

  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, cfg.pageInlineSize);
  const virtual = makeVirtualLayoutTree(
    plan, cascadedRoot, ctx, shaper, cfg, undefined, cascadedTemplateContents,
  );
  const positioned = positionTreeForTest(virtual);
  return { state, positioned, shaper };
}

/** Rebuild a PagePlan from base entries, overriding per-entry fields. */
function planWithEntries(
  base: PagePlan,
  override: (entry: PagePlanEntry) => PagePlanEntry,
): PagePlan {
  let running = 0;
  const entries: PagePlanEntry[] = base.entries.map((e) => {
    const o = override(e);
    const withOffset: PagePlanEntry = {
      ...o,
      blockOffset: running,
      blockSize: o.pageConfig.pageBlockSize,
    };
    running += o.pageConfig.pageBlockSize + o.pageConfig.pageGap;
    return withOffset;
  });
  const last = entries[entries.length - 1];
  const totalBlockSize = last === undefined ? 0 : last.blockOffset + last.pageConfig.pageBlockSize;
  const templateBlockToPage = new Map<string, number>();
  for (const e of entries) {
    if (e.headerBlockId !== undefined && !templateBlockToPage.has(e.headerBlockId)) {
      templateBlockToPage.set(e.headerBlockId, e.pageIndex);
    }
    if (e.footerBlockId !== undefined && !templateBlockToPage.has(e.footerBlockId)) {
      templateBlockToPage.set(e.footerBlockId, e.pageIndex);
    }
  }
  return {
    entries,
    sectionPlan: base.sectionPlan,
    totalBlockSize,
    pageInlineSize: base.pageInlineSize,
    pageContentBlockSize: base.pageContentBlockSize,
    pageIndexAtBlockOffset: base.pageIndexAtBlockOffset.bind(base),
    pageIndexOfBlock: base.pageIndexOfBlock.bind(base),
    pageSpanOfBlock: base.pageSpanOfBlock.bind(base),
    pageIndexOfTemplateBlock: (blockId) => templateBlockToPage.get(blockId) ?? -1,
    pageIndexOfFootnoteBlock: () => -1,
  };
}

/**
 * Locate page 0's PageBox in a positioned tree and read its content-area edges
 * (#332). `positioned` is the assembled BlockBox whose children are
 * PageBoxes; scan for pageIndex 0. The body content area is page-local
 * [effectiveTopInset, blockSize − effectiveBottomInset]; the margins outside
 * that band are the header/footer zones.
 */
function pageContentEdges(positioned: LayoutBox): {
  contentTop: number;
  contentBottom: number;
  blockSize: number;
} {
  const root = positioned;
  const children = root.type === "block" ? root.children : [];
  for (const c of children) {
    if (c.type === "page" && c.pageIndex === 0) {
      return {
        contentTop: c.effectiveTopInset,
        contentBottom: c.blockSize - c.effectiveBottomInset,
        blockSize: c.blockSize,
      };
    }
  }
  throw new Error("pageContentEdges: page 0 not found in positioned tree");
}

/** Geometry helper: the body band's bottom and the footer band's top on page 0. */
function bodyAndFooterGeometry(state: State, positioned: LayoutBox) {
  const idx = getLineIndex(positioned);
  const all = idx.all;
  const bodyLines = all.filter(
    (l) => selectionContextOf(state, l.line.ownerBlockId) === state.rootId,
  );
  const footerLines = all.filter(
    (l) => selectionContextOf(state, l.line.ownerBlockId) === FOOTER_ROOT,
  );
  const headerLines = all.filter(
    (l) => selectionContextOf(state, l.line.ownerBlockId) === HEADER_ROOT,
  );
  const bodyMaxBottom = Math.max(...bodyLines.map((l) => l.absoluteY + l.line.blockSize));
  const bodyMinY = Math.min(...bodyLines.map((l) => l.absoluteY));
  const footerTop = footerLines.length > 0
    ? Math.min(...footerLines.map((l) => l.absoluteY))
    : Infinity;
  const headerBottom = headerLines.length > 0
    ? Math.max(...headerLines.map((l) => l.absoluteY + l.line.blockSize))
    : -Infinity;
  return { bodyLines, footerLines, headerLines, bodyMaxBottom, bodyMinY, footerTop, headerBottom };
}

beforeEach(() => {
  __resetGetPageDriverCountForTest();
});

describe("#331 — body-tail click clamps to body, footer band enters footer", () => {
  it("precondition: there is a GAP between the last body line and the footer band", () => {
    const { state, positioned } = buildDoc({
      bodyParas: ["body one", "body two"],
      footerPara: "the footer",
    });
    const g = bodyAndFooterGeometry(state, positioned);
    expect(g.bodyLines.length).toBe(2);
    expect(g.footerLines.length).toBe(1);
    // The footer band must sit strictly BELOW the body's bottom with a visible gap.
    expect(g.footerTop).toBeGreaterThan(g.bodyMaxBottom + 1);
  });

  it("CASE 1 (THE BUG): body-tail click → END of the LAST body block (NOT the footer)", () => {
    const lastBodyText = "body two";
    const { state, positioned, shaper } = buildDoc({
      bodyParas: ["body one", lastBodyText],
      footerPara: "the footer",
    });
    const g = bodyAndFooterGeometry(state, positioned);
    // A y strictly between the last body line's bottom and the footer band's top.
    const y = (g.bodyMaxBottom + g.footerTop) / 2;
    expect(y).toBeGreaterThan(g.bodyMaxBottom);
    expect(y).toBeLessThan(g.footerTop);

    // Click in the tail, x far past the end of the line.
    const pos = resolvePositionFromPixel(state, positioned, shaper, 1000, y, 0);
    expect(pos).not.toBeNull();
    if (pos === null) return;

    // Must be the LAST body block — a MAIN body block (resolveBlock kind "block").
    const resolved = resolveBlock(state, pos.blockId);
    expect(resolved).not.toBeNull();
    if (resolved === null) return;
    expect(resolved.kind).toBe("block");
    expect(pos.blockId).toBe("bp1");
    // It must NOT be the footer block.
    expect(pos.blockId).not.toBe(FOOTER_P1);
    // End offset = the last body block's inlineContent length.
    expect(pos.offset).toBe(lastBodyText.length);
  });

  it("CASE 2: footer-band click → the footer body block (footer stays reachable)", () => {
    const { state, positioned, shaper } = buildDoc({
      bodyParas: ["body one", "body two"],
      footerPara: "the footer",
    });
    const g = bodyAndFooterGeometry(state, positioned);
    const footer = nth(g.footerLines, 0, "footer line");
    // y within the footer line's band; x over the footer text (a few chars in).
    const y = footer.absoluteY + footer.line.blockSize / 2;
    const x = footer.absoluteX + SHAPER_CHAR_W * 2;
    const pos = resolvePositionFromPixel(state, positioned, shaper, x, y, 0);
    expect(pos).not.toBeNull();
    if (pos === null) return;
    const resolved = resolveBlock(state, pos.blockId);
    expect(resolved).not.toBeNull();
    if (resolved === null) return;
    expect(resolved.kind).toBe("templateContent");
    expect(pos.blockId).toBe(FOOTER_P1);
  });

  it("CASE 3: body-line click → that body line (no-regression)", () => {
    const { state, positioned, shaper } = buildDoc({
      bodyParas: ["body one", "body two"],
      footerPara: "the footer",
    });
    const g = bodyAndFooterGeometry(state, positioned);
    // Click squarely on the FIRST body line, 1 char in.
    const first = nth(g.bodyLines, 0, "body line");
    const y = first.absoluteY + first.line.blockSize / 2;
    const x = first.absoluteX + SHAPER_CHAR_W * 1 + 1; // mid-second-char region
    const pos = resolvePositionFromPixel(state, positioned, shaper, x, y, 0);
    expect(pos).not.toBeNull();
    if (pos === null) return;
    const resolved = resolveBlock(state, pos.blockId);
    expect(resolved).not.toBeNull();
    if (resolved === null) return;
    expect(resolved.kind).toBe("block");
    expect(pos.blockId).toBe("bp0");
    expect(pos.offset).toBe(1);
  });

  it("CASE 4 (header band): top-band click → header body block (NOT a body block)", () => {
    const { state, positioned, shaper } = buildDoc({
      bodyParas: ["body one", "body two"],
      headerPara: "the header",
      footerPara: "the footer",
    });
    const g = bodyAndFooterGeometry(state, positioned);
    expect(g.headerLines.length).toBe(1);
    const header = nth(g.headerLines, 0, "header line");
    // Sanity: header band sits ABOVE the body's first line.
    expect(g.headerBottom).toBeLessThanOrEqual(g.bodyMinY);
    // Click in the header band, over the header text.
    const y = header.absoluteY + header.line.blockSize / 2;
    const x = header.absoluteX + SHAPER_CHAR_W * 2;
    const pos = resolvePositionFromPixel(state, positioned, shaper, x, y, 0);
    expect(pos).not.toBeNull();
    if (pos === null) return;
    const resolved = resolveBlock(state, pos.blockId);
    expect(resolved).not.toBeNull();
    if (resolved === null) return;
    expect(resolved.kind).toBe("templateContent");
    expect(pos.blockId).toBe(HEADER_P1);
  });

  it("CASE 5 (no slots): body-tail click on a plain doc → last body line (unchanged)", () => {
    // No header/footer at all: the slotLines.length === 0 fast path must keep
    // byte-identical behavior — a click below the last body line snaps to it.
    const lastBodyText = "body two";
    const { state, positioned, shaper } = buildDoc({
      bodyParas: ["body one", lastBodyText],
    });
    const idx = getLineIndex(positioned);
    expect(idx.all.length).toBe(2); // both lines are body lines; no slots.
    const last = nth(idx.all, idx.all.length - 1, "line");
    // Click well below the last body line.
    const y = last.absoluteY + last.line.blockSize + 200;
    const pos = resolvePositionFromPixel(state, positioned, shaper, 1000, y, 0);
    expect(pos).not.toBeNull();
    if (pos === null) return;
    const resolved = resolveBlock(state, pos.blockId);
    expect(resolved).not.toBeNull();
    if (resolved === null) return;
    expect(resolved.kind).toBe("block");
    expect(pos.blockId).toBe("bp1");
    expect(pos.offset).toBe(lastBodyText.length);
  });
});

describe("#332 — full top/bottom MARGIN is the header/footer zone (not just slot text)", () => {
  it("precondition: a real GAP exists between the header text and the body content area", () => {
    const { state, positioned } = buildDoc({
      bodyParas: ["body one", "body two"],
      headerPara: "the header",
      footerPara: "the footer",
    });
    const g = bodyAndFooterGeometry(state, positioned);
    const edges = pageContentEdges(positioned);
    expect(g.headerLines.length).toBe(1);
    // The header text bottom is strictly ABOVE the body content-area top, with a
    // visible gap — this is the margin region the bug mis-classifies as body.
    expect(edges.contentTop).toBeGreaterThan(g.headerBottom + 1);
    // The body's first line sits at the content-area top (page-local origin).
    expect(g.bodyMinY).toBeGreaterThanOrEqual(edges.contentTop - 0.5);
  });

  it("CASE 1 (THE BUG): header-gap click (below header text, in the top margin) → header", () => {
    // y strictly in [maxHeaderLineBottom, contentTop): the empty top-margin band
    // below the header text. On the OLD line-extent band logic this falls through
    // to the BODY (RED). With the content-area edges it resolves to the HEADER.
    const { state, positioned, shaper } = buildDoc({
      bodyParas: ["body one", "body two"],
      headerPara: "the header",
      footerPara: "the footer",
    });
    const g = bodyAndFooterGeometry(state, positioned);
    const edges = pageContentEdges(positioned);
    const header = nth(g.headerLines, 0, "header line");
    // A y in the gap below the header text, above the body content area.
    const y = (g.headerBottom + edges.contentTop) / 2;
    expect(y).toBeGreaterThan(g.headerBottom);
    expect(y).toBeLessThan(edges.contentTop);
    // x over where the header TEXT is (so we'd land on the header line once the
    // region is correctly chosen).
    const x = header.absoluteX + SHAPER_CHAR_W * 2;

    const pos = resolvePositionFromPixel(state, positioned, shaper, x, y, 0);
    expect(pos).not.toBeNull();
    if (pos === null) return;
    const resolved = resolveBlock(state, pos.blockId);
    expect(resolved).not.toBeNull();
    if (resolved === null) return;
    // RED on the pre-#332 code: this resolves to a BODY block ("bp0", kind
    // "block"). GREEN: the header body block, kind "templateContent".
    expect(resolved.kind).toBe("templateContent");
    expect(pos.blockId).toBe(HEADER_P1);
  });

  it("CASE 2: header-text click → header (no-regression)", () => {
    const { state, positioned, shaper } = buildDoc({
      bodyParas: ["body one", "body two"],
      headerPara: "the header",
      footerPara: "the footer",
    });
    const g = bodyAndFooterGeometry(state, positioned);
    const header = nth(g.headerLines, 0, "header line");
    const y = header.absoluteY + header.line.blockSize / 2;
    const x = header.absoluteX + SHAPER_CHAR_W * 2;
    const pos = resolvePositionFromPixel(state, positioned, shaper, x, y, 0);
    expect(pos).not.toBeNull();
    if (pos === null) return;
    const resolved = resolveBlock(state, pos.blockId);
    expect(resolved).not.toBeNull();
    if (resolved === null) return;
    expect(resolved.kind).toBe("templateContent");
    expect(pos.blockId).toBe(HEADER_P1);
  });

  it("CASE 3: body empty-tail click → END of last body block (#331 preserved under new geometry)", () => {
    const lastBodyText = "body two";
    const { state, positioned, shaper } = buildDoc({
      bodyParas: ["body one", lastBodyText],
      headerPara: "the header",
      footerPara: "the footer",
    });
    const g = bodyAndFooterGeometry(state, positioned);
    const edges = pageContentEdges(positioned);
    // y below the last body line but still inside the body content area.
    const y = (g.bodyMaxBottom + edges.contentBottom) / 2;
    expect(y).toBeGreaterThan(g.bodyMaxBottom);
    expect(y).toBeLessThan(edges.contentBottom);
    const pos = resolvePositionFromPixel(state, positioned, shaper, 1000, y, 0);
    expect(pos).not.toBeNull();
    if (pos === null) return;
    const resolved = resolveBlock(state, pos.blockId);
    expect(resolved).not.toBeNull();
    if (resolved === null) return;
    expect(resolved.kind).toBe("block");
    expect(pos.blockId).toBe("bp1");
    expect(pos.offset).toBe(lastBodyText.length);
  });

  it("CASE 4: footer-band click BELOW the footer text → footer (full bottom margin is footer zone)", () => {
    const { state, positioned, shaper } = buildDoc({
      bodyParas: ["body one", "body two"],
      headerPara: "the header",
      footerPara: "the footer",
    });
    const g = bodyAndFooterGeometry(state, positioned);
    const edges = pageContentEdges(positioned);
    const footer = nth(g.footerLines, 0, "footer line");
    const footerBottom = footer.absoluteY + footer.line.blockSize;
    // y at/below contentBottom AND below the footer TEXT (the footer is shorter
    // than the bottom margin, so there's a gap below it that must still → footer).
    const y = Math.max(edges.contentBottom + 1, footerBottom + 1);
    expect(y).toBeGreaterThanOrEqual(edges.contentBottom);
    expect(y).toBeGreaterThan(footerBottom);
    expect(y).toBeLessThan(edges.blockSize);
    const x = footer.absoluteX + SHAPER_CHAR_W * 2;
    const pos = resolvePositionFromPixel(state, positioned, shaper, x, y, 0);
    expect(pos).not.toBeNull();
    if (pos === null) return;
    const resolved = resolveBlock(state, pos.blockId);
    expect(resolved).not.toBeNull();
    if (resolved === null) return;
    expect(resolved.kind).toBe("templateContent");
    expect(pos.blockId).toBe(FOOTER_P1);
  });

  it("CASE 5: body-line click → that body line (unchanged)", () => {
    const { state, positioned, shaper } = buildDoc({
      bodyParas: ["body one", "body two"],
      headerPara: "the header",
      footerPara: "the footer",
    });
    const g = bodyAndFooterGeometry(state, positioned);
    const first = nth(g.bodyLines, 0, "body line");
    const y = first.absoluteY + first.line.blockSize / 2;
    const x = first.absoluteX + SHAPER_CHAR_W * 1 + 1;
    const pos = resolvePositionFromPixel(state, positioned, shaper, x, y, 0);
    expect(pos).not.toBeNull();
    if (pos === null) return;
    const resolved = resolveBlock(state, pos.blockId);
    expect(resolved).not.toBeNull();
    if (resolved === null) return;
    expect(resolved.kind).toBe("block");
    expect(pos.blockId).toBe("bp0");
    expect(pos.offset).toBe(1);
  });

  it("CASE 6 (no-regression no-slot doc): body-tail click clamps to last line", () => {
    const lastBodyText = "body two";
    const { state, positioned, shaper } = buildDoc({
      bodyParas: ["body one", lastBodyText],
    });
    const idx = getLineIndex(positioned);
    expect(idx.all.length).toBe(2);
    const last = nth(idx.all, idx.all.length - 1, "line");
    const y = last.absoluteY + last.line.blockSize + 200;
    const pos = resolvePositionFromPixel(state, positioned, shaper, 1000, y, 0);
    expect(pos).not.toBeNull();
    if (pos === null) return;
    const resolved = resolveBlock(state, pos.blockId);
    expect(resolved).not.toBeNull();
    if (resolved === null) return;
    expect(resolved.kind).toBe("block");
    expect(pos.blockId).toBe("bp1");
    expect(pos.offset).toBe(lastBodyText.length);
  });
});
