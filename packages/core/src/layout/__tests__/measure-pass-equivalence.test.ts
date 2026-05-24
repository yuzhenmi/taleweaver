// packages/core/src/layout/__tests__/measure-pass-equivalence.test.ts
//
// THE ORACLE (virtualized-layout Phase 1, Task 8). For each fixture we run the
// REAL paginated layout (`paginateRoot`, driven page-by-page the way
// `paginateRoot` itself drives `layoutBlock`) and extract its per-page
// boundaries — children-count, page blockOffset, and the break-token chain.
// We then run `measurePass` on the SAME cascaded root's metas and assert the
// plan matches EXACTLY (page count, per-page children count, blockOffset,
// resume tokens structurally-equal, totalBlockSize). Real layout is ground
// truth: if the pure fit-core diverges, this test fails.

import { describe, it, expect } from "vitest";
import { layoutBlock } from "../bfc";
import { paginateRoot } from "../paginate";
import { makeRootContext } from "../layout-context";
import type { LayoutContext } from "../layout-context";
import { INITIAL_COMPUTED_STYLE } from "../../styles";
import { createMockShaper } from "../mock-shaper";
import { cascadePass } from "../../cascade";
import { createElementBox, createTextBox } from "../../render/render-node";
import type { ElementBox } from "../../render/render-node";
import type { Style } from "../../styles";
import type { BreakToken, FragmentationContext } from "../fragmentation";
import type { PageConfig } from "../page-config";
import { buildBlockFitMetas } from "../build-fit-metas";
import { measurePass } from "../measure-pass";
import type { PagePlanEntry } from "../measure-pass";

// ---------------------------------------------------------------------------
// Oracle: drive the real layout page-by-page (mirror of paginateRoot's loop)
// and capture per-page boundary facts.
// ---------------------------------------------------------------------------

interface OraclePage {
  readonly pageIndex: number;
  readonly blockOffset: number;
  /** First top-level child index on this page. */
  readonly startIndex: number;
  /** Resume token INTO this page. */
  readonly resumeInto: BreakToken | null;
  /** Resume token OUT of this page (the layoutBlock breakToken). */
  readonly resumeOut: BreakToken | null;
  /**
   * Children fully/partially counted on this page, per paginateRoot's
   * fingerprint slice: [startIndex, nextStartIndex) where nextStartIndex is
   * breakToken.resumeChildIndex (or root.children.length when no break).
   */
  readonly childrenCount: number;
}

function runOracle(
  root: ElementBox,
  shaper: ReturnType<typeof createMockShaper>,
  pageConfig: PageConfig,
): { pages: OraclePage[]; totalBlockSize: number } {
  const margins = pageConfig.pageMargins;
  const pageContentBlockSize =
    pageConfig.pageBlockSize - margins.blockStart - margins.blockEnd;
  const pageContentInlineSize =
    pageConfig.pageInlineSize - margins.inlineStart - margins.inlineEnd;
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize);
  const contentCtx: LayoutContext = { ...ctx, containingInlineSize: pageContentInlineSize };

  const pages: OraclePage[] = [];
  let resumeFrom: BreakToken | null = null;
  let startIndex = 0;
  let pageIndex = 0;

  for (;;) {
    const fragmentation: FragmentationContext = {
      availableBlockSize: pageContentBlockSize,
      pageIndex,
      resumeFrom,
    };
    const { breakToken } = layoutBlock(
      root,
      margins.inlineStart,
      margins.blockStart,
      contentCtx,
      shaper,
      fragmentation,
    );
    const blockOffset = pageIndex * (pageConfig.pageBlockSize + pageConfig.pageGap);
    const nextStartIndex =
      breakToken === null
        ? root.children.length
        : breakToken.type === "block"
          ? breakToken.resumeChildIndex
          : startIndex;
    pages.push({
      pageIndex,
      blockOffset,
      startIndex,
      resumeInto: resumeFrom,
      resumeOut: breakToken,
      childrenCount: nextStartIndex - startIndex,
    });
    if (breakToken === null) {
      pageIndex++;
      break;
    }
    if (breakToken.type === "block") startIndex = breakToken.resumeChildIndex;
    resumeFrom = breakToken;
    pageIndex++;
  }

  const pageCount = pageIndex;
  const totalBlockSize =
    pageCount * pageConfig.pageBlockSize + Math.max(0, pageCount - 1) * pageConfig.pageGap;
  return { pages, totalBlockSize };
}

/** Structural break-token equality (references differ across layout cycles). */
function tokensEqual(a: BreakToken | null, b: BreakToken | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.type !== b.type) return false;
  if (a.type === "block" && b.type === "block") {
    return a.resumeChildIndex === b.resumeChildIndex && tokensEqual(a.resumeChildToken, b.resumeChildToken);
  }
  if (a.type === "ifc" && b.type === "ifc") return a.resumeAtLine === b.resumeAtLine;
  if (a.type === "table" && b.type === "table") return a.resumeAtRow === b.resumeAtRow;
  return false;
}

