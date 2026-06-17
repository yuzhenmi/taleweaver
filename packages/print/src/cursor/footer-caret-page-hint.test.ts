// packages/core/src/cursor/footer-caret-page-hint.test.ts
//
// #323 Cycle A (CORE): per-page caret instance for headers/footers.
//
// A header/footer body is ONE shared `templateContents` subtree rendered into
// EVERY page's slot, so a caret `Position {blockId, offset}` is page-ambiguous.
// Cycle A threads a NON-undoable `caretPageHint?: number` (view state) into
// caret-render so the caret resolves on the HINTED page (via getPage(hint),
// O(1) memo-warm — NOT the whole document), falling back to the template body's
// first carrying page when no/stale hint.
//
// All docs here are MULTI-PAGE with a shared footer (the #326 container body:
// a `template-body` root + a paragraph child) tagged on every plan entry, so
// the per-page disambiguation is exercised.
//
// Design: docs/superpowers/specs/2026-05-02-p1c-pagination-templates-design.md
// Tracking: #323.

import { describe, it, expect, beforeEach } from "vitest";
import { resolvePixelPosition } from "./cursor-position";
import { moveToLine, moveToLineBoundary } from "./line-navigation";
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
import type { ElementBox, RenderNode } from "@taleweaver/core";
import type { TextShaper } from "@taleweaver/core";
import type { PageConfig } from "../layout/page-config";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
} from "@taleweaver/core";
import { createPosition } from "@taleweaver/core";
import type { State, BlockId } from "@taleweaver/core";

const SHAPER_CHAR_W = 8;
const SHAPER_LINE_H = 16;

// The #326 container footer body: a `template-body` CONTAINER root holding ONE
// editable paragraph child. The slot caret lands in the PARAGRAPH child (a slot
// DESCENDANT, not the root) — which is exactly why it misses the
// `pageIndexOfTemplateBlock` ROOT fast path and needs the descendant parent-walk.
const FOOTER_ROOT = "ftr-root" as BlockId;
const FOOTER_PARA = "ftr-para" as BlockId;

// A short page so a few body paragraphs span MULTIPLE pages.
function pageConfig(): PageConfig {
  return {
    pageInlineSize: 320,
    pageBlockSize: 160,
    pageMargins: { blockStart: 24, blockEnd: 24, inlineStart: 0, inlineEnd: 0 },
    pageGap: 24,
  };
}

interface Built {
  state: State;
  virtual: VirtualLayoutTree;
  shaper: TextShaper;
}

/**
 * Build a MULTI-PAGE document (several body paragraphs that overflow the short
 * page) with a shared footer (container root + paragraph child), tag EVERY plan
 * entry's `footerBlockId` so the slot renders on every page. Returns the
 * UNMATERIALIZED virtual tree.
 *
 * `footerCarriesFromPage` optionally restricts which pages carry the footer
 * (used by the I1 stale-fallback test: a hint at a page whose slot lacks the
 * body must fall back to the body's default carrying page).
 */
