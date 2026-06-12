// packages/core/src/layout/__tests__/virtual-layout-tree.multicolumn.test.ts
//
// Multi-column wiring Task 5 — `materializePage` builds a `MultiColumnBox` for a
// multicol page. The measure pass (T1–T4) produces multicol page plans
// (`entry.columnConfig.columnCount > 1`, per-column `ColumnFit`, balanced
// height); T5 makes `getPage(i)` build the visual column boxes so multicol is
// observable.
//
// Geometry contract (the spec's §2 model): a 2-column page's body is a
// `MultiColumnBox` with `columns.length === 2`; each column `BlockBox` is
// `trackInlineSize = (bodyInlineSize − columnGap)/2` wide; column 0 sits at the
// page content inline-start, column 1 one (track + gap) further along; both share
// the body block-offset; the `MultiColumnBox.blockSize` is the balanced column
// height. A single-column page still gets a plain body `BlockBox` (byte-identical
// to today — the equivalence suite proves byte-identity at scale; this file just
// asserts a single-column page's body is NOT a MultiColumnBox).

import { describe, it, expect } from "vitest";
import { makeRootContext } from "../layout-context";
import { INITIAL_COMPUTED_STYLE } from "../../styles";
import { createMockShaper } from "../mock-shaper";
import { cascadePass } from "../../cascade";
import { createElementBox, createTextBox } from "../../render/render-node";
import type { ElementBox } from "../../render/render-node";
import type { Style } from "../../styles";
import type { BlockId } from "../../state";
import type { FootnoteAnchorRef } from "../../footnotes";
import type { PageConfig } from "../page-config";
import { buildBlockFitMetas } from "../build-fit-metas";
import { measurePass } from "../measure-pass";
import type { SectionPlan } from "../section-plan";
import { IMPLICIT_SECTION_PLAN } from "../section-plan";
import type { ColumnConfig } from "../column-config";
import { makeVirtualLayoutTree } from "../virtual-layout-tree";
import {
  resolveFootnotes,
  buildBlockToTopLevelIndex,
  footnoteAnchorPageAssignment,
  FOOTNOTE_SEPARATOR_HEIGHT,
} from "../resolve-footnotes";
import { flattenContents } from "../group-children";
import { getLineIndex } from "../../cursor/line-flatten";
import type { LayoutBox, MultiColumnBox, BlockBox } from "../layout-box";

function noMarginPageConfig(pageBlockSize: number, pageInlineSize = 600, pageGap = 20): PageConfig {
  return {
    pageInlineSize,
    pageBlockSize,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap,
  };
}

function marginedPageConfig(pageBlockSize: number, pageInlineSize = 600, pageGap = 20): PageConfig {
  return {
    pageInlineSize,
    pageBlockSize,
    pageMargins: { blockStart: 10, blockEnd: 10, inlineStart: 15, inlineEnd: 15 },
    pageGap,
  };
}

function cascadeRoot(rootStyle: Style, children: readonly ElementBox[]): ElementBox {
  const root = createElementBox("root", rootStyle, children);
  const cascaded = cascadePass(root);
  if (cascaded.type !== "element") throw new Error("cascadePass returned non-element");
  return cascaded;
}

function fixedBlock(key: string, blockSize: number): ElementBox {
  return createElementBox(key, { display: "block", blockSize } as Style, []);
}

/**
 * A text-bearing paragraph whose laid-out HEIGHT depends on line wrapping —
 * UNLIKE `fixedBlock`, which is width-immune. With `createMockShaper(8, 16)`
 * (8px/char, 16px/line), the text occupies fewer lines at the full content
 * inline width than at the narrow column-track width, so this block exercises
 * the measure-vs-materialize width drift (#494) that fixed-height blocks hide.
 */
function textBlock(key: string, text: string): ElementBox {
  return createElementBox(key, { display: "block" } as Style, [
    createTextBox(`${key}-t`, {}, text),
  ]);
}

/** A `SectionPlan` declaring an N-column doc-wide default (no per-section override). */
function columnSectionPlan(columnConfig: ColumnConfig): SectionPlan {
  return {
    boundaries: [{ startFlattenedIndex: 0, sectionId: null }],
    effectiveDefaultColumns: columnConfig,
  };
}

