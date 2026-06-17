// packages/core/src/cursor/line-navigation-context.test.ts
//
// C.2c #327: line-navigation (ArrowUp/Down) must NOT cross between the page
// BODY and a header/footer slot. A header/footer is an ISOLATED editing context
// (Google Docs convention: you CLICK into a header to edit it; arrow keys never
// carry the caret across the body↔header boundary).
//
// Root cause: C.2c T6 made `collectLineBoxes` include the header/footer SLOT
// lines in the page's flat line index. Without a context filter, ArrowUp from
// the body's top line finds the header's line (geometrically above) and moves
// into it. The fix constrains line-navigation to the caret's CONTEXT
// (`selectionContextOf`): only candidate lines whose context EQUALS the caret's
// context are considered.
//
// The header/footer body is a `template-body` CONTAINER (per #326) holding one
// or more paragraph children. A header line's `ownerBlockId` is a paragraph
// child; `selectionContextOf` walks up to the CONTAINER root (parentId null),
// which is distinct from `state.rootId`. That difference is the isolation signal.

import { describe, it, expect, beforeEach } from "vitest";
import { moveToLine } from "./line-navigation";
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
import { createPosition, selectionContextOf } from "@taleweaver/core";
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
const HEADER_P2 = "hdr-p2" as BlockId;
const FOOTER_ROOT = "ftr-root" as BlockId;
const FOOTER_P1 = "ftr-p1" as BlockId;

// A page big enough that the body fits on ONE page with room in the top/bottom
// margin bands for the header/footer slot.
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

/**
 * Build a SINGLE-PAGE document with a multi-paragraph body plus a header
 * CONTAINER body (one or two paragraph lines) and optionally a footer CONTAINER
 * body. Lay it out paginated, tag page 0's plan entry with the header/footer
 * container ids so the slots are materialized, and return both the virtual tree
 * and a positioned snapshot.
 */
function buildDoc(opts: {
  bodyParas: string[];
  headerParas: string[];
  footerParas?: string[];
}): Built {
  // Header CONTAINER body: a template-body root holding paragraph children.
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
        inlineContent: inlineContent([text(nth(opts.footerParas, 0, "footerPara"))]),
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
          headerBlockId: HEADER_ROOT,
          ...(opts.footerParas !== undefined ? { footerBlockId: FOOTER_ROOT } : {}),
        }
      : e,
  );

  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, cfg.pageInlineSize);
  const virtual = makeVirtualLayoutTree(
    plan, cascadedRoot, ctx, shaper, cfg, undefined, cascadedTemplateContents,
  );
  const positioned = positionTreeForTest(virtual);
  return { state, virtual, positioned, shaper };
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

