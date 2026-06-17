// packages/core/src/cursor/header-slot-cursor.test.ts
//
// C.2c T6: hit-test + caret + selection-geometry into a header/footer SLOT.
//
// T4 lays a page's header/footer template body into PageBox.headerSlot /
// footerSlot (page-local coords; header at the top margin band, footer at the
// bottom band). T6 makes the caret / hit-test / selection machinery SEE slot
// content so a user can click into a header, place a caret, and select text
// there.
//
// SCOPE / known limitation (#323): a header/footer body renders identically
// into EVERY page's slot. hit-test (pixel→position) is unambiguous (the click
// pixel determines the page). position→pixel (caret render) is page-ambiguous —
// a slot caret resolves to the FIRST page carrying that slot. ALL tests here use
// SINGLE-PAGE docs so the ambiguity never arises.
//
// Design: docs/superpowers/specs/2026-05-02-p1c-pagination-templates-design.md

import { describe, it, expect, beforeEach } from "vitest";
import { resolveHitPosition as resolvePositionFromPixel } from "../test-utils/hit-position";
import { resolvePixelPosition } from "./cursor-position";
import { computeSelectionRects } from "./selection-geometry";
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
  __getGetPageDriverCountForTest,
  __resetGetPageDriverCountForTest,
  type VirtualLayoutTree,
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
import { createPosition, createSpan } from "@taleweaver/core";
import type { State, BlockId } from "@taleweaver/core";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const SHAPER_CHAR_W = 8;
const SHAPER_LINE_H = 16;

// A page big enough that the single body paragraph fits on ONE page (so the
// slot caret's first-page resolution is unambiguous). Non-zero margins so the
// header/footer bands have room.
function pageConfig(): PageConfig {
  return {
    pageInlineSize: 320,
    pageBlockSize: 400,
    pageMargins: { blockStart: 40, blockEnd: 40, inlineStart: 0, inlineEnd: 0 },
    pageGap: 24,
  };
}

// The header/footer body is a SINGLE-PARAGRAPH root: the body root block IS the
// content-bearing paragraph (no wrapping container). This matches the T8 body
// shape — `blockId === root` — so the slot caret's `position.blockId` equals the
// id `pageIndexOfTemplateBlock` maps (the slot ROOT). #323: per-page caret
// instance is a follow-up; the slot caret resolves to the FIRST page.
const HEADER_ROOT = "hdr-root" as BlockId;
const FOOTER_ROOT = "ftr-root" as BlockId;

interface Built {
  state: State;
  virtual: VirtualLayoutTree;
  shaper: TextShaper;
}

/**
 * Build a SINGLE-PAGE document with a body paragraph plus a header (and
 * optionally footer) template body, lay it out paginated, and tag page 0's plan
 * entry with the header/footer ids so the slot is materialized. Returns the
 * UNMATERIALIZED virtual tree.
 */
function buildDocWithHeader(opts: {
  bodyText: string;
  headerText: string;
  footerText?: string;
}): Built {
  const templateBlocks = [
    buildBlock({
      id: HEADER_ROOT,
      type: "paragraph",
      inlineContent: inlineContent([text(opts.headerText)]),
    }),
  ];
  if (opts.footerText !== undefined) {
    templateBlocks.push(
      buildBlock({
        id: FOOTER_ROOT,
        type: "paragraph",
        inlineContent: inlineContent([text(opts.footerText)]),
      }),
    );
  }

  const state = buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        inlineContent: inlineContent([text(opts.bodyText)]),
      }),
    ],
    templateContents: templateBlocks,
  });

  const out = render(state, createDefaultComponentRegistry(), createDefaultAttrRegistry());
  // Cascade the document root + each template body (the real pipeline cascades
  // every RenderOutput tree).
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
  // Tag page 0 with header/footer ids (this is what the section plan does in
  // production; here we set it directly so the slot is materialized).
  const plan = planWithEntries(basePlan, (e) =>
    e.pageIndex === 0
      ? {
          ...e,
          headerBlockId: HEADER_ROOT,
          ...(opts.footerText !== undefined ? { footerBlockId: FOOTER_ROOT } : {}),
        }
      : e,
  );

  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, cfg.pageInlineSize);
  const virtual = makeVirtualLayoutTree(
    plan, cascadedRoot, ctx, shaper, cfg, undefined, cascadedTemplateContents,
  );
  return { state, virtual, shaper };
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
  // Rebuild the slot-body → first-page map from the OVERRIDDEN entries (the
  // override is what adds the header/footer ids — the base plan has none), so
  // `pageIndexOfTemplateBlock` reflects the tagged ids rather than delegating to
  // the base plan's empty map.
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

describe("C.2c T6 — header slot is single-page (precondition)", () => {
  it("the body + header fit on exactly one page", () => {
    const { virtual } = buildDocWithHeader({ bodyText: "body", headerText: "header" });
    expect(virtual.plan.entries.length).toBe(1);
    const p0 = virtual.getPage(0);
    expect(p0.headerSlot).not.toBeNull();
  });
});