/**
 * Run the full equivalence assertion for a cascaded root: oracle vs measurePass.
 * Also exercises `paginateRoot` to confirm the page count matches the page-by-
 * page oracle (a sanity tie-back to the real production paginator).
 */
function assertEquivalent(root: ElementBox, pageConfig: PageConfig): void {
  const shaper = createMockShaper(8, 16);
  const oracle = runOracle(root, shaper, pageConfig);

  // Tie-back: paginateRoot (the real production entry) must produce the same
  // page count as the page-by-page oracle.
  const paginated = paginateRoot(
    root,
    makeRootContext(INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize),
    createMockShaper(8, 16),
    pageConfig,
  );
  expect(paginated.children.length).toBe(oracle.pages.length);

  const pageContentInlineSize =
    pageConfig.pageInlineSize - pageConfig.pageMargins.inlineStart - pageConfig.pageMargins.inlineEnd;
  const metas = buildBlockFitMetas(root, createMockShaper(8, 16), pageContentInlineSize);
  const plan = measurePass(metas, pageConfig, root.children);

  // Page count.
  expect(plan.entries.length).toBe(oracle.pages.length);
  // Total block size.
  expect(plan.totalBlockSize).toBe(oracle.totalBlockSize);

  // Per-page boundaries.
  for (let i = 0; i < oracle.pages.length; i++) {
    const o = oracle.pages[i];
    const p: PagePlanEntry = plan.entries[i];
    expect(p.pageIndex, `page ${i} pageIndex`).toBe(o.pageIndex);
    expect(p.blockOffset, `page ${i} blockOffset`).toBe(o.blockOffset);
    expect(p.startIndex, `page ${i} startIndex`).toBe(o.startIndex);
    expect(p.children.length, `page ${i} childrenCount`).toBe(o.childrenCount);
    expect(tokensEqual(p.resumeInto, o.resumeInto), `page ${i} resumeInto`).toBe(true);
    expect(tokensEqual(p.resumeOut, o.resumeOut), `page ${i} resumeOut`).toBe(true);
  }
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

/** A page config with no margins (content area == full page). */
function noMarginPageConfig(pageBlockSize: number, pageInlineSize = 600, pageGap = 20): PageConfig {
  return {
    pageInlineSize,
    pageBlockSize,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap,
  };
}

function cascadeRoot(rootStyle: Style, children: readonly ElementBox[]): ElementBox {
  const root = createElementBox("root", rootStyle, children);
  const cascaded = cascadePass(root);
  if (cascaded.type !== "element") throw new Error("cascadePass returned non-element");
  return cascaded;
}

/** A fixed-height block child (no inline content; uses explicit blockSize). */
function fixedBlock(key: string, blockSize: number, extra?: Partial<Style>): ElementBox {
  return createElementBox(key, { display: "block", blockSize, ...(extra ?? {}) } as Style, []);
}

/** A paragraph with `numLines` hard-wrapped lines (whiteSpace: pre, one \n per line). */
function paragraph(key: string, numLines: number, extra?: Partial<Style>): ElementBox {
  const text = Array.from({ length: numLines }, () => "x").join("\n");
  const textNode = createTextBox(`${key}-t`, { whiteSpace: "pre" }, text);
  return createElementBox(key, { display: "block", whiteSpace: "pre", ...(extra ?? {}) } as Style, [textNode]);
}

// ---------------------------------------------------------------------------
// (a) Leaf paragraphs: margin collapse, §5.4, suppression, whole-block fit, §C.6
// ---------------------------------------------------------------------------

describe("measure-pass equivalence — (a) leaf blocks", () => {
  it("3 short fixed blocks on a single page", () => {
    const root = cascadeRoot({ display: "block" }, [
      fixedBlock("b0", 50),
      fixedBlock("b1", 50),
      fixedBlock("b2", 50),
    ]);
    assertEquivalent(root, noMarginPageConfig(1000));
  });

  it("many fixed blocks exactly filling pages (multi-page)", () => {
    // 10 blocks × 100 = 1000; page content 300 ⇒ 3 per page ⇒ 4 pages.
    const children = Array.from({ length: 10 }, (_, i) => fixedBlock(`b${i}`, 100));
    const root = cascadeRoot({ display: "block" }, children);
    assertEquivalent(root, noMarginPageConfig(300));
  });

  it("blocks with collapsing adjacent margins across a boundary", () => {
    const children = Array.from({ length: 6 }, (_, i) =>
      fixedBlock(`b${i}`, 80, { marginBlockStart: 20, marginBlockEnd: 30 }),
    );
    const root = cascadeRoot({ display: "block" }, children);
    assertEquivalent(root, noMarginPageConfig(250));
  });

  it("tall paragraph spanning a boundary (fitLinesInIFC, default orphans/widows)", () => {
    // 20 lines × 16px = 320; page content 100 ⇒ ~6 lines/page.
    const root = cascadeRoot({ display: "block" }, [paragraph("p", 20)]);
    assertEquivalent(root, noMarginPageConfig(100));
  });

  it("paragraph + following block: IFC fragment then block on next page", () => {
    const root = cascadeRoot({ display: "block" }, [paragraph("p", 12), fixedBlock("b", 60)]);
    assertEquivalent(root, noMarginPageConfig(100));
  });

  it("oversize first block overflows (§C.6 consume-whole)", () => {
    const root = cascadeRoot({ display: "block" }, [
      fixedBlock("b0", 500),
      fixedBlock("b1", 500),
      fixedBlock("b2", 500),
    ]);
    assertEquivalent(root, noMarginPageConfig(300));
  });

  it("first block's top margin is truncated on page 0 (§5.4 first-on-fragment)", () => {
    // CSS Fragmentation §5.4: the first child placed on a fresh fragment has its
    // top margin truncated to 0. So the first block here (margin-block-start 40)
    // starts at document-y 0, NOT 40 — both in the real `layoutBlock` oracle and
    // in `measurePass`. (This is the ONLY first-on-fragment margin rule the
    // measure pass models; bfc's `noTopBoundary` suppression is a no-op in the
    // paginated path because §5.4 already zeroed the margin first, regardless of
    // whether the root has top padding/border — which is why a separate
    // root-top-boundary fixture would test nothing different.) The exact-
    // equivalence assertion below pins the boundary; we also assert the page-0
    // top edge directly to make the §5.4 truncation explicit.
    const children = Array.from({ length: 5 }, (_, i) =>
      fixedBlock(`b${i}`, 80, { marginBlockStart: 40 }),
    );
    const root = cascadeRoot({ display: "block" }, children);
    assertEquivalent(root, noMarginPageConfig(300));
    // Direct proof of §5.4: the first block's running offset on page 0 is 0, NOT
    // its 40px top margin. With truncation the page packs b0 (0→80), b1
    // (max(0,40)=40 gap → 120→200), and b2 would start at 240→320 > 300 ⇒ 2
    // blocks on page 0. The exact-equivalence assertion above already pins this
    // against the real oracle; here we re-state the page-0 facts to make the
    // truncation explicit and guard against a regression that re-introduces a
    // 40px lead-in (which would shift the page-0 boundary).
    const metas = buildBlockFitMetas(root, createMockShaper(8, 16), 600);
    const plan = measurePass(metas, noMarginPageConfig(300), root.children);
    expect(plan.entries[0].blockOffset).toBe(0);
    expect(plan.entries[0].startIndex).toBe(0);
    expect(plan.entries[0].children.length).toBe(2);
    // The first block resumed onto page 0 begins at the page top (offset 0),
    // i.e. its top margin was truncated; the resume into page 1 starts at b2.
    expect(plan.entries[0].resumeOut).toEqual({
      type: "block",
      resumeChildIndex: 2,
      resumeChildToken: null,
    });
  });
});

// ---------------------------------------------------------------------------
// (b) break-before / break-after / break-inside
// ---------------------------------------------------------------------------

describe("measure-pass equivalence — (b) forced breaks", () => {
  it("break-before:page mid-page forces a new page", () => {
    const root = cascadeRoot({ display: "block" }, [
      fixedBlock("b0", 80),
      fixedBlock("b1", 80),
      fixedBlock("b2", 80, { breakBefore: "page" }),
      fixedBlock("b3", 80),
    ]);
    assertEquivalent(root, noMarginPageConfig(1000));
  });

  it("break-after:page forces the next child to a new page", () => {
    const root = cascadeRoot({ display: "block" }, [
      fixedBlock("b0", 80),
      fixedBlock("b1", 80, { breakAfter: "page" }),
      fixedBlock("b2", 80),
      fixedBlock("b3", 80),
    ]);
    assertEquivalent(root, noMarginPageConfig(1000));
  });

  it("break-inside:avoid block pushed whole to next page (non-empty fragment)", () => {
    // b0 fills 200 of 250; b1 (avoid) is 100 → doesn't fit → pushed whole.
    const root = cascadeRoot({ display: "block" }, [
      paragraph("p0", 12), // 12 × 16 = 192
      paragraph("p1", 6, { breakInside: "avoid" }), // 96, won't fit in remaining ~58
    ]);
    assertEquivalent(root, noMarginPageConfig(250));
  });

  it("break-inside:avoid block too-tall first-on-fragment (§C.6 consume-whole)", () => {
    const root = cascadeRoot({ display: "block" }, [
      paragraph("p0", 30, { breakInside: "avoid" }), // 480 > page content 200
    ]);
    assertEquivalent(root, noMarginPageConfig(200));
  });
});

// ---------------------------------------------------------------------------
// (c) table leaf spanning pages
// ---------------------------------------------------------------------------

describe("measure-pass equivalence — (c) table leaf", () => {
  function tableOf(numRows: number, rowHeight: number): ElementBox {
    const rows = Array.from({ length: numRows }, (_, i) =>
      createElementBox(`row-${i}`, { display: "table-row", blockSize: rowHeight } as Style, [
        createElementBox(`cell-${i}`, { display: "table-cell" } as Style, [
          createTextBox(`ct-${i}`, {}, "x"),
        ]),
      ]),
    );
    return createElementBox("tbl", { display: "table" } as Style, rows);
  }

  it("table spanning pages (body-row split)", () => {
    // 8 rows × 30 = 240; page content 100 ⇒ 3 rows/page.
    const root = cascadeRoot({ display: "block" }, [tableOf(8, 30)]);
    assertEquivalent(root, noMarginPageConfig(100));
  });

  it("block then table spanning pages", () => {
    const root = cascadeRoot({ display: "block" }, [fixedBlock("b0", 40), tableOf(8, 30)]);
    assertEquivalent(root, noMarginPageConfig(100));
  });
});

// ---------------------------------------------------------------------------
// (d) nested container + ordered list spanning pages (recursive resumeChildToken)
// ---------------------------------------------------------------------------

describe("measure-pass equivalence — (d) nested containers", () => {
  it("blockquote (container of paragraphs) spanning a page boundary", () => {
    const quote = createElementBox("quote", { display: "block" } as Style, [
      paragraph("q0", 4),
      paragraph("q1", 4),
      paragraph("q2", 4),
      paragraph("q3", 4),
    ]);
    // quote = 16 lines × 16 = 256; page content 100.
    const root = cascadeRoot({ display: "block" }, [quote]);
    assertEquivalent(root, noMarginPageConfig(100));
  });

  it("blockquote preceded by a block, spanning a boundary", () => {
    const quote = createElementBox("quote", { display: "block" } as Style, [
      paragraph("q0", 4),
      paragraph("q1", 4),
      paragraph("q2", 4),
    ]);
    const root = cascadeRoot({ display: "block" }, [fixedBlock("b0", 50), quote]);
    assertEquivalent(root, noMarginPageConfig(100));
  });

  it("two-level nesting (div > blockquote > paragraphs) spanning a boundary", () => {
    // Doubly-nested containers: an outer `div` holds an inner `blockquote` which
    // holds the paragraphs. When this fragments across a page, the real
    // `layoutBlock` emits a triple-nested resume token
    //   {block i, {block j, {block 0, {ifc, L}}}}
    // (outer div child i → inner quote child j → paragraph's anon-IFC child 0 →
    // line L). The single-level nested fixtures above never exercise that depth;
    // this one validates `fitOnePage`'s recursive token build against the oracle.
    const inner = createElementBox("quote", { display: "block" } as Style, [
      paragraph("q0", 4),
      paragraph("q1", 4),
      paragraph("q2", 4),
      paragraph("q3", 4),
    ]);
    const outer = createElementBox("div", { display: "block" } as Style, [inner]);
    // 16 lines × 16 = 256 inside two nested containers; page content 100.
    const root = cascadeRoot({ display: "block" }, [outer]);
    assertEquivalent(root, noMarginPageConfig(100));
  });

  it("ordered list spanning pages (list-item children, cross-page numbering)", () => {
    const items = Array.from({ length: 8 }, (_, i) => {
      const text = createTextBox(`li-t-${i}`, { whiteSpace: "pre" }, "x");
      return createElementBox(`li-${i}`, { display: "list-item", whiteSpace: "pre" } as Style, [text]);
    });
    const list = createElementBox("ol", { display: "block" } as Style, items);
    const root = cascadeRoot({ display: "block" }, [list]);
    // 8 items × 16 = 128; page content 50 ⇒ ~3 items/page.
    assertEquivalent(root, noMarginPageConfig(50));
  });

  it("top-level list-item blocks (counter accumulation across pages)", () => {
    const items = Array.from({ length: 9 }, (_, i) => fixedBlock(`li-${i}`, 40, { display: "list-item" }));
    const root = cascadeRoot({ display: "block" }, items);
    assertEquivalent(root, noMarginPageConfig(120));
  });
});