/** Build a `VirtualLayoutTree` for `root` under `sectionPlan` + `pageConfig`. */
function buildTree(root: ElementBox, pageConfig: PageConfig, sectionPlan: SectionPlan) {
  const pageContentInlineSize =
    pageConfig.pageInlineSize - pageConfig.pageMargins.inlineStart - pageConfig.pageMargins.inlineEnd;
  const shaper = createMockShaper(8, 16);
  const metas = buildBlockFitMetas(root, shaper, pageContentInlineSize);
  // Mirror `buildVirtualPaginatedTree` (virtual-producer.ts): pass the
  // track-width meta-builder closure so the multicol branch fits at the column
  // TRACK width, matching `materializePage`'s narrow-track layout (#494). The
  // closure is harmless for fixed-height / single-column content.
  const plan = measurePass(metas, pageConfig, sectionPlan, root.children, undefined, undefined, (w) =>
    buildBlockFitMetas(root, shaper, w),
  );
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize);
  const tree = makeVirtualLayoutTree(plan, root, ctx, createMockShaper(8, 16), pageConfig);
  return { plan, tree };
}

/** The page body box: the page's single content-area child. */
function bodyBoxOf(page: { readonly children: readonly LayoutBox[] }): LayoutBox {
  expect(page.children.length).toBe(1);
  return page.children[0];
}

