// packages/core/src/cursor/selection-geometry-context.test.ts
//
// SELECT_ALL rect bleed (companion to #327 line-navigation isolation): a body
// selection's highlight rects must NOT bleed into the header/footer SLOT bands,
// and a header selection's rects must NOT bleed into the body.
//
// C.2c T6 made the per-page `LineIndex.all` (and the doc-wide flat index)
// include the header/footer slot lines — in doc order each page is
// `[header lines, body lines, footer lines]`. `computeSelectionRects` /
// `computeSelectionRectsForPage` walked ALL lines between the span's start and
// end LINE INDEX with no context filter, so a body span (which after the
// SELECT_ALL fix runs from the body's first leaf to its last leaf) would emit a
// rect for every line between them — INCLUDING the interleaved header/footer
// slot lines on each page. The fix filters candidate lines to the SELECTION's
// context before emitting rects (mirroring `makeContextFilter` in #327).
//
// Fixture mirrors line-navigation-context.test.ts: a multi-paragraph body plus a
// header CONTAINER body and a footer CONTAINER body (per #326).

import { describe, it, expect, beforeEach } from "vitest";
import { computeSelectionRects } from "./selection-geometry";
import { getLineIndex, makeContextFilter } from "./line-flatten";
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
  type VirtualLayoutTree,
} from "../layout/virtual-layout-tree";
import { positionTreeForTest } from "../test-utils/position-tree";
import { layoutTree as dispatchLayout } from "../layout/dispatch";
import type { ElementBox, RenderNode } from "@taleweaver/core";
import type { TextShaper } from "@taleweaver/core";
import type { PageConfig } from "../layout/page-config";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
} from "@taleweaver/core";
import { createPosition, createSpan, selectionContextOf } from "@taleweaver/core";
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
const HEADER_P2 = "hdr-p2" as BlockId;
const FOOTER_ROOT = "ftr-root" as BlockId;
const FOOTER_P1 = "ftr-p1" as BlockId;

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
  virtual: VirtualLayoutTree;
  positioned: LayoutBox;
  shaper: TextShaper;
}

function buildDoc(opts: {
  bodyParas: string[];
  headerParas: string[];
  footerParas?: string[];
}): Built {
  const headerChildren = opts.headerParas.map((t, i) => {
    const id = i === 0 ? HEADER_P1 : HEADER_P2;
    return buildBlock({
      id,
      type: "paragraph",
      parentId: HEADER_ROOT,
      prevSiblingId: i === 0 ? null : HEADER_P1,
      nextSiblingId: i === 0 && opts.headerParas.length > 1 ? HEADER_P2 : null,
      inlineContent: inlineContent([text(t)]),
    });
  });
  const templateBlocks = [
    buildBlock({
      id: HEADER_ROOT,
      type: "template-body",
      firstChildId: HEADER_P1,
      lastChildId: opts.headerParas.length > 1 ? HEADER_P2 : HEADER_P1,
    }),
    ...headerChildren,
  ];
  if (opts.footerParas !== undefined) {
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
        inlineContent: inlineContent([text(nth(opts.footerParas, 0, "footer paragraph"))]),
      }),
    );
  }

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
  // Tag EVERY page entry with the header/footer ids so the slot is materialized
  // on each page (the multi-page case is where a body span would otherwise bleed
  // into the interleaved slot lines between pages).
  const plan = planWithEntries(basePlan, (e) => ({
    ...e,
    headerBlockId: HEADER_ROOT,
    ...(opts.footerParas !== undefined ? { footerBlockId: FOOTER_ROOT } : {}),
  }));

  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, cfg.pageInlineSize);
  const virtual = makeVirtualLayoutTree(
    plan, cascadedRoot, ctx, shaper, cfg, undefined, cascadedTemplateContents,
  );
  const positioned = positionTreeForTest(virtual);
  return { state, virtual, positioned, shaper };
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

beforeEach(() => {
  __resetGetPageDriverCountForTest();
});

// A body long enough to span MULTIPLE pages — that is where a body select-all
// would (pre-fix) include the interleaved header/footer SLOT lines between pages
// in `.all` doc order (each page is [header lines, body lines, footer lines]).
const MULTI_PAGE_BODY = Array.from({ length: 40 }, (_, i) => `body line ${i}`);
const LAST_BODY = `bp${MULTI_PAGE_BODY.length - 1}` as BlockId;

