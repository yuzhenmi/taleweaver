// packages/core/src/cursor/hit-test-region-vertical.test.ts
//
// #438 — VERTICAL generalization of `pickRegionByBand` (the header/footer/
// footnote slot-zone classification in hit-test). For h-tb the zone edges
// (`contentTop`/`contentBottom`/`footnoteSlotTop`) are physical-Y quantities, so
// the click `y` compares against them directly. For the vertical modes the block
// axis is physical X (and `vertical-rl` MIRRORS it against the page block-size),
// so the click must be projected back to LOGICAL block-offset space before the
// zone comparisons. These tests build a vertical page that carries a header slot
// + a short body + a footer slot and assert that a click in each geometric zone
// resolves to that zone's editing context.
//
// The discriminating signature for vertical-rl is the MIRROR: the header margin
// (logical block-START) sits at HIGH physical X, the footer margin (logical
// block-END) at LOW physical X. An un-mirrored (h-tb-path) projection would
// classify these the wrong way round, so the v-rl assertions are RED against the
// pre-#438 code.
//
// The fixture reuses the virtual-layout pipeline from `hit-test-region.test.ts`,
// adding a `writingMode` so the root layout context + every block lay out
// vertically.

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
import type { WritingMode } from "@taleweaver/core";
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

const HEADER_ROOT = "hdr-root" as BlockId;
const HEADER_P1 = "hdr-p1" as BlockId;
const FOOTER_ROOT = "ftr-root" as BlockId;
const FOOTER_P1 = "ftr-p1" as BlockId;

// A page with a generous block-axis (1000) so the vertical-rl mirror lands the
// header (logical block-start) at a LARGE physical X and the footer at a SMALL
// physical X — making the mirror observable. The INLINE axis (physical Y) is wide
// enough to keep each short paragraph on one line.
//
// `inlineStart: 200` pushes ALL content (header/body/footer text) to a LARGE
// inline-axis (physical-Y) coordinate (~200), well INSIDE the block-axis content
// band `[blockStart=120, blockSize−blockEnd=880]`. So an h-tb-path implementation
// (which wrongly compares the click's physical Y against the BLOCK-axis edges)
// classifies EVERY click into the body zone — making the header/footer
// assertions RED. The correct block→logical projection reads the click's physical
// X, which lands in the right margin zone.
function pageConfig(): PageConfig {
  return {
    pageInlineSize: 400,
    pageBlockSize: 1000,
    pageMargins: { blockStart: 120, blockEnd: 120, inlineStart: 200, inlineEnd: 0 },
    pageGap: 24,
  };
}

interface Built {
  state: State;
  positioned: LayoutBox;
  shaper: TextShaper;
}