describe("materializePage — multi-column body", () => {
  it("builds a MultiColumnBox with two equal-width, side-by-side columns", () => {
    // 8 fixed 50px blocks = 400px content; 2 columns; page body 200px → balanced
    // to 200px per column → 4 blocks each, splitting genuinely across both columns.
    const columnGap = 40;
    const pageConfig = noMarginPageConfig(200, 600);
    const root = cascadeRoot(
      { display: "block" },
      Array.from({ length: 8 }, (_, i) => fixedBlock(`b${i}`, 50)),
    );
    const columnRule = { width: 1, style: "solid" as const, color: "#000" };
    const { plan, tree } = buildTree(
      root,
      pageConfig,
      columnSectionPlan({ columnCount: 2, columnGap, columnRule }),
    );

    // The plan must be a single multicol page (sanity — the test geometry).
    expect(plan.entries.length).toBe(1);
    expect(plan.entries[0].columnConfig.columnCount).toBe(2);

    const page = tree.getPage(0);
    const body = bodyBoxOf(page);
    expect(body.type).toBe("multicolumn");
    const mc = body as MultiColumnBox;
    expect(mc.columns.length).toBe(2);
    // The section's column-rule is threaded onto the MultiColumnBox.
    expect(mc.columnRule).toEqual(columnRule);

    const bodyContentInlineStart = pageConfig.pageMargins.inlineStart; // 0
    const bodyInlineSize =
      pageConfig.pageInlineSize -
      pageConfig.pageMargins.inlineStart -
      pageConfig.pageMargins.inlineEnd; // 600
    const trackInlineSize = (bodyInlineSize - columnGap) / 2; // (600−40)/2 = 280

    // MultiColumnBox spans the full content inline width, at the content origin.
    expect(mc.inlineSize).toBe(bodyInlineSize);
    expect(mc.inlineOffset).toBe(bodyContentInlineStart);
    // Its blockSize is the BALANCED column height (entry.balancedColumnHeight),
    // NOT the full page body block-size — for this fully-fitting page they coincide
    // at 200, but we read the plan value to lock the contract.
    expect(mc.blockSize).toBe(plan.entries[0].balancedColumnHeight);

    const [col0, col1] = mc.columns;
    // Equal track widths.
    expect(col0.inlineSize).toBe(trackInlineSize);
    expect(col1.inlineSize).toBe(trackInlineSize);
    // Column offsets are RELATIVE to the MC box frame (#497): col 0 at 0, col 1 at
    // one (track + gap). (With this zero-margin page these also equal the absolute
    // values, but the contract is relative — see the margined test below.)
    expect(col0.inlineOffset).toBe(0);
    expect(col1.inlineOffset).toBe(trackInlineSize + columnGap);
    // Columns start at the MC box's top (block-offset 0 in the MC frame).
    expect(col0.blockOffset).toBe(0);
    expect(col1.blockOffset).toBe(0);

    // Content genuinely split across BOTH columns (neither empty).
    expect(col0.children.length).toBeGreaterThan(0);
    expect(col1.children.length).toBeGreaterThan(0);
  });

  it("honors page margins: column 0 at inlineStart, track widths off the content area", () => {
    const columnGap = 30;
    const pageConfig = marginedPageConfig(220, 600); // margins {bs:10,be:10,is:15,ie:15}
    const root = cascadeRoot(
      { display: "block" },
      Array.from({ length: 8 }, (_, i) => fixedBlock(`b${i}`, 50)),
    );
    const { plan, tree } = buildTree(
      root,
      pageConfig,
      columnSectionPlan({ columnCount: 2, columnGap, columnRule: null }),
    );

    const page = tree.getPage(0);
    const body = bodyBoxOf(page);
    expect(body.type).toBe("multicolumn");
    const mc = body as MultiColumnBox;

    const inlineStart = pageConfig.pageMargins.inlineStart; // 15
    const bodyInlineSize =
      pageConfig.pageInlineSize -
      pageConfig.pageMargins.inlineStart -
      pageConfig.pageMargins.inlineEnd; // 570
    const trackInlineSize = (bodyInlineSize - columnGap) / 2; // (570−30)/2 = 270

    // No rule configured on this section ⇒ the box carries `columnRule: null`.
    expect(mc.columnRule).toBeNull();
    // The MultiColumnBox itself sits at the page content origin (margin start).
    expect(mc.inlineOffset).toBe(inlineStart);
    expect(mc.inlineSize).toBe(bodyInlineSize);
    expect(mc.blockOffset).toBe(plan.entries[0].effectiveTopInset);
    // #497: the columns are positioned in the MultiColumnBox's OWN frame — the
    // paint renderer + line collector descend each column from the MC box's
    // absolute origin and ADD `col.inlineOffset`/`col.blockOffset`. So the columns
    // must store offsets RELATIVE to the MC box (col 0 at 0), NOT absolute page
    // coords — storing absolute here double-counted the page margin (the first
    // column rendered at 2× the inline margin + 2× the top inset).
    const [col0, col1] = mc.columns;
    expect(col0.inlineOffset).toBe(0);
    expect(col1.inlineOffset).toBe(trackInlineSize + columnGap);
    expect(col0.inlineSize).toBe(trackInlineSize);
    expect(col1.inlineSize).toBe(trackInlineSize);
    expect(col0.blockOffset).toBe(0);
    expect(col1.blockOffset).toBe(0);
    // The ABSOLUTE content edge is then mc.inlineOffset + col.inlineOffset.
    expect(mc.inlineOffset + col0.inlineOffset).toBe(inlineStart);
  });

  it("#497 behavior: a column-0 line's ABSOLUTE x is the page content edge (margined, not 2×)", () => {
    // End-to-end through the line collector (the consumer that feeds cursor /
    // hit-test / selection): with a NON-ZERO inline margin, column 0's lines must
    // land at the page content left edge (`inlineStart`), NOT double-counted at
    // `2 * inlineStart`. Uses TEXT blocks so real LineBoxes exist to collect.
    const columnGap = 30;
    const pageConfig = marginedPageConfig(400, 600); // margins {is:15, ...}
    const inlineStart = pageConfig.pageMargins.inlineStart; // 15
    const root = cascadeRoot(
      { display: "block" },
      Array.from({ length: 6 }, (_, i) => textBlock(`p${i}`, "alpha beta gamma delta epsilon")),
    );
    const { tree } = buildTree(
      root,
      pageConfig,
      columnSectionPlan({ columnCount: 2, columnGap, columnRule: null }),
    );

    const page = tree.getPage(0);
    // Partition lines into the LEFT column GEOMETRICALLY by absoluteX within the
    // column-0 box's inline range (col1's track sits a full (track + gap) further
    // along), exactly how the column-aware hit-test picks a column.
    const body = bodyBoxOf(page);
    if (body.type !== "multicolumn") throw new Error("expected a MultiColumnBox body");
    const col0 = body.columns[0];
    const col0Lines = getLineIndex(page).all.filter(
      (l) => l.absoluteX >= col0.x && l.absoluteX < col0.x + col0.width,
    );
    expect(col0Lines.length).toBeGreaterThan(0);
    // Every column-0 line starts at the page content left edge — exactly the inline
    // margin, not twice it (the #497 double-count would have put it at 2×15 = 30).
    for (const line of col0Lines) {
      expect(line.absoluteX).toBe(inlineStart);
    }
  });

  it("a single-column page keeps a plain body BlockBox (NOT a MultiColumnBox)", () => {
    const pageConfig = noMarginPageConfig(200, 600);
    const root = cascadeRoot(
      { display: "block" },
      Array.from({ length: 6 }, (_, i) => fixedBlock(`b${i}`, 50)),
    );
    // IMPLICIT_SECTION_PLAN's effectiveDefaultColumns is the 1-column default.
    const { tree } = buildTree(root, pageConfig, IMPLICIT_SECTION_PLAN);

    const page = tree.getPage(0);
    const body = bodyBoxOf(page);
    expect(body.type).toBe("block");
    // A single-column body is a plain BlockBox, which has no columnRule field.
    expect((body as { columnRule?: unknown }).columnRule).toBeUndefined();
    const block = body as BlockBox;
    // The whole-page-width single column body (byte-identical to today).
    expect(block.inlineSize).toBe(600);
  });

  it("text-bearing blocks: measure fits at the column TRACK width, not full content width (#494)", () => {
    // REGRESSION (#494): the measure pass formerly built its fit metas at the
    // FULL page-content inline width while materialize laid each column at the
    // narrow TRACK width. For text whose line-count depends on width, the two
    // disagreed → `materializePage`'s dev-only break-token assertion threw
    // ("measure-vs-materialize drift"). The fix builds the multicol metas at the
    // track width so the planned ColumnFit matches the narrow-track layout.
    //
    // Geometry (mock shaper: 8px/char, 16px/line):
    //   • 600px content, 2 cols, 40px gap → track = (600−40)/2 = 280px → 35 chars/line.
    //   • Each paragraph is 55 chars → 1 line (16px) at full 600px width
    //     (75 chars/line), but 2 lines (32px) at the 280px track (35 chars/line).
    //     The two widths genuinely diverge, so a full-width measure would
    //     mis-plan the per-column distribution.
    const columnGap = 40;
    const pageConfig = noMarginPageConfig(200, 600);
    const paraText = "The quick brown fox jumps over the lazy sleeping doggo.";
    // Sanity-pin the wrapping math: 1 line at 600px, 2 lines at the 280px track.
    expect(paraText.length).toBeGreaterThan(35);
    expect(paraText.length).toBeLessThanOrEqual(75);
    const root = cascadeRoot(
      { display: "block" },
      Array.from({ length: 8 }, (_, i) => textBlock(`p${i}`, paraText)),
    );

    const { plan, tree } = buildTree(
      root,
      pageConfig,
      columnSectionPlan({ columnCount: 2, columnGap, columnRule: null }),
    );
    expect(plan.entries[0].columnConfig.columnCount).toBe(2);

    // The crash: `getPage(0)` materializes the multicol body and asserts each
    // column's break token equals the measure pass's planned ColumnFit. Before
    // the fix this threw the "measure-vs-materialize drift" error.
    const page = tree.getPage(0);
    const body = bodyBoxOf(page);
    expect(body.type).toBe("multicolumn");
    const mc = body as MultiColumnBox;
    expect(mc.columns.length).toBe(2);

    // GEOMETRY: each laid-out paragraph reflects the NARROW-track (2-line, 32px)
    // height, NOT the full-width (1-line, 16px) height — i.e. the column content
    // was wrapped at the track width, the correct geometry.
    const para = mc.columns[0].children[0] as BlockBox;
    expect(para.blockSize).toBe(32);
  });

  it("#498: a 2-col section's BALANCED final page with an EMPTY trailing column materializes without drift", () => {
    // REGRESSION (#498): a 2-column section spanning ≥3 pages whose FINAL page is a
    // CONTINUATION page (column 0 resumes from a partial IFC fragment carried off
    // the prior page) AND balances so short that all the remaining content fits in
    // ONE column — leaving column 1 EMPTY (`childrenCount: 0`).
    //
    // The crash: an empty trailing column's planned `resumeInto` was `null`, but
    // materialize seeds each column's `layoutBlock` SOLELY from `resumeInto`, where
    // `null` means "start fresh from child index 0". So materialize re-laid the
    // WHOLE document from index 0 at the short balanced height, producing a non-null
    // overflow break token that disagreed with the planned empty `resumeOut: null`
    // → `getPage`'s dev-only break-token assertion threw "measure-vs-materialize
    // drift" on COLUMN 1. (The bug only surfaced on a CONTINUATION page: on a fresh
    // page the empty column's start index IS 0, so `null` happened to be correct.)
    //
    // Geometry (mock shaper 8px/char, 16px/line):
    //   • 600px content, 2 cols, 40px gap → track = (600−40)/2 = 280px → 35 chars/line.
    //   • body = 64px = 4 lines per column. Each paragraph wraps to several lines at
    //     the 280px track, so paragraphs SPLIT across page/column boundaries.
    //   • 5 paragraphs span 3 pages; the final page (startIndex=4) balances to ~48px,
    //     fitting the remainder in column 0 alone → column 1 is empty.
    const columnGap = 40;
    const pageConfig = noMarginPageConfig(64, 600);
    const paraText =
      "The quick brown fox jumps over the lazy sleeping doggo and then keeps on running.";
    const root = cascadeRoot(
      { display: "block" },
      Array.from({ length: 5 }, (_, i) => textBlock(`p${i}`, paraText)),
    );

    const { plan, tree } = buildTree(
      root,
      pageConfig,
      columnSectionPlan({ columnCount: 2, columnGap, columnRule: null }),
    );

    // Sanity-pin the reproducing geometry: a ≥3-page multicol plan whose LAST page
    // is a balanced continuation (startIndex > 0, balancedColumnHeight < body) with
    // an EMPTY trailing column — exactly the crash's shape.
    expect(plan.entries.length).toBeGreaterThanOrEqual(3);
    const lastEntry = plan.entries[plan.entries.length - 1];
    expect(lastEntry.columnConfig.columnCount).toBe(2);
    expect(lastEntry.startIndex).toBeGreaterThan(0);
    expect(lastEntry.balancedColumnHeight).toBeLessThan(64);
    expect(lastEntry.columnFit?.columns[1].childrenCount).toBe(0); // column 1 EMPTY

    // The crash: materializing the balanced CONTINUATION page. Before the fix this
    // threw "measure-vs-materialize drift" on the empty column 1.
    const lastPageIndex = plan.entries.length - 1;
    const lastPage = tree.getPage(lastPageIndex);
    const lastBody = bodyBoxOf(lastPage);
    expect(lastBody.type).toBe("multicolumn");
    const mc = lastBody as MultiColumnBox;
    expect(mc.columns.length).toBe(2);
    // The remainder lands in column 0; column 1 is the empty (zero-children) box.
    expect(mc.columns[0].children.length).toBeGreaterThan(0);
    expect(mc.columns[1].children.length).toBe(0);
  });
});

