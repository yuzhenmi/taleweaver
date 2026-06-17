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
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { createMockShaper } from "@taleweaver/core";
import { createMockHyphenator } from "@taleweaver/core";
import type { Hyphenator } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { createElementBox, createTextBox } from "@taleweaver/core";
import type { ElementBox } from "@taleweaver/core";
import type { Style } from "@taleweaver/core";
import { breakTokensEqual } from "../fragmentation";
import type { PageConfig } from "../page-config";
import { buildBlockFitMetas } from "../build-fit-metas";
import { measurePass, measurePassUnsupported, paginationFallsBackToLegacy } from "../measure-pass";
import type { PagePlanEntry } from "../measure-pass";
import { IMPLICIT_SECTION_PLAN } from "../section-plan";
import type { LineBox } from "../layout-box";
import { runOracle, nth } from "./equivalence-oracle";

/**
 * Run the full equivalence assertion for a cascaded root: oracle vs measurePass.
 * Also exercises `paginateRoot` to confirm the page count matches the page-by-
 * page oracle (a sanity tie-back to the real production paginator).
 */
function assertEquivalent(root: ElementBox, pageConfig: PageConfig, hyphenator?: Hyphenator): void {
  const shaper = createMockShaper(8, 16);
  const oracle = runOracle(root, shaper, pageConfig, hyphenator);

  // Tie-back: paginateRoot (the real production entry) must produce the same
  // page count as the page-by-page oracle.
  const paginated = paginateRoot(
    root,
    makeRootContext(INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize),
    createMockShaper(8, 16), hyphenator, pageConfig,
  );
  expect(paginated.children.length).toBe(oracle.pages.length);

  const pageContentInlineSize =
    pageConfig.pageInlineSize - pageConfig.pageMargins.inlineStart - pageConfig.pageMargins.inlineEnd;
  const metas = buildBlockFitMetas(root, createMockShaper(8, 16), hyphenator, pageContentInlineSize);
  const plan = measurePass(metas, pageConfig, IMPLICIT_SECTION_PLAN, root.children);

  // Page count.
  expect(plan.entries.length).toBe(oracle.pages.length);
  // Total block size.
  expect(plan.totalBlockSize).toBe(oracle.totalBlockSize);

  // Per-page boundaries.
  for (let i = 0; i < oracle.pages.length; i++) {
    const o = nth(oracle.pages, i, "oracle page");
    const p: PagePlanEntry = nth(plan.entries, i, "plan entry");
    expect(p.pageIndex, `page ${i} pageIndex`).toBe(o.pageIndex);
    expect(p.blockOffset, `page ${i} blockOffset`).toBe(o.blockOffset);
    expect(p.startIndex, `page ${i} startIndex`).toBe(o.startIndex);
    expect(p.children.length, `page ${i} childrenCount`).toBe(o.childrenCount);
    expect(breakTokensEqual(p.resumeInto, o.resumeInto), `page ${i} resumeInto`).toBe(true);
    expect(breakTokensEqual(p.resumeOut, o.resumeOut), `page ${i} resumeOut`).toBe(true);
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

/**
 * A bare inline-display child producing `numLines` hard-wrapped lines. Placed
 * directly among a container's children (NOT wrapped in its own block), it
 * forms an `inline-run` group that bfc lays out via an anonymous IFC block.
 * Used to build MIXED-content containers (block + bare inline run + block).
 */
function bareInlineRun(key: string, numLines: number): ElementBox {
  const text = Array.from({ length: numLines }, () => "x").join("\n");
  const textNode = createTextBox(`${key}-t`, { whiteSpace: "pre" }, text);
  return createElementBox(key, { display: "inline", whiteSpace: "pre" } as Style, [textNode]);
}

/**
 * A bare inline-display child whose text SOFT-wraps (space-separated words,
 * `whiteSpace: normal`). The number of lines therefore depends on the CONTENT
 * inline-size it is laid out against — the lever that exposes Fix 1's
 * double-subtraction of a container's inline padding. With the mock shaper
 * (charWidth 8) `wordCount` one-char words each cost 8px plus an 8px space:
 * line capacity is `floor((contentInlineSize + 8) / 16)` words. A 20px change
 * in the content width (one inline-padding's worth, applied twice vs once) can
 * move the per-line word count by one and thus change the line count.
 */
function softInlineRun(key: string, wordCount: number): ElementBox {
  const text = Array.from({ length: wordCount }, () => "x").join(" ");
  const textNode = createTextBox(`${key}-t`, {}, text);
  return createElementBox(key, { display: "inline" } as Style, [textNode]);
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
    const metas = buildBlockFitMetas(root, createMockShaper(8, 16), undefined, 600);
    const plan = measurePass(metas, noMarginPageConfig(300), IMPLICIT_SECTION_PLAN, root.children);
    const entry0 = nth(plan.entries, 0, "plan entry");
    expect(entry0.blockOffset).toBe(0);
    expect(entry0.startIndex).toBe(0);
    expect(entry0.children.length).toBe(2);
    // The first block resumed onto page 0 begins at the page top (offset 0),
    // i.e. its top margin was truncated; the resume into page 1 starts at b2.
    expect(entry0.resumeOut).toEqual({
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

  // #487 — a table with a repeating header row, fragmenting across pages. Gate A:
  // the measure plan (which reserves headerBlockSize per continuation) must agree
  // EXACTLY with the real `layoutTable` oracle (which re-lays the header on each
  // continuation). A drift here is the #494/#498/#499 class.
  function tableWithHeader(numRows: number, headerRowCount: number, rowHeight: number): ElementBox {
    const rows = Array.from({ length: numRows }, (_, i) =>
      createElementBox(`row-${i}`, { display: "table-row", blockSize: rowHeight } as Style, [
        createElementBox(`cell-${i}`, { display: "table-cell" } as Style, [
          createTextBox(`ct-${i}`, {}, "x"),
        ]),
      ]),
    );
    return createElementBox("tbl", { display: "table" } as Style, rows, { headerRowCount });
  }

  it("table with a 1-row repeating header spanning pages (header reservation)", () => {
    // 8 rows × 30 = 240, headerRowCount 1; page content 100. Continuation fragments
    // reserve 30 for the re-laid header ⇒ fewer body rows fit per page than a plain
    // table. Oracle (real layoutTable) ↔ measurePass must agree exactly.
    const root = cascadeRoot({ display: "block" }, [tableWithHeader(8, 1, 30)]);
    assertEquivalent(root, noMarginPageConfig(100));
  });

  it("table with a 2-row repeating header spanning pages", () => {
    const root = cascadeRoot({ display: "block" }, [tableWithHeader(10, 2, 25)]);
    assertEquivalent(root, noMarginPageConfig(120));
  });

  it("block then table with a repeating header, table starts mid-page", () => {
    const root = cascadeRoot({ display: "block" }, [
      fixedBlock("b0", 40),
      tableWithHeader(8, 1, 30),
    ]);
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

// ---------------------------------------------------------------------------
// (e) MIXED-content container (#253): block + bare inline-run + block.
// bfc groups the container's children into an ordered sequence of `block` and
// `inline-run` groups; each inline-run becomes an anonymous IFC block. The
// measure pass must mirror that ORDER so the container's child metas reproduce
// the same per-line/per-block break decisions across a page boundary.
// ---------------------------------------------------------------------------

describe("measure-pass equivalence — (e) mixed block+inline container content", () => {
  it("container: block, bare inline run, block — spanning a boundary", () => {
    // div { fixedBlock(40); inline-run(6 lines = 96); fixedBlock(40) } = 176;
    // page content 100 ⇒ fragments across a boundary inside the container.
    const div = createElementBox("mix", { display: "block" } as Style, [
      fixedBlock("m0", 40),
      bareInlineRun("mr", 6),
      fixedBlock("m1", 40),
    ]);
    const root = cascadeRoot({ display: "block" }, [div]);
    assertEquivalent(root, noMarginPageConfig(100));
  });

  it("container: leading inline run then blocks — spanning a boundary", () => {
    const div = createElementBox("mix", { display: "block" } as Style, [
      bareInlineRun("mr", 5), // 80
      fixedBlock("m0", 40),
      fixedBlock("m1", 40),
    ]);
    const root = cascadeRoot({ display: "block" }, [div]);
    assertEquivalent(root, noMarginPageConfig(100));
  });

  it("document ROOT with mixed children (bare inline run between blocks)", () => {
    // The root itself is a container; a bare inline run between two blocks must
    // be modeled at the top level too, not just in nested containers.
    const root = cascadeRoot({ display: "block" }, [
      fixedBlock("b0", 40),
      bareInlineRun("rr", 6),
      fixedBlock("b1", 40),
    ]);
    assertEquivalent(root, noMarginPageConfig(100));
  });

  it("nested mixed container (div > [block, inline-run, block]) spanning a boundary", () => {
    const inner = createElementBox("inner", { display: "block" } as Style, [
      fixedBlock("i0", 30),
      bareInlineRun("ir", 5), // 80
      fixedBlock("i1", 30),
    ]);
    const outer = createElementBox("outer", { display: "block" } as Style, [inner]);
    const root = cascadeRoot({ display: "block" }, [outer]);
    assertEquivalent(root, noMarginPageConfig(100));
  });
});

// ---------------------------------------------------------------------------
// (f) PADDED / BORDERED container (#254): block-axis padding/border insets the
// children's available space and adds to the container's consumed height.
// bfc starts `childBlockOffset` at paddingBlockStart and ends the box at
// childBlockOffset + paddingBlockEnd; border-block-width does NOT shift block-
// axis geometry in this engine (it only governs margin-collapse-through via
// noTopBoundary/noBottomBoundary). The oracle settles the border question.
// ---------------------------------------------------------------------------

describe("measure-pass equivalence — (f) padded/bordered container space", () => {
  it("padded container (paddingBlockStart/End 20) holding paragraphs, spanning a boundary", () => {
    const quote = createElementBox(
      "quote",
      { display: "block", paddingBlockStart: 20, paddingBlockEnd: 20 } as Style,
      [paragraph("q0", 4), paragraph("q1", 4), paragraph("q2", 4)],
    );
    // 12 lines × 16 = 192 + 40 padding = 232; page content 100.
    const root = cascadeRoot({ display: "block" }, [quote]);
    assertEquivalent(root, noMarginPageConfig(100));
  });

  it("padded container with top-only padding spanning a boundary", () => {
    const quote = createElementBox(
      "quote",
      { display: "block", paddingBlockStart: 30 } as Style,
      [paragraph("q0", 4), paragraph("q1", 4), paragraph("q2", 4)],
    );
    const root = cascadeRoot({ display: "block" }, [quote]);
    assertEquivalent(root, noMarginPageConfig(100));
  });

  it("bordered container spanning a boundary (settles border's geometry role)", () => {
    const quote = createElementBox(
      "quote",
      { display: "block", borderBlockStartWidth: 10, borderBlockEndWidth: 10 } as Style,
      [paragraph("q0", 4), paragraph("q1", 4), paragraph("q2", 4)],
    );
    const root = cascadeRoot({ display: "block" }, [quote]);
    assertEquivalent(root, noMarginPageConfig(100));
  });

  it("padded + bordered container spanning a boundary", () => {
    const quote = createElementBox(
      "quote",
      {
        display: "block",
        paddingBlockStart: 15,
        paddingBlockEnd: 15,
        borderBlockStartWidth: 5,
        borderBlockEndWidth: 5,
      } as Style,
      [paragraph("q0", 4), paragraph("q1", 4), paragraph("q2", 4)],
    );
    const root = cascadeRoot({ display: "block" }, [quote]);
    assertEquivalent(root, noMarginPageConfig(100));
  });

  it("padded container preceded by a block, spanning a boundary", () => {
    const quote = createElementBox(
      "quote",
      { display: "block", paddingBlockStart: 20, paddingBlockEnd: 20 } as Style,
      [paragraph("q0", 4), paragraph("q1", 4)],
    );
    const root = cascadeRoot({ display: "block" }, [fixedBlock("b0", 50), quote]);
    assertEquivalent(root, noMarginPageConfig(100));
  });

  it("COMBINED: padded container with MIXED content spanning a boundary", () => {
    const mix = createElementBox(
      "mix",
      { display: "block", paddingBlockStart: 20, paddingBlockEnd: 20 } as Style,
      [fixedBlock("m0", 30), bareInlineRun("mr", 5), fixedBlock("m1", 30)],
    );
    const root = cascadeRoot({ display: "block" }, [mix]);
    assertEquivalent(root, noMarginPageConfig(100));
  });
});

// ---------------------------------------------------------------------------
// (g) measurePassUnsupported gate: after #253/#254 are modeled, padded/bordered
// containers and mixed content are SUPPORTED (false); only float/clear remain
// unsupported (true).
// ---------------------------------------------------------------------------

describe("measurePassUnsupported gate after #253/#254", () => {
  it("mixed-content container is now SUPPORTED (false)", () => {
    const div = createElementBox("mix", { display: "block" } as Style, [
      fixedBlock("m0", 40),
      bareInlineRun("mr", 6),
      fixedBlock("m1", 40),
    ]);
    const root = cascadeRoot({ display: "block" }, [div]);
    expect(measurePassUnsupported(root)).toBe(false);
  });

  it("padded container is now SUPPORTED (false)", () => {
    const quote = createElementBox(
      "quote",
      { display: "block", paddingBlockStart: 20, paddingBlockEnd: 20 } as Style,
      [paragraph("q0", 4), paragraph("q1", 4)],
    );
    const root = cascadeRoot({ display: "block" }, [quote]);
    expect(measurePassUnsupported(root)).toBe(false);
  });

  it("bordered container is now SUPPORTED (false)", () => {
    const quote = createElementBox(
      "quote",
      { display: "block", borderBlockStartWidth: 10, borderBlockEndWidth: 10 } as Style,
      [paragraph("q0", 4), paragraph("q1", 4)],
    );
    const root = cascadeRoot({ display: "block" }, [quote]);
    expect(measurePassUnsupported(root)).toBe(false);
  });

  it("padded + mixed container is now SUPPORTED (false)", () => {
    const mix = createElementBox(
      "mix",
      { display: "block", paddingBlockStart: 20, paddingBlockEnd: 20 } as Style,
      [fixedBlock("m0", 30), bareInlineRun("mr", 5), fixedBlock("m1", 30)],
    );
    const root = cascadeRoot({ display: "block" }, [mix]);
    expect(measurePassUnsupported(root)).toBe(false);
  });

  it("single-column floated document is no longer measurePassUnsupported, and uses the virtual fast path (VL float fast-path)", () => {
    const floated = createElementBox("f", { display: "block", float: "inline-start" } as Style, [
      createTextBox("ft", {}, "x"),
    ]);
    const root = cascadeRoot({ display: "block" }, [fixedBlock("b0", 40), floated]);
    // `measurePassUnsupported` now flags ONLY position:absolute (float/clear lifted).
    expect(measurePassUnsupported(root)).toBe(false);
    // A single-column, footnote-free float doc routes to the virtualized fast path.
    expect(paginationFallsBackToLegacy(root, [])).toBe(false);
  });

  it("single-column clear:both document is no longer measurePassUnsupported, and uses the virtual fast path (VL float fast-path)", () => {
    const cleared = createElementBox("c", { display: "block", clear: "both" } as Style, [
      createTextBox("ct", {}, "x"),
    ]);
    const root = cascadeRoot({ display: "block" }, [fixedBlock("b0", 40), cleared]);
    expect(measurePassUnsupported(root)).toBe(false);
    expect(paginationFallsBackToLegacy(root, [])).toBe(false);
  });

  it("position:absolute document is UNSUPPORTED (true) — must fall back to legacy positioned layout", () => {
    // An abs-pos child is removed from flow by the real BFC (drained into
    // `absoluteChildren`), which the cheap measure pass does NOT model — its
    // `buildBlockFitMetas` wrapper finds no placed child and throws. Flag it so
    // the doc routes to `paginateRoot` (which handles abs-pos), mirroring float/
    // clear. (positioning-audit F1.)
    const absChild = createElementBox("a", { display: "block", position: "absolute" } as Style, [
      createTextBox("at", {}, "x"),
    ]);
    const root = cascadeRoot({ display: "block" }, [fixedBlock("b0", 40), absChild]);
    expect(measurePassUnsupported(root)).toBe(true);
  });

  it("position:relative document stays SUPPORTED (false) — relative keeps in-flow geometry", () => {
    // Relative offset is a paint/caret shift only; the box stays in flow with the
    // same block-axis advance, so the measure pass reproduces it. Only ABSOLUTE
    // (out-of-flow) trips the gate.
    const relChild = createElementBox("r", { display: "block", position: "relative" } as Style, [
      createTextBox("rt", {}, "x"),
    ]);
    const root = cascadeRoot({ display: "block" }, [fixedBlock("b0", 40), relChild]);
    expect(measurePassUnsupported(root)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (h) INLINE-padding container content width (Fix 1): a container's
// paddingInlineStart/End reduces the CONTENT inline-size its children (and any
// bare inline run laid out as an anonymous IFC block) wrap against. bfc
// subtracts that inline padding EXACTLY ONCE per nesting level (bfc.ts:227 —
// `contentInlineSize = finalInlineSize − paddingInlineStart − paddingInlineEnd`)
// and lays the anonymous IFC at that content width (bfc.ts:334). A
// soft-wrapping inline run's LINE COUNT therefore depends on the content width,
// so a measure pass that subtracts the inline padding twice produces extra
// lines and a different page boundary. These fixtures use SOFT-wrapping runs
// (space-separated words) so the line count is width-sensitive, and assert
// exact equivalence against the real `paginateRoot` oracle.
// ---------------------------------------------------------------------------

describe("measure-pass equivalence — (h) inline-padding container content width", () => {
  // Mock-shaper geometry (charWidth 8, lineHeight 16): one-char words each cost
  // 8px plus an 8px inter-word space, so line capacity = floor((width + 8)/16)
  // words. At a page inline-size of 600 (no margins), a container with inline
  // padding 10/10 has CONTENT width 580 (subtracted ONCE) ⇒ floor(588/16)=36
  // words/line. The BUG subtracts the padding a SECOND time ⇒ width 560 ⇒
  // floor(568/16)=35 words/line. The word counts below sit in the gap where 36
  // vs 35 words/line yields a DIFFERENT line count for the BARE inline run laid
  // out via the anonymous-IFC path (`ifcLeafMetaFromInlineRun` — the buggy
  // path). The page block-size is chosen so the extra (8th) line spills onto an
  // extra page, making the page COUNT diverge — not just an interior offset.
  // (A SOLE inline child of a container is classified as a paragraph IFC leaf
  // via `layoutChildInWrapper`, which does NOT double-subtract; so every fixture
  // here uses a MIXED block+inline-run sequence to route through the buggy
  // anonymous-IFC code path.)

  it("inline-padded container with MIXED content; soft run line count adds a page", () => {
    // div { fixedBlock(32); softInlineRun(250 words); fixedBlock(32) }, inline
    // padding 10/10. Correct content width 580 ⇒ ceil(250/36)=7 run lines (112px)
    // ⇒ container 32 + 112 + 32 = 176. Buggy width 560 ⇒ ceil(250/35)=8 lines
    // (128px) ⇒ container 32 + 128 + 32 = 192. Page content 176: the correct
    // container fits exactly on ONE page; the buggy (192px) container does not.
    // Page count diverges, plus interior boundaries shift. Oracle settles it.
    const div = createElementBox(
      "mix",
      { display: "block", paddingInlineStart: 10, paddingInlineEnd: 10 } as Style,
      [fixedBlock("m0", 32), softInlineRun("mr", 250), fixedBlock("m1", 32)],
    );
    const root = cascadeRoot({ display: "block" }, [div]);
    assertEquivalent(root, noMarginPageConfig(176, 600));
  });

  it("inline-padded container, LEADING soft run then blocks; line count shifts trailing block", () => {
    // Run FIRST (250 words ⇒ 7 lines/112px at 580 vs 8 lines/128px at 560), then
    // two 40px blocks. Page content 120. Correct: run 112 ≤ 120 (page 0), block
    // m0 breaks to page 1 (112+40>120), block m1 follows. Buggy: run 128 > 120 ⇒
    // run itself fragments at the page-0 bottom (resume mid-run), shifting every
    // subsequent boundary. Oracle settles the exact plan.
    const div = createElementBox(
      "mix",
      { display: "block", paddingInlineStart: 10, paddingInlineEnd: 10 } as Style,
      [softInlineRun("mr", 250), fixedBlock("m0", 40), fixedBlock("m1", 40)],
    );
    const root = cascadeRoot({ display: "block" }, [div]);
    assertEquivalent(root, noMarginPageConfig(120, 600));
  });

  it("NESTED inline-padded containers with MIXED inner content; inner run wraps at inner content width", () => {
    // outer inline padding 10/10 ⇒ inner available 580; inner inline padding
    // 10/10 ⇒ inner CONTENT width 560 (each level subtracts ONCE) ⇒ 35/line.
    // The BUG subtracts twice per level ⇒ 540 (33/line) for the inner run. 240
    // words: at 560 ceil(240/35)=7 lines (112px); at 540 ceil(240/33)=8 lines
    // (128px). Inner container (with 20px lead + 20px trail blocks): 20+112+20=
    // 152 (correct) vs 20+128+20=168 (buggy). Page content 152 ⇒ the correct
    // tree is one page, the buggy tree fragments. Page count + boundaries diverge.
    const inner = createElementBox(
      "inner",
      { display: "block", paddingInlineStart: 10, paddingInlineEnd: 10 } as Style,
      [fixedBlock("i0", 20), softInlineRun("ir", 240), fixedBlock("i1", 20)],
    );
    const outer = createElementBox(
      "outer",
      { display: "block", paddingInlineStart: 10, paddingInlineEnd: 10 } as Style,
      [inner],
    );
    const root = cascadeRoot({ display: "block" }, [outer]);
    assertEquivalent(root, noMarginPageConfig(152, 600));
  });
});

// ---------------------------------------------------------------------------
// (i) TWO-LEVEL padded container: padded container A → padded container B →
// paragraphs (Fix 2). When B fragments across a boundary, A reconstructs B's
// partial-fragment height from B's `consumedBlockSize` (FitPageResult). This
// fixture exercises that nested-consumed-size path end-to-end so B's
// `consumedBlockSize` feeding A's partial height is oracle-proven.
// ---------------------------------------------------------------------------

describe("measure-pass equivalence — (i) two-level padded container consumedBlockSize", () => {
  it("padded A > padded B > paragraphs, B fragments across multiple boundaries", () => {
    // A (paddingBlockStart/End 15) > B (paddingBlockStart/End 10) > three 4-line
    // paragraphs (64px each = 192). Page content 120. B's content overflows one
    // page, so B fragments and threads a nested resume token; A reconstructs B's
    // partial-fragment height from B's `consumedBlockSize` (paddingStart + B's
    // consumed children + trailing margin + paddingEnd). The document spans 3
    // pages — the nested consumedBlockSize feeding A's partial height is
    // oracle-proven across two interior boundaries.
    const b = createElementBox(
      "B",
      { display: "block", paddingBlockStart: 10, paddingBlockEnd: 10 } as Style,
      [paragraph("q0", 4), paragraph("q1", 4), paragraph("q2", 4)],
    );
    const a = createElementBox(
      "A",
      { display: "block", paddingBlockStart: 15, paddingBlockEnd: 15 } as Style,
      [b],
    );
    const root = cascadeRoot({ display: "block" }, [a]);
    assertEquivalent(root, noMarginPageConfig(120));
  });

  it("padded A > [block, padded B > paragraphs], B fragments after a sibling", () => {
    // A leading block sibling consumes part of A's content so B starts mid-flow,
    // then B fragments. A reconstructs B's partial-fragment height from B's
    // `consumedBlockSize`. Three 5-line paragraphs (80px each) overflow the page;
    // the document spans 3 pages, exercising the nested-consumed-size path with a
    // non-trivial leading sibling offset.
    const b = createElementBox(
      "B",
      { display: "block", paddingBlockStart: 10, paddingBlockEnd: 10 } as Style,
      [paragraph("q0", 5), paragraph("q1", 5), paragraph("q2", 5)],
    );
    const a = createElementBox(
      "A",
      { display: "block", paddingBlockStart: 10, paddingBlockEnd: 10 } as Style,
      [fixedBlock("lead", 30), b],
    );
    const root = cascadeRoot({ display: "block" }, [a]);
    assertEquivalent(root, noMarginPageConfig(120));
  });
});

// ---------------------------------------------------------------------------
// (j) Trailing-margin propagation for an anonymous inline-run PARTIAL fit
// (Fix 3). When a bare inline run partial-fits at a page boundary, bfc resets
// `prevMarginBlockEnd = 0` (bfc.ts:373) BEFORE building the partial result, so
// the container's propagated trailing margin is 0 — NOT the bottom margin of a
// block sibling placed before the run. The fragmenting container has
// paddingBlockEnd > 0 so its partial-fragment height folds in the trailing
// margin (noBottomBoundary is false), making a stale trailing margin observable
// in the page boundary.
// ---------------------------------------------------------------------------

describe("measure-pass equivalence — (j) anon inline-run partial-fit trailing margin", () => {
  // A leading top-level spacer (10px) makes the padded `mix` container NOT
  // first-on-fragment, so when its partial-fragment height EXCEEDS the page
  // remainder bfc breaks BEFORE it rather than §C.6-consuming it whole — the
  // decision is sensitive to the partial height down to the pixel. Inside
  // `mix`: a 10px block sibling carrying marginBlockEnd 20, then a hard-wrapped
  // 4-line inline run. Page content 100; the spacer leaves remaining 90 for
  // `mix`. bfc lays the run via an anonymous IFC and resets prevMarginBlockEnd
  // to 0 (bfc.ts:373) BEFORE building the partial result, so the trailing
  // margin folded into `mix`'s partial-fragment height (paddingBlockEnd 10 ⇒
  // noBottomBoundary false) is 0, NOT the block's 20px margin. Reconstructed
  // partial height: paddingStart 0 + consumed(10+20+2×16=62) + 0 + paddingEnd 10
  // = 72 ≤ 90 ⇒ `mix` fits partially on page 0 and threads its nested resume
  // token. A measure pass that leaves the STALE 20px margin computes 92 > 90 ⇒
  // it would break BEFORE `mix`, pushing the whole container to page 1 — a
  // different page plan. The oracle settles it.
  it("padded container: block (marginBlockEnd) then HARD-wrapped run partial-fits at boundary", () => {
    const mix = createElementBox(
      "mix",
      { display: "block", paddingBlockEnd: 10 } as Style,
      [
        fixedBlock("blk", 10, { marginBlockEnd: 20 }),
        bareInlineRun("run", 4),
      ],
    );
    const root = cascadeRoot({ display: "block" }, [fixedBlock("spacer", 10), mix]);
    assertEquivalent(root, noMarginPageConfig(100));
  });

  it("padded container: block (marginBlockEnd) then SOFT-wrapped run partial-fits at boundary", () => {
    // Same shape with a soft-wrapping run (page inline 600 ⇒ 38 words/line at the
    // root content width, no inline padding on `mix`). 80 words ⇒ ceil(80/38)=
    // 3 lines? No — we need a partial fit of exactly 2 placed lines with a
    // genuine remainder, so size the run to >2 lines. floor((600+8)/16)=38
    // words/line ⇒ 80 words = 3 lines (38,38,4). With remaining 60 (90 − 30)
    // for the run, 3 lines (48) all fit — not a partial. Use a leading block
    // that leaves remaining for exactly a 2-line partial: blk 10 + margin 20 ⇒
    // run starts at 30 within mix, remaining 60 ⇒ floor(60/16)=3 lines would
    // fit; we need <total. 120 words ⇒ 4 lines (38×3+6) ⇒ 3 placed, resume@3.
    // consumed = 10+20+3×16 = 78; fixed partial = 78+0+10 = 88 ≤ 90; buggy =
    // 78+20+10 = 108 > 90. Boundary flips. (Soft path corroborates the hard one.)
    const mix = createElementBox(
      "mix",
      { display: "block", paddingBlockEnd: 10 } as Style,
      [
        fixedBlock("blk", 10, { marginBlockEnd: 20 }),
        softInlineRun("run", 120),
      ],
    );
    const root = cascadeRoot({ display: "block" }, [fixedBlock("spacer", 10), mix]);
    assertEquivalent(root, noMarginPageConfig(100, 600));
  });
});

// ---------------------------------------------------------------------------
// (k) AUTO-HYPHENATION: measure pass ↔ real layout equivalence when
// `hyphens: auto` is active. The mock every-3 hyphenator inserts algorithmic
// break points that change both the per-line word / fragment count AND the
// total line count of a paragraph, which in turn shifts page boundaries.
// A measure-pass implementation that ignores the hyphenator (or applies
// different break logic) will compute different line counts for the paragraph
// and therefore produce a DIFFERENT page plan than `layoutBlock` / `paginateRoot`
// — the exact #494/#498/#499 class of drift. These fixtures pin the
// measure ↔ oracle agreement when hyphenation is live.
// ---------------------------------------------------------------------------

describe("measure-pass equivalence — (k) auto-hyphenation", () => {
  // Fixture builder: one paragraph block with `hyphens: auto` + `language: "en"`,
  // filled with `wordCount` repetitions of "hyphenation" (11 chars each) joined
  // by spaces. Passing `hyphens` on the block propagates to the text node via
  // CASCADE (it is an inherited property), matching the styledTree pattern in
  // auto-hyphenation.test.ts.
  function hyphenParagraph(key: string, wordCount: number): ElementBox {
    const text = Array.from({ length: wordCount }, () => "hyphenation").join(" ");
    const textNode = createTextBox(`${key}-t`, {}, text);
    return createElementBox(
      key,
      { display: "block", hyphens: "auto", language: "en" } as Style,
      [textNode],
    );
  }

  it("auto-hyphenated paragraph spanning ≥2 pages (measure ↔ oracle agreement)", () => {
    // Geometry (mock shaper: 8px/char, 16px line height; every-3 hyphenator):
    //   pageInlineSize = 40 — forces hyphenation (at most ~4 chars + hyphen = 40px fit).
    //   "hyphenation" (11 chars) at 40px breaks into several hyphenated lines;
    //   4 repetitions × multi-line each ≫ pageBlockSize ⇒ multi-page fragmentation.
    //   pageBlockSize = 80 — fits 5 lines (5 × 16 = 80) ⇒ easily produces ≥2 pages.
    // The equivalence assertion is the primary guard: if buildBlockFitMetas produces
    // different line counts than layoutBlock (e.g. by omitting the hyphenator from
    // the IFC tokenizer), the break token chains diverge and the test fails.
    const hyphenator = createMockHyphenator({ every: 3 });
    const pageConfig = noMarginPageConfig(80, 40);
    const root = cascadeRoot({ display: "block" }, [hyphenParagraph("p", 4)]);

    // Guard 1: hyphenation actually fired in the non-fragmented layout.
    // Lay out the root against an essentially-infinite page to get all lines at
    // once, then walk into the paragraph's LineBoxes and assert at least one ends
    // with a hyphen continuation. Without this guard the fixture could silently
    // degenerate into a no-hyphenation document (e.g. if `hyphens`/`language`
    // were not threaded correctly), making the equivalence assertion vacuous.
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize);
    const contentCtx: LayoutContext = { ...ctx, containingInlineSize: pageConfig.pageInlineSize };
    const { box: rootBox } = layoutBlock(root, 0, 0, contentCtx, createMockShaper(8, 16), hyphenator, {
      availableBlockSize: 999999,
      pageIndex: 0,
      resumeFrom: null,
    });
    if (rootBox === null) throw new Error("layoutBlock returned a null root box");
    // The root box's first block child is the paragraph BlockBox; its children
    // are the line boxes produced by the IFC.
    const paragraphBoxes = rootBox.children.filter((c) => c.type === "block");
    expect(paragraphBoxes.length, "paragraph block found in root").toBeGreaterThan(0);
    const paragraphBox = nth(paragraphBoxes, 0, "paragraph block");
    if (paragraphBox.type !== "block") throw new Error("expected block");
    const lines = paragraphBox.children.filter((c): c is LineBox => c.type === "line");
    expect(lines.length, "paragraph produces at least one line").toBeGreaterThan(0);
    const hyphenLines = lines.filter((l) => l.endsWithHyphenContinuation === true);
    expect(hyphenLines.length, "at least one line ends with a hyphen continuation").toBeGreaterThan(0);

    // Guard 2: the paginated oracle spans ≥2 pages (fixture is non-trivial).
    // Checked implicitly by assertEquivalent's oracle pass; also asserted here
    // so a mis-tuned fixture (single page) surfaces with a clear message rather
    // than a vacuous equivalence pass.
    const oracle = runOracle(root, createMockShaper(8, 16), pageConfig, hyphenator);
    expect(oracle.pages.length, "document spans ≥2 pages under auto-hyphenation").toBeGreaterThanOrEqual(2);

    // Primary: measure ↔ oracle equivalence under the live hyphenator.
    assertEquivalent(root, pageConfig, hyphenator);
  });
});