function buildDoc(opts: {
  wm: WritingMode;
  bodyParas: string[];
  headerPara?: string;
  footerPara?: string;
}): Built {
  const wm = opts.wm;
  const templateBlocks = [];
  if (opts.headerPara !== undefined) {
    templateBlocks.push(
      buildBlock({
        id: HEADER_ROOT,
        type: "template-body",
        attrs: { writingMode: wm },
        firstChildId: HEADER_P1,
        lastChildId: HEADER_P1,
      }),
      buildBlock({
        id: HEADER_P1,
        type: "paragraph",
        parentId: HEADER_ROOT,
        attrs: { writingMode: wm },
        inlineContent: inlineContent([text(opts.headerPara)]),
      }),
    );
  }
  if (opts.footerPara !== undefined) {
    templateBlocks.push(
      buildBlock({
        id: FOOTER_ROOT,
        type: "template-body",
        attrs: { writingMode: wm },
        firstChildId: FOOTER_P1,
        lastChildId: FOOTER_P1,
      }),
      buildBlock({
        id: FOOTER_P1,
        type: "paragraph",
        parentId: FOOTER_ROOT,
        attrs: { writingMode: wm },
        inlineContent: inlineContent([text(opts.footerPara)]),
      }),
    );
  }

  const bodyBlocks = opts.bodyParas.map((t, i) => {
    const id = `bp${i}`;
    return buildBlock({
      id,
      type: "paragraph",
      parentId: "doc",
      attrs: { writingMode: wm },
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
        attrs: { writingMode: wm },
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

  // Build the root layout context VERTICAL so the page frame + named slots lay
  // out (and physicalize) in the requested writing-mode.
  const ctx = makeRootContext(
    { ...INITIAL_COMPUTED_STYLE, writingMode: wm },
    cfg.pageInlineSize,
  );
  const virtual = makeVirtualLayoutTree(
    plan, cascadedRoot, ctx, shaper, cfg, undefined, cascadedTemplateContents,
  );
  const positioned = positionTreeForTest(virtual);
  return { state, positioned, shaper };
}

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

/** Read page 0's geometry: writing-mode + block extent + physical X span. */
function page0(positioned: LayoutBox) {
  const children = positioned.type === "block" ? positioned.children : [];
  for (const c of children) {
    if (c.type === "page" && c.pageIndex === 0) {
      return {
        writingMode: c.writingMode,
        blockSize: c.blockSize,
        effectiveTopInset: c.effectiveTopInset,
        effectiveBottomInset: c.effectiveBottomInset,
      };
    }
  }
  throw new Error("page0: page 0 not found");
}

/** Per-context line groups + their physical-X spans on page 0. */
function geometry(state: State, positioned: LayoutBox) {
  const all = getLineIndex(positioned).all;
  const bodyLines = all.filter(
    (l) => selectionContextOf(state, l.line.ownerBlockId) === state.rootId,
  );
  const headerLines = all.filter(
    (l) => selectionContextOf(state, l.line.ownerBlockId) === HEADER_ROOT,
  );
  const footerLines = all.filter(
    (l) => selectionContextOf(state, l.line.ownerBlockId) === FOOTER_ROOT,
  );
  return { bodyLines, headerLines, footerLines };
}

beforeEach(() => {
  __resetGetPageDriverCountForTest();
});

// The block axis is physical X for both vertical modes; click `y` (physical Y) is
// the INLINE axis (where the text runs). We aim the inline coord at the slot
// text's mid-extent so we land on the slot line once the correct zone is chosen.
for (const wm of ["vertical-lr", "vertical-rl"] as const) {
  describe(`#438 ${wm} — slot-zone classification on the block (physical-X) axis`, () => {
    it("layout sanity: header sits at the block-START margin, footer at the block-END margin", () => {
      const { state, positioned } = buildDoc({
        wm,
        bodyParas: ["body one", "body two"],
        headerPara: "the header",
        footerPara: "the footer",
      });
      const g = geometry(state, positioned);
      expect(g.headerLines.length).toBe(1);
      expect(g.footerLines.length).toBe(1);
      expect(g.bodyLines.length).toBe(2);

      const headerX = nth(g.headerLines, 0, "header line").absoluteX;
      const footerX = nth(g.footerLines, 0, "footer line").absoluteX;
      const bodyMinX = Math.min(...g.bodyLines.map((l) => l.absoluteX));
      const bodyMaxX = Math.max(...g.bodyLines.map((l) => l.absoluteX));

      if (wm === "vertical-rl") {
        // MIRROR: logical block-start (header) is at the HIGH physical X edge;
        // logical block-end (footer) at the LOW physical X edge; body between.
        expect(headerX).toBeGreaterThan(bodyMaxX);
        expect(footerX).toBeLessThan(bodyMinX);
      } else {
        // vertical-lr: block axis ascends along physical X (no mirror) — header at
        // LOW X, footer at HIGH X.
        expect(headerX).toBeLessThan(bodyMinX);
        expect(footerX).toBeGreaterThan(bodyMaxX);
      }
    });

    it("header-margin click → HEADER context (not body)", () => {
      const { state, positioned, shaper } = buildDoc({
        wm,
        bodyParas: ["body one", "body two"],
        headerPara: "the header",
        footerPara: "the footer",
      });
      const g = geometry(state, positioned);
      const header = nth(g.headerLines, 0, "header line");
      // Block-axis (physical X) click coord: the center of the header line band.
      const x = header.absoluteX + header.line.blockSize / 2;
      // Inline-axis (physical Y) click coord: over the header text (a few chars).
      const y = header.absoluteY + SHAPER_CHAR_W * 2;

      const pos = resolvePositionFromPixel(state, positioned, shaper, x, y, 0);
      expect(pos).not.toBeNull();
      if (pos === null) return;
      const resolved = resolveBlock(state, pos.blockId);
      expect(resolved).not.toBeNull();
      if (resolved === null) return;
      expect(resolved.kind).toBe("templateContent");
      expect(pos.blockId).toBe(HEADER_P1);
    });

    it("footer-margin click → FOOTER context (not body)", () => {
      const { state, positioned, shaper } = buildDoc({
        wm,
        bodyParas: ["body one", "body two"],
        headerPara: "the header",
        footerPara: "the footer",
      });
      const g = geometry(state, positioned);
      const footer = nth(g.footerLines, 0, "footer line");
      const x = footer.absoluteX + footer.line.blockSize / 2;
      const y = footer.absoluteY + SHAPER_CHAR_W * 2;

      const pos = resolvePositionFromPixel(state, positioned, shaper, x, y, 0);
      expect(pos).not.toBeNull();
      if (pos === null) return;
      const resolved = resolveBlock(state, pos.blockId);
      expect(resolved).not.toBeNull();
      if (resolved === null) return;
      expect(resolved.kind).toBe("templateContent");
      expect(pos.blockId).toBe(FOOTER_P1);
    });

    it("body-content click → BODY context (no slot capture)", () => {
      const { state, positioned, shaper } = buildDoc({
        wm,
        bodyParas: ["body one", "body two"],
        headerPara: "the header",
        footerPara: "the footer",
      });
      const g = geometry(state, positioned);
      const first = nth(g.bodyLines, 0, "body line");
      const x = first.absoluteX + first.line.blockSize / 2;
      const y = first.absoluteY + SHAPER_CHAR_W * 1 + 1; // mid-second-char inline

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

    it("body empty-tail click (block-end edge of content, near footer) → END of last body block, NOT footer", () => {
      const lastBodyText = "body two";
      const { state, positioned, shaper } = buildDoc({
        wm,
        bodyParas: ["body one", lastBodyText],
        headerPara: "the header",
        footerPara: "the footer",
      });
      const g = geometry(state, positioned);
      const edges = page0(positioned);
      // Project the body lines' block coords back to logical block-offset space to
      // find a click just past the last body line but still inside the content
      // area (before contentBottom).
      const blockReversed = wm === "vertical-rl";
      const logBlockOf = (absX: number, blk: number): number =>
        blockReversed ? edges.blockSize - (absX + blk) : absX;
      const bodyMaxBlockEnd = Math.max(
        ...g.bodyLines.map((l) => logBlockOf(l.absoluteX, l.line.blockSize) + l.line.blockSize),
      );
      const contentBottom = edges.blockSize - edges.effectiveBottomInset;
      const logicalY = (bodyMaxBlockEnd + contentBottom) / 2;
      expect(logicalY).toBeGreaterThan(bodyMaxBlockEnd);
      expect(logicalY).toBeLessThan(contentBottom);
      // Convert the chosen logical block offset (a POINT) back to physical X.
      const x = blockReversed ? edges.blockSize - logicalY : logicalY;
      // Inline coord far past the line end.
      const y = 5000;

      const pos = resolvePositionFromPixel(state, positioned, shaper, x, y, 0);
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
}