// ===========================================================================
// #499 — a footnote anchored in a MULTI-COLUMN section. The footnote-resolution
// pass (`resolveFootnotes`) re-fits the page's columns; before the fix it built
// its fit metas at the FULL page-content width while `materializePage` lays each
// column at the narrow TRACK width → the planned `ColumnFit.resumeOut`
// disagreed with materialize's per-column break token → the dev-mode
// "measure-vs-materialize drift" throw (silent content corruption in prod).
// This is the #494 drift class, but in the footnote pass — which never received
// the track-width `buildMetasAtWidth` builder. The test drives the FULL
// measure → resolveFootnotes → makeVirtualLayoutTree → getPage path in dev mode.
// ===========================================================================

const FN_MOCK_SHAPER = createMockShaper(8, 16); // 8px/char, 16px/line.

/** A footnote body: a container holding `lines` single-line paragraphs. */
function fnBody(key: string, lines: number): ElementBox {
  return createElementBox(
    key,
    { display: "block" } as Style,
    Array.from({ length: lines }, (_, i) => textBlock(`${key}-p${i}`, "x")),
  );
}

/**
 * Build a `VirtualLayoutTree` through the FULL footnote pipeline: measure pass
 * (track-width metas) → `resolveFootnotes` (the pass under test) →
 * `makeVirtualLayoutTree`. Mirrors `buildVirtualPaginatedTree`'s wiring (the
 * production producer) but lets the test supply a 2-column `SectionPlan` and
 * footnote anchors directly.
 */