describe("C.2c T6 — hit-test into the header band", () => {
  it("a click over the header text resolves to the header body block + a sensible offset", () => {
    const { state, virtual, shaper } = buildDocWithHeader({
      bodyText: "body text here",
      headerText: "header",
    });
    const positioned = positionTreeForTest(virtual);

    // Find the header line's geometry to click on it precisely.
    const hdrLines = getLineIndex(positioned).byBlock.get(HEADER_ROOT) ?? [];
    expect(hdrLines.length).toBe(1);
    const hdrLine = nth(hdrLines, 0, "header line");
    // The header is in the TOP margin band (y near 0, well above the body).
    expect(hdrLine.absoluteY).toBeLessThan(40); // within the 40px top band
    const yInHeader = hdrLine.absoluteY + hdrLine.line.blockSize / 2;

    // Click at x=0 → offset 0 of the header.
    const atStart = resolvePositionFromPixel(state, positioned, shaper, 0.1, yInHeader);
    expect(atStart).not.toBeNull();
    if (atStart === null) return;
    expect(atStart.blockId).toBe(HEADER_ROOT);
    expect(atStart.offset).toBe(0);

    // Click at x=24 (3 chars * 8px) → offset 3 of the header.
    const atMid = resolvePositionFromPixel(state, positioned, shaper, 24, yInHeader);
    expect(atMid).not.toBeNull();
    if (atMid === null) return;
    expect(atMid.blockId).toBe(HEADER_ROOT);
    expect(atMid.offset).toBe(3);
  });

  it("body-content hit-test is unaffected (clicks below the header land in the body)", () => {
    const { state, virtual, shaper } = buildDocWithHeader({
      bodyText: "body text here",
      headerText: "header",
    });
    const positioned = positionTreeForTest(virtual);
    const bodyLines = getLineIndex(positioned).byBlock.get("p" as BlockId) ?? [];
    expect(bodyLines.length).toBe(1);
    const bodyLine = nth(bodyLines, 0, "body line");
    const yInBody = bodyLine.absoluteY + bodyLine.line.blockSize / 2;
    const got = resolvePositionFromPixel(state, positioned, shaper, 16, yInBody);
    expect(got).not.toBeNull();
    if (got === null) return;
    expect(got.blockId).toBe("p");
    expect(got.offset).toBe(2);
  });
});

describe("C.2c T6 — caret (position→pixel) into the header slot", () => {
  it("a slot caret resolves to a y in the top margin band, x at the offset", () => {
    const { state, virtual, shaper } = buildDocWithHeader({
      bodyText: "body",
      headerText: "header",
    });

    const pos = createPosition(HEADER_ROOT, 3);
    const got = resolvePixelPosition(state, pos, virtual, shaper);
    expect(got).not.toBeNull();
    if (got === null) return;
    // Header is in the top margin band: y < blockStart (40px).
    expect(got.y).toBeLessThan(40);
    expect(got.pageIndex).toBe(0);
    // x at 3 chars * 8px = 24.
    expect(got.x).toBeCloseTo(24, 5);
  });

  it("oracle-equivalence: slot caret equals the materialized-tree path", () => {
    const { state, virtual, shaper } = buildDocWithHeader({
      bodyText: "body",
      headerText: "header",
    });
    const positioned = positionTreeForTest(virtual);
    for (const offset of [0, 2, 6]) {
      const pos = createPosition(HEADER_ROOT, offset);
      const got = resolvePixelPosition(state, pos, virtual, shaper);
      const oracle = resolvePixelPosition(state, pos, positioned, shaper);
      expect(got, `offset ${offset}`).toEqual(oracle);
    }
  });

  it("drives exactly one page for a slot-root caret (fast path, never the whole doc)", () => {
    const { state, virtual, shaper } = buildDocWithHeader({
      bodyText: "body",
      headerText: "header",
    });
    // Fresh, unmaterialized tree: a slot caret must drive exactly ONE per-page
    // layoutBlock call (page 0 via the fast path), NOT the whole document.
    __resetGetPageDriverCountForTest();
    const pos = createPosition(HEADER_ROOT, 2);
    const got = resolvePixelPosition(state, pos, virtual, shaper);
    expect(got).not.toBeNull();
    expect(__getGetPageDriverCountForTest()).toBe(1);
  });
});

describe("C.2c T6 — selection-geometry into the header slot", () => {
  it("a span anchored+focused inside the header produces rects in the top band", () => {
    const { state, virtual, shaper } = buildDocWithHeader({
      bodyText: "body",
      headerText: "header",
    });
    const positioned = positionTreeForTest(virtual);

    // Select "head" (offset 0..4) within the header.
    const span = createSpan(
      createPosition(HEADER_ROOT, 0),
      createPosition(HEADER_ROOT, 4),
    );
    const rects = computeSelectionRects(state, span, positioned, shaper);
    expect(rects.length).toBeGreaterThan(0);
    const rect = nth(rects, 0, "rect");
    // Rect in the top margin band.
    expect(rect.y).toBeLessThan(40);
    // Width covers ~4 chars * 8px = 32px.
    expect(rect.width).toBeCloseTo(32, 1);
    expect(rect.pageIndex).toBe(0);
  });
});

describe("C.2c T6 — pageIndexOfTemplateBlock", () => {
  it("maps the header slot ROOT id to its first page", () => {
    const { virtual } = buildDocWithHeader({ bodyText: "body", headerText: "header" });
    expect(virtual.plan.pageIndexOfTemplateBlock(HEADER_ROOT)).toBe(0);
  });

  it("returns -1 for a normal main-tree block id", () => {
    const { virtual } = buildDocWithHeader({ bodyText: "body", headerText: "header" });
    expect(virtual.plan.pageIndexOfTemplateBlock("p" as BlockId)).toBe(-1);
  });

  it("maps footer slot root id too", () => {
    const { virtual } = buildDocWithHeader({
      bodyText: "body",
      headerText: "header",
      footerText: "footer",
    });
    expect(virtual.plan.pageIndexOfTemplateBlock(FOOTER_ROOT)).toBe(0);
  });
});