function buildMultiPageFooter(opts: {
  bodyParagraphs: number;
  footerText: string;
  footerCarriesFromPage?: number;
}): Built {
  const footerCarriesFrom = opts.footerCarriesFromPage ?? 0;

  const templateBlocks = [
    // Container root (#326): no inlineContent, one paragraph child.
    buildBlock({
      id: FOOTER_ROOT,
      type: "template-body",
      firstChildId: FOOTER_PARA,
      lastChildId: FOOTER_PARA,
    }),
    buildBlock({
      id: FOOTER_PARA,
      type: "paragraph",
      parentId: FOOTER_ROOT,
      inlineContent: inlineContent([text(opts.footerText)]),
    }),
  ];

  // Body: N paragraphs each tall enough that a couple fill one short page.
  const bodyBlocks = [];
  for (let i = 0; i < opts.bodyParagraphs; i++) {
    const id = `p${i}`;
    bodyBlocks.push(
      buildBlock({
        id,
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: i === 0 ? null : `p${i - 1}`,
        nextSiblingId: i === opts.bodyParagraphs - 1 ? null : `p${i + 1}`,
        inlineContent: inlineContent([text(`body paragraph ${i}`)]),
      }),
    );
  }

  const state = buildState({
    rootId: "doc",
    blocks: [
      buildBlock({
        id: "doc",
        type: "document",
        firstChildId: "p0",
        lastChildId: `p${opts.bodyParagraphs - 1}`,
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

  // Tag the footer id onto every entry at or after `footerCarriesFrom`.
  const plan = planWithEntries(basePlan, (e) =>
    e.pageIndex >= footerCarriesFrom
      ? { ...e, footerBlockId: FOOTER_ROOT }
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

describe("#323 Cycle A — multi-page footer precondition", () => {
  it("the doc spans multiple pages and every page carries the footer", () => {
    const { virtual } = buildMultiPageFooter({ bodyParagraphs: 20, footerText: "Page footer" });
    expect(virtual.plan.entries.length).toBeGreaterThanOrEqual(3);
    for (const e of virtual.plan.entries) {
      expect(e.footerBlockId).toBe(FOOTER_ROOT);
    }
    // The footer caret lands in the PARAGRAPH child (a descendant), so the ROOT
    // fast-path map does NOT contain the paragraph id.
    expect(virtual.plan.pageIndexOfTemplateBlock(FOOTER_PARA)).toBe(-1);
    expect(virtual.plan.pageIndexOfTemplateBlock(FOOTER_ROOT)).toBe(0);
  });
});

describe("#323 Cycle A — caretPageHint resolves the footer caret on the hinted page", () => {
  it("hint=1 resolves the footer-ROOT caret on page 1", () => {
    const { state, virtual, shaper } = buildMultiPageFooter({
      bodyParagraphs: 20,
      footerText: "Page footer",
    });
    const pos = createPosition(FOOTER_ROOT, 0);
    const got = resolvePixelPosition(state, pos, virtual, shaper, 1);
    expect(got).not.toBeNull();
    if (got === null) return;
    expect(got.pageIndex).toBe(1);
  });

  it("hint=2 resolves the footer-ROOT caret on page 2", () => {
    const { state, virtual, shaper } = buildMultiPageFooter({
      bodyParagraphs: 20,
      footerText: "Page footer",
    });
    const pos = createPosition(FOOTER_ROOT, 0);
    const got = resolvePixelPosition(state, pos, virtual, shaper, 2);
    expect(got).not.toBeNull();
    if (got === null) return;
    expect(got.pageIndex).toBe(2);
  });

  it("no hint resolves to the FIRST carrying page (0)", () => {
    const { state, virtual, shaper } = buildMultiPageFooter({
      bodyParagraphs: 20,
      footerText: "Page footer",
    });
    const pos = createPosition(FOOTER_ROOT, 0);
    const got = resolvePixelPosition(state, pos, virtual, shaper);
    expect(got).not.toBeNull();
    if (got === null) return;
    expect(got.pageIndex).toBe(0);
  });

  it("uses getPage (NOT the whole document): the driver count stays small", () => {
    const { state, virtual, shaper } = buildMultiPageFooter({
      bodyParagraphs: 20,
      footerText: "Page footer",
    });
    __resetGetPageDriverCountForTest();
    const pos = createPosition(FOOTER_ROOT, 2);
    const got = resolvePixelPosition(state, pos, virtual, shaper, 1);
    expect(got).not.toBeNull();
    // A hinted footer caret must drive a SMALL number of per-page layout calls
    // (just the hinted page, not every page in the doc). Positioning the whole doc would
    // drive one per page (>= 3 here).
    expect(__getGetPageDriverCountForTest()).toBeLessThanOrEqual(2);
    expect(__getGetPageDriverCountForTest()).toBeLessThan(virtual.plan.entries.length);
  });
});

describe("#323 Cycle A — DESCENDANT footer-paragraph caret + hint", () => {
  it("caret on the footer PARAGRAPH child + hint=1 resolves on page 1 via the parent-walk", () => {
    const { state, virtual, shaper } = buildMultiPageFooter({
      bodyParagraphs: 20,
      footerText: "Page footer",
    });
    __resetGetPageDriverCountForTest();
    const pos = createPosition(FOOTER_PARA, 3);
    const got = resolvePixelPosition(state, pos, virtual, shaper, 1);
    expect(got).not.toBeNull();
    if (got === null) return;
    expect(got.pageIndex).toBe(1);
    // x at 3 chars * 8px = 24 (footer paragraph has its own lines).
    expect(got.x).toBeCloseTo(24, 5);
    // NOT the whole document: small driver count.
    expect(__getGetPageDriverCountForTest()).toBeLessThan(virtual.plan.entries.length);
  });

  it("descendant caret with NO hint resolves on the first carrying page (0)", () => {
    const { state, virtual, shaper } = buildMultiPageFooter({
      bodyParagraphs: 20,
      footerText: "Page footer",
    });
    const pos = createPosition(FOOTER_PARA, 0);
    const got = resolvePixelPosition(state, pos, virtual, shaper);
    expect(got).not.toBeNull();
    if (got === null) return;
    expect(got.pageIndex).toBe(0);
  });
});

describe("#323 Cycle A — C1 line-navigation honors caretPageHint", () => {
  it("moveToLine (Down) on a page-2 footer stays on page 2 (single-line footer no-op, resolved on the hinted page)", () => {
    const { state, virtual, shaper } = buildMultiPageFooter({
      bodyParagraphs: 10,
      footerText: "Page footer",
    });
    // Footer is a single line within its isolated slot context — Down is a
    // no-op, but it MUST resolve on the HINTED page (2), not the first page (0).
    const pos = createPosition(FOOTER_PARA, 0);
    __resetGetPageDriverCountForTest();
    const result = moveToLine(state, pos, virtual, shaper, "down", null, 2);
    // Single-line footer: Down has no same-context line below ⇒ no-op (null).
    expect(result).toBeNull();
    // It resolved on the hinted page, NOT by positioning the whole doc.
    expect(__getGetPageDriverCountForTest()).toBeLessThan(virtual.plan.entries.length);
  });

  it("moveToLine (Up) on a page-2 footer stays put (no-op) without positioning the whole doc", () => {
    const { state, virtual, shaper } = buildMultiPageFooter({
      bodyParagraphs: 10,
      footerText: "Page footer",
    });
    const pos = createPosition(FOOTER_PARA, 0);
    __resetGetPageDriverCountForTest();
    const result = moveToLine(state, pos, virtual, shaper, "up", null, 2);
    expect(result).toBeNull();
    expect(__getGetPageDriverCountForTest()).toBeLessThan(virtual.plan.entries.length);
  });

  it("moveToLineBoundary (End) on a page-2 footer resolves the footer paragraph's end on page 2", () => {
    const { state, virtual, shaper } = buildMultiPageFooter({
      bodyParagraphs: 10,
      footerText: "Page footer",
    });
    const pos = createPosition(FOOTER_PARA, 0);
    __resetGetPageDriverCountForTest();
    const got = moveToLineBoundary(state, pos, virtual, shaper, "end", 2);
    expect(got).not.toBeNull();
    if (got === null) return;
    // Stays in the footer paragraph (Home/End never leave the slot context).
    expect(got.blockId).toBe(FOOTER_PARA);
    expect(got.offset).toBe("Page footer".length);
    expect(__getGetPageDriverCountForTest()).toBeLessThan(virtual.plan.entries.length);
  });
});

describe("#323 Cycle A — I1 stale-fallback", () => {
  it("a hint pointing at a page whose slot lacks the body falls back to the default carrying page", () => {
    // Footer only renders from page 1 onward (page 0 has NO footer slot).
    const { state, virtual, shaper } = buildMultiPageFooter({
      bodyParagraphs: 20,
      footerText: "Page footer",
      footerCarriesFromPage: 1,
    });
    // The default carrying page is the FIRST that carries the footer (1).
    expect(virtual.plan.pageIndexOfTemplateBlock(FOOTER_ROOT)).toBe(1);

    // Hint page 0 — but page 0's slot does NOT carry the footer body. Must NOT
    // pin a blank caret there; fall back to the default carrying page (1).
    const pos = createPosition(FOOTER_ROOT, 0);
    const got = resolvePixelPosition(state, pos, virtual, shaper, 0);
    expect(got).not.toBeNull();
    if (got === null) return;
    expect(got.pageIndex).toBe(1);
  });
});