function buildTreeWithFootnotes(
  root: ElementBox,
  pageConfig: PageConfig,
  sectionPlan: SectionPlan,
  bodies: ReadonlyMap<string, ElementBox>,
  anchors: readonly FootnoteAnchorRef[],
) {
  const pageContentInlineSize =
    pageConfig.pageInlineSize - pageConfig.pageMargins.inlineStart - pageConfig.pageMargins.inlineEnd;
  const shaper = FN_MOCK_SHAPER;
  // Mirror the producer wiring (virtual-producer.ts): flatten `display: contents`
  // wrappers before handing rootChildren to measurePass / resolveFootnotes.
  const rootChildren = flattenContents(root.children);
  const metas = buildBlockFitMetas(root, shaper, pageContentInlineSize);
  const buildMetasAtWidth = (w: number) => buildBlockFitMetas(root, shaper, w);
  const rawPlan = measurePass(
    metas, pageConfig, sectionPlan, rootChildren, undefined, undefined, buildMetasAtWidth,
  );

  const cascadedEmbedContents = new Map<BlockId, ElementBox>();
  for (const [id, body] of bodies) {
    const c = cascadePass(body);
    if (c.type !== "element") throw new Error("cascadePass returned non-element");
    cascadedEmbedContents.set(id as BlockId, c);
  }

  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize);
  // The pass under test: re-fit footnote pages. The LAST arg is the #499 fix —
  // the track-width meta builder so multicol footnote pages plan at the narrow
  // width `materializePage` lays each column at.
  const plan = resolveFootnotes(
    rawPlan, metas, sectionPlan, rootChildren,
    cascadedEmbedContents, anchors, ctx, shaper, undefined, pageConfig,
    undefined, new Map(), buildMetasAtWidth,
  );

  // Per-anchor page assignment (footnoteAnchorPages), as the producer computes it.
  const blockToIndex = buildBlockToTopLevelIndex(rootChildren);
  const footnoteAnchorPages = footnoteAnchorPageAssignment(anchors, plan, blockToIndex);

  const tree = makeVirtualLayoutTree(
    plan, root, ctx, shaper, pageConfig, undefined, new Map(),
    cascadedEmbedContents, rawPlan, footnoteAnchorPages,
  );
  return { rawPlan, plan, tree };
}