describe("selection-geometry — context isolation (rects don't bleed into slots)", () => {
  it("precondition: a multi-page body interleaves header/footer slot lines between pages", () => {
    const { state, virtual, positioned } = buildDoc({
      bodyParas: MULTI_PAGE_BODY,
      headerParas: ["header"],
      footerParas: ["footer"],
    });
    expect(virtual.plan.entries.length).toBeGreaterThan(1); // >1 page
    const all = getLineIndex(positioned).all;
    const hdrLines = all.filter((al) => selectionContextOf(state, al.line.ownerBlockId) === HEADER_ROOT);
    const ftrLines = all.filter((al) => selectionContextOf(state, al.line.ownerBlockId) === FOOTER_ROOT);
    const bodyLines = all.filter((al) => selectionContextOf(state, al.line.ownerBlockId) === state.rootId);
    // Header/footer replicate per page, so MULTIPLE slot lines exist between the
    // body lines of consecutive pages — the bleed hazard.
    expect(hdrLines.length).toBeGreaterThan(1);
    expect(ftrLines.length).toBeGreaterThan(1);
    expect(bodyLines.length).toBeGreaterThan(1);
  });

  it("a body select-all produces rects ONLY for body lines (no header/footer band)", () => {
    const { state, positioned, shaper } = buildDoc({
      bodyParas: MULTI_PAGE_BODY,
      headerParas: ["header"],
      footerParas: ["footer"],
    });
    // Body select-all span: first body leaf → last body leaf (spans every page).
    const span = createSpan(
      createPosition("bp0" as BlockId, 0),
      createPosition(LAST_BODY, nth(MULTI_PAGE_BODY, MULTI_PAGE_BODY.length - 1, "body line").length),
    );
    const rects = computeSelectionRects(state, span, positioned, shaper);
    expect(rects.length).toBeGreaterThan(0);

    // Build the set of Y ranges owned by header/footer (non-body) lines; assert
    // no rect overlaps them. (A rect bleeding into a slot would have its y inside
    // a header/footer line's [absoluteY, absoluteY+blockSize) band on that page.)
    const filterBody = makeContextFilter(state, state.rootId);
    const all = getLineIndex(positioned).all;
    const slotLines = all.filter((al) => !filterBody([al]).length);
    expect(slotLines.length).toBeGreaterThan(0);
    let bleed = 0;
    for (const rect of rects) {
      for (const slot of slotLines) {
        const samePage = rect.pageIndex === slot.pageIndex;
        const yOverlap =
          rect.y < slot.absoluteY + slot.line.blockSize && rect.y + rect.height > slot.absoluteY;
        if (samePage && yOverlap) bleed++;
      }
    }
    expect(bleed, "body rects bled into header/footer slot bands").toBe(0);
  });

  it("a header select-all produces rects ONLY in the header band (no body lines)", () => {
    const { state, positioned, shaper } = buildDoc({
      bodyParas: ["body line one", "body line two"],
      headerParas: ["header one", "header two"],
      footerParas: ["footer"],
    });
    // Header select-all span: first header leaf → last header leaf.
    const span = createSpan(
      createPosition(HEADER_P1, 0),
      createPosition(HEADER_P2, "header two".length),
    );
    const rects = computeSelectionRects(state, span, positioned, shaper);
    expect(rects.length).toBeGreaterThan(0);

    // No rect may overlap a non-header (body or footer) line's band.
    const filterHdr = makeContextFilter(state, HEADER_ROOT);
    const all = getLineIndex(positioned).all;
    const nonHeaderLines = all.filter((al) => !filterHdr([al]).length);
    for (const rect of rects) {
      for (const other of nonHeaderLines) {
        const samePage = rect.pageIndex === other.pageIndex;
        const yOverlap =
          rect.y < other.absoluteY + other.line.blockSize && rect.y + rect.height > other.absoluteY;
        expect(samePage && yOverlap, `header rect at page ${rect.pageIndex} y=${rect.y} bled into a non-header line`).toBe(false);
      }
    }
  });
});

// ── NO-REGRESSION: main-only doc → rects unchanged (filter is a no-op) ──────

describe("selection-geometry — main-only doc unchanged (no context filter effect)", () => {
  function mainOnly(textContent: string): State {
    return buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text(textContent)]),
        }),
      ],
    });
  }

  it("a single-paragraph main-doc span yields the same rects as before the filter", () => {
    const state = mainOnly("hello world");
    const root = render(state, createDefaultComponentRegistry(), createDefaultAttrRegistry()).root;
    const shaper = createMockShaper(SHAPER_CHAR_W, SHAPER_LINE_H);
    // Non-paginated main-only layout (mirrors selection-geometry.test.ts pipeline).
    const layout = positionTreeForTest(dispatchLayout(root, 800, shaper));
    const span = createSpan(createPosition("p" as BlockId, 1), createPosition("p" as BlockId, 4));
    const rects = computeSelectionRects(state, span, layout, shaper);
    expect(rects.length).toBe(1);
    // 8px/char: offset 1..4 → x=8, width=24 (unchanged from the pre-filter path).
    const rect = nth(rects, 0, "selection rect");
    expect(rect.x).toBe(8);
    expect(rect.width).toBe(24);
  });
});