describe("#327 — line-navigation does NOT cross body↔header/footer (virtual tree)", () => {
  it("precondition: the header slot exists and its lines have a context distinct from the body", () => {
    const { state, virtual } = buildDoc({
      bodyParas: ["body line one", "body line two"],
      headerParas: ["header"],
    });
    const p0 = virtual.getPage(0);
    expect(p0.headerSlot).not.toBeNull();
    // Header child's context = the header CONTAINER root, NOT state.rootId.
    expect(selectionContextOf(state, HEADER_P1)).toBe(HEADER_ROOT);
    expect(selectionContextOf(state, "bp0" as BlockId)).toBe(state.rootId);
    expect(selectionContextOf(state, HEADER_P1)).not.toBe(state.rootId);
  });

  it("ArrowUp from the body's FIRST line is a no-op (does NOT enter the header)", () => {
    const { state, virtual, shaper } = buildDoc({
      bodyParas: ["body line one", "body line two"],
      headerParas: ["header"],
    });
    const pos = createPosition("bp0" as BlockId, 2);
    const result = moveToLine(state, pos, virtual, shaper, "up", null);
    // Must NOT land in the header. Either no-op (stays in body) or start-of-doc.
    if (result !== null) {
      expect(selectionContextOf(state, result.position.blockId)).toBe(state.rootId);
      expect(result.position.blockId).not.toBe(HEADER_P1);
    }
  });

  it("ArrowDown from the body's LAST line is a no-op (does NOT enter the footer)", () => {
    const { state, virtual, shaper } = buildDoc({
      bodyParas: ["body line one", "body line two"],
      headerParas: ["header"],
      footerParas: ["footer"],
    });
    const pos = createPosition("bp1" as BlockId, 2);
    const result = moveToLine(state, pos, virtual, shaper, "down", null);
    if (result !== null) {
      expect(selectionContextOf(state, result.position.blockId)).toBe(state.rootId);
      expect(result.position.blockId).not.toBe(FOOTER_P1);
    }
  });

  it("ArrowDown WITHIN a 2-line header moves to the 2nd header line (same-context nav works)", () => {
    const { state, virtual, shaper } = buildDoc({
      bodyParas: ["body"],
      headerParas: ["header one", "header two"],
    });
    const pos = createPosition(HEADER_P1, 2);
    const result = moveToLine(state, pos, virtual, shaper, "down", null);
    expect(result).not.toBeNull();
    if (result === null) return;
    // Stays in the header context, moves to the 2nd header paragraph.
    expect(selectionContextOf(state, result.position.blockId)).toBe(HEADER_ROOT);
    expect(result.position.blockId).toBe(HEADER_P2);
  });

  it("ArrowUp from the header's FIRST line is a no-op (does NOT exit to body)", () => {
    const { state, virtual, shaper } = buildDoc({
      bodyParas: ["body line one", "body line two"],
      headerParas: ["header one", "header two"],
    });
    const pos = createPosition(HEADER_P1, 2);
    const result = moveToLine(state, pos, virtual, shaper, "up", null);
    // Isolated slot: ArrowUp from the top of the header context is a no-op —
    // it must NOT exit to the body (and an isolated context has no document
    // boundary to fall to), so the result is null (caret stays put).
    expect(result).toBeNull();
  });

  it("body-internal ArrowDown still moves between body lines", () => {
    const { state, virtual, shaper } = buildDoc({
      bodyParas: ["body line one", "body line two"],
      headerParas: ["header"],
    });
    const pos = createPosition("bp0" as BlockId, 2);
    const result = moveToLine(state, pos, virtual, shaper, "down", null);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(selectionContextOf(state, result.position.blockId)).toBe(state.rootId);
    expect(result.position.blockId).toBe("bp1");
  });
});

describe("#327 — line-navigation context isolation (positioned tree)", () => {
  it("ArrowUp from the body's first line does NOT enter the header (positioned path)", () => {
    const { state, positioned, shaper } = buildDoc({
      bodyParas: ["body line one", "body line two"],
      headerParas: ["header"],
    });
    // Sanity: the header line really is geometrically ABOVE the body's first line
    // in the flat index, so an unfiltered search WOULD pick it.
    const idx = getLineIndex(positioned);
    const hdr = idx.byBlock.get(HEADER_P1) ?? [];
    const body0 = idx.byBlock.get("bp0" as BlockId) ?? [];
    expect(hdr.length).toBe(1);
    expect(body0.length).toBe(1);
    expect(nth(hdr, 0, "header line").absoluteY).toBeLessThan(nth(body0, 0, "body line").absoluteY);

    const pos = createPosition("bp0" as BlockId, 2);
    const result = moveToLine(state, pos, positioned, shaper, "up", null);
    if (result !== null) {
      expect(selectionContextOf(state, result.position.blockId)).toBe(state.rootId);
      expect(result.position.blockId).not.toBe(HEADER_P1);
    }
  });

  it("ArrowDown WITHIN a 2-line header moves to the 2nd header line (positioned path)", () => {
    const { state, positioned, shaper } = buildDoc({
      bodyParas: ["body"],
      headerParas: ["header one", "header two"],
    });
    const pos = createPosition(HEADER_P1, 2);
    const result = moveToLine(state, pos, positioned, shaper, "down", null);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(selectionContextOf(state, result.position.blockId)).toBe(HEADER_ROOT);
    expect(result.position.blockId).toBe(HEADER_P2);
  });
});