describe("#499 — footnote anchored in a multi-column section", () => {
  it("materializes the multicol footnote page without measure-vs-materialize drift", () => {
    // 2-column section; a TEXT-bearing paragraph tall enough to distribute across
    // BOTH columns, with ONE footnote anchored in it. The footnote slot reduces
    // the body height, so `resolveFootnotes` RE-FITS the columns — at the narrow
    // TRACK width (#499 fix), matching `materializePage`'s narrow-track layout.
    //
    // Geometry (mock shaper 8px/char, 16px/line):
    //   • 600px content, 2 cols, 40px gap → track = (600−40)/2 = 280px → 35 chars/line.
    //   • Each paragraph is 55 chars → 1 line (16px) at full 600px width,
    //     but 2 lines (32px) at the 280px track. A full-width measure would
    //     MIS-PLAN the per-column distribution and drift on materialize.
    const columnGap = 40;
    const pageConfig = noMarginPageConfig(200, 600);
    const paraText = "The quick brown fox jumps over the lazy sleeping doggo.";
    expect(paraText.length).toBeGreaterThan(35);
    expect(paraText.length).toBeLessThanOrEqual(75);
    // 6 paragraphs so the body genuinely distributes across both columns.
    const root = cascadeRoot(
      { display: "block" },
      Array.from({ length: 6 }, (_, i) => textBlock(`p${i}`, paraText)),
    );

    const bodies = new Map<string, ElementBox>([["fn0", fnBody("fn0", 1)]]);
    // Anchor in the FIRST paragraph (top-level child key "p0").
    const anchors: FootnoteAnchorRef[] = [
      { blockId: "p0" as BlockId, contentBlockId: "fn0" as BlockId, sectionId: null },
    ];

    const { plan, tree } = buildTreeWithFootnotes(
      root,
      pageConfig,
      columnSectionPlan({ columnCount: 2, columnGap, columnRule: null }),
      bodies,
      anchors,
    );

    // The footnote landed on page 0 and reserved a slot there.
    expect(plan.entries[0].columnConfig.columnCount).toBe(2);
    expect(plan.entries[0].footnoteContentBlockIds).toEqual(["fn0" as BlockId]);
    expect(plan.entries[0].footnoteSlotHeight).toBe(16 + FOOTNOTE_SEPARATOR_HEIGHT);

    // THE CRASH: materializing the multicol footnote page asserts each column's
    // break token equals the measure pass's planned ColumnFit. Before the #499
    // fix this threw the "measure-vs-materialize drift" error on a column.
    const page = tree.getPage(0);
    const body = bodyBoxOf(page);
    expect(body.type).toBe("multicolumn");
    const mc = body as MultiColumnBox;
    expect(mc.columns.length).toBe(2);
    // The body genuinely distributed across BOTH columns (neither empty).
    expect(mc.columns[0].children.length).toBeGreaterThan(0);
    expect(mc.columns[1].children.length).toBeGreaterThan(0);
    // GEOMETRY: each laid-out paragraph reflects the NARROW-track (2-line, 32px)
    // height — the column content was wrapped at the track width, not full width.
    const para = mc.columns[0].children[0] as BlockBox;
    expect(para.blockSize).toBe(32);

    // The footnote slot is present on page 0.
    expect(page.footnoteSlot).not.toBeNull();
  });

  it("materializes a NON-FINAL multicol footnote page (fitBody re-fit path) without drift", () => {
    // Exercises the `fitBody` multicol branch directly (NOT the final-page balance
    // block): a 2-column section spanning ≥2 pages whose FIRST page carries the
    // footnote. A non-final page's columns are NOT balanced — its materialized
    // `ColumnFit` comes straight from `resolveFootnotes`'s `fitBody`, so the
    // track-width `colMetas` substitution there is what keeps it drift-free.
    //
    // Geometry (mock shaper 8px/char, 16px/line):
    //   • 600px content, 2 cols, 40px gap → track = (600−40)/2 = 280px → 35 chars/line.
    //   • body = 64px = 4 lines per column. Each 55-char paragraph wraps to 2 lines
    //     at the 280px track, so paragraphs distribute + SPLIT across the columns.
    //   • Many paragraphs ⇒ a multi-page section; the footnote on p0 lands on the
    //     FIRST (non-final, overflowing) page.
    const columnGap = 40;
    const pageConfig = noMarginPageConfig(64, 600);
    const paraText = "The quick brown fox jumps over the lazy sleeping doggo.";
    const root = cascadeRoot(
      { display: "block" },
      Array.from({ length: 12 }, (_, i) => textBlock(`q${i}`, paraText)),
    );

    const bodies = new Map<string, ElementBox>([["fnA", fnBody("fnA", 1)]]);
    const anchors: FootnoteAnchorRef[] = [
      { blockId: "q0" as BlockId, contentBlockId: "fnA" as BlockId, sectionId: null },
    ];

    const { plan, tree } = buildTreeWithFootnotes(
      root,
      pageConfig,
      columnSectionPlan({ columnCount: 2, columnGap, columnRule: null }),
      bodies,
      anchors,
    );

    // Multi-page multicol section; the footnote is on the FIRST page, which is NOT
    // the section's final page (so it takes the `fitBody` path, not balance).
    expect(plan.entries.length).toBeGreaterThanOrEqual(2);
    expect(plan.entries[0].columnConfig.columnCount).toBe(2);
    expect(plan.entries[0].footnoteContentBlockIds).toEqual(["fnA" as BlockId]);
    // First page overflows (resumes into the next) — a non-final, non-balanced page.
    expect(plan.entries[0].resumeOut).not.toBeNull();

    // THE CRASH path (fitBody): materialize page 0. Drift here would throw.
    const page = tree.getPage(0);
    const body = bodyBoxOf(page);
    expect(body.type).toBe("multicolumn");
    const mc = body as MultiColumnBox;
    expect(mc.columns.length).toBe(2);
    expect(mc.columns[0].children.length).toBeGreaterThan(0);
    expect(mc.columns[1].children.length).toBeGreaterThan(0);
    expect(page.footnoteSlot).not.toBeNull();
  });
});
