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
import { createElementBox } from "../../render/render-node";
import type { ElementBox } from "../../render/render-node";
import type { Style } from "../../styles";
import type { PageConfig } from "../page-config";
import { buildBlockFitMetas } from "../build-fit-metas";
import { measurePass } from "../measure-pass";
import type { SectionPlan } from "../section-plan";
import { IMPLICIT_SECTION_PLAN } from "../section-plan";
import type { ColumnConfig } from "../column-config";
import { makeVirtualLayoutTree } from "../virtual-layout-tree";
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
  const plan = measurePass(metas, pageConfig, sectionPlan, root.children);
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
    const { plan, tree } = buildTree(
      root,
      pageConfig,
      columnSectionPlan({ columnCount: 2, columnGap, columnRule: null }),
    );

    // The plan must be a single multicol page (sanity — the test geometry).
    expect(plan.entries.length).toBe(1);
    expect(plan.entries[0].columnConfig.columnCount).toBe(2);

    const page = tree.getPage(0);
    const body = bodyBoxOf(page);
    expect(body.type).toBe("multicolumn");
    const mc = body as MultiColumnBox;
    expect(mc.columns.length).toBe(2);

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
    // Side-by-side inline offsets.
    expect(col0.inlineOffset).toBe(bodyContentInlineStart);
    expect(col1.inlineOffset).toBe(bodyContentInlineStart + trackInlineSize + columnGap);
    // Both columns share the body block-offset (the page's effective top inset = 0).
    expect(col0.blockOffset).toBe(mc.blockOffset);
    expect(col1.blockOffset).toBe(mc.blockOffset);

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

    expect(mc.inlineOffset).toBe(inlineStart);
    expect(mc.inlineSize).toBe(bodyInlineSize);
    const [col0, col1] = mc.columns;
    expect(col0.inlineOffset).toBe(inlineStart);
    expect(col1.inlineOffset).toBe(inlineStart + trackInlineSize + columnGap);
    expect(col0.inlineSize).toBe(trackInlineSize);
    expect(col1.inlineSize).toBe(trackInlineSize);
    // Body block-offset is the effective top inset (the page margin blockStart).
    expect(mc.blockOffset).toBe(plan.entries[0].effectiveTopInset);
    expect(col0.blockOffset).toBe(mc.blockOffset);
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
    const block = body as BlockBox;
    // The whole-page-width single column body (byte-identical to today).
    expect(block.inlineSize).toBe(600);
  });
});
