// packages/core/src/layout/__tests__/virtual-layout-tree.test.ts
//
// THE ORACLE (virtualized-layout Phase 2). `paginateRoot` is ground truth.
// For a multi-page cascaded doc we build a `VirtualLayoutTree` from
// `measurePass` of the same root and assert that positioning each page
// independently (`getPage(i)`, seeded from the plan's resume token — NOT from
// the sequential previous-page break) deep-equals `paginateRoot`'s page `i`.
// `materializeAll()` must deep-equal the whole `paginateRoot` tree.
//
// Carry-forward memo (Task 4): an unchanged page in a new tree returns the
// prior tree's already-materialized PageBox BY REFERENCE; a changed page (or a
// width change) does not.
//
// "materializes only requested pages" guard (Task 5): building a 20-page tree
// and calling only getPage(19) triggers exactly ONE per-page layoutBlock driver
// invocation, not 20.

import { describe, it, expect, beforeEach } from "vitest";
import { paginateRoot } from "../paginate";
import { makeRootContext } from "../layout-context";
import { INITIAL_COMPUTED_STYLE } from "../../styles";
import { createMockShaper } from "../mock-shaper";
import { cascadePass } from "../../cascade";
import { createElementBox, createTextBox } from "../../render/render-node";
import type { ElementBox } from "../../render/render-node";
import type { Style } from "../../styles";
import type { PageConfig } from "../page-config";
import { buildBlockFitMetas } from "../build-fit-metas";
import { measurePass } from "../measure-pass";
import type { PagePlan, PagePlanEntry } from "../measure-pass";
import {
  makeVirtualLayoutTree,
  __getGetPageDriverCountForTest,
  __resetGetPageDriverCountForTest,
} from "../virtual-layout-tree";

// ---------------------------------------------------------------------------
// Fixture builders (mirror measure-pass-equivalence.test.ts).
// ---------------------------------------------------------------------------

function noMarginPageConfig(pageBlockSize: number, pageInlineSize = 600, pageGap = 20): PageConfig {
  return {
    pageInlineSize,
    pageBlockSize,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap,
  };
}

/** A page config WITH non-zero margins (exercises the content-area inset path). */
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

function fixedBlock(key: string, blockSize: number, extra?: Partial<Style>): ElementBox {
  return createElementBox(key, { display: "block", blockSize, ...(extra ?? {}) } as Style, []);
}

function paragraph(key: string, numLines: number, extra?: Partial<Style>): ElementBox {
  const text = Array.from({ length: numLines }, () => "x").join("\n");
  const textNode = createTextBox(`${key}-t`, { whiteSpace: "pre" }, text);
  return createElementBox(key, { display: "block", whiteSpace: "pre", ...(extra ?? {}) } as Style, [textNode]);
}

/** `count` single-line ordered-list items, each a top-level block child. */
function listItems(count: number, keyPrefix = "li"): ElementBox[] {
  return Array.from({ length: count }, (_, i) => {
    const text = createTextBox(`${keyPrefix}-t-${i}`, { whiteSpace: "pre" }, "x");
    return createElementBox(`${keyPrefix}-${i}`, { display: "list-item", whiteSpace: "pre" } as Style, [text]);
  });
}

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

// ---------------------------------------------------------------------------
// Shared build helpers.
// ---------------------------------------------------------------------------

function buildPlanAndTree(root: ElementBox, pageConfig: PageConfig) {
  const pageContentInlineSize =
    pageConfig.pageInlineSize - pageConfig.pageMargins.inlineStart - pageConfig.pageMargins.inlineEnd;
  const shaper = createMockShaper(8, 16);
  const metas = buildBlockFitMetas(root, shaper, pageContentInlineSize);
  const plan = measurePass(metas, pageConfig, root.children);
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize);
  const tree = makeVirtualLayoutTree(plan, root, ctx, createMockShaper(8, 16), pageConfig);
  return { plan, tree };
}

function runPaginate(root: ElementBox, pageConfig: PageConfig) {
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize);
  return paginateRoot(root, ctx, createMockShaper(8, 16), pageConfig);
}

interface Fixture {
  readonly name: string;
  readonly root: ElementBox;
  readonly pageConfig: PageConfig;
}

function fixtures(): readonly Fixture[] {
  return [
    {
      name: "leaf paragraphs multi-page",
      root: cascadeRoot({ display: "block" }, Array.from({ length: 10 }, (_, i) => fixedBlock(`b${i}`, 100))),
      pageConfig: noMarginPageConfig(300),
    },
    {
      name: "leaf paragraphs multi-page (with margins)",
      root: cascadeRoot({ display: "block" }, Array.from({ length: 8 }, (_, i) => fixedBlock(`b${i}`, 100))),
      pageConfig: marginedPageConfig(300),
    },
    {
      name: "spanning paragraph",
      root: cascadeRoot({ display: "block" }, [paragraph("p", 20)]),
      pageConfig: noMarginPageConfig(100),
    },
    {
      name: "paragraph + following block across boundary",
      root: cascadeRoot({ display: "block" }, [paragraph("p", 12), fixedBlock("b", 60)]),
      pageConfig: noMarginPageConfig(100),
    },
    {
      name: "table spanning pages",
      root: cascadeRoot({ display: "block" }, [tableOf(8, 30)]),
      pageConfig: noMarginPageConfig(100),
    },
    {
      name: "nested container (blockquote) spanning pages",
      root: (() => {
        const quote = createElementBox("quote", { display: "block" } as Style, [
          paragraph("q0", 4),
          paragraph("q1", 4),
          paragraph("q2", 4),
          paragraph("q3", 4),
        ]);
        return cascadeRoot({ display: "block" }, [quote]);
      })(),
      pageConfig: noMarginPageConfig(100),
    },
    {
      name: "ordered list spanning pages (cross-page numbering)",
      root: (() => {
        const items = Array.from({ length: 8 }, (_, i) => {
          const text = createTextBox(`li-t-${i}`, { whiteSpace: "pre" }, "x");
          return createElementBox(`li-${i}`, { display: "list-item", whiteSpace: "pre" } as Style, [text]);
        });
        const list = createElementBox("ol", { display: "block" } as Style, items);
        return cascadeRoot({ display: "block" }, [list]);
      })(),
      pageConfig: noMarginPageConfig(50),
    },
  ];
}

// ---------------------------------------------------------------------------
// Task 2: getPage(i) ≡ paginateRoot's page i
// ---------------------------------------------------------------------------

describe("VirtualLayoutTree — getPage(i) deep-equals paginateRoot's page i", () => {
  for (const fx of fixtures()) {
    it(fx.name, () => {
      const paginated = runPaginate(fx.root, fx.pageConfig);
      const { tree } = buildPlanAndTree(fx.root, fx.pageConfig);
      expect(tree.plan.entries.length).toBe(paginated.children.length);
      for (let i = 0; i < paginated.children.length; i++) {
        const oraclePage = paginated.children[i];
        const virtualPage = tree.getPage(i);
        expect(virtualPage, `page ${i}`).toEqual(oraclePage);
      }
    });
  }

  it("getPage memoizes by index (same ref on repeat call)", () => {
    const fx = fixtures()[0];
    const { tree } = buildPlanAndTree(fx.root, fx.pageConfig);
    expect(tree.getPage(0)).toBe(tree.getPage(0));
    expect(tree.getPage(2)).toBe(tree.getPage(2));
  });

  it("inlineSize / blockSize come from the plan", () => {
    const fx = fixtures()[0];
    const { plan, tree } = buildPlanAndTree(fx.root, fx.pageConfig);
    expect(tree.inlineSize).toBe(plan.pageInlineSize);
    expect(tree.blockSize).toBe(plan.totalBlockSize);
  });

  it("getPages(from, to) is inclusive and clamped", () => {
    const fx = fixtures()[0]; // 4 pages
    const { tree } = buildPlanAndTree(fx.root, fx.pageConfig);
    const pages = tree.getPages(1, 2);
    expect(pages.length).toBe(2);
    expect(pages[0]).toBe(tree.getPage(1));
    expect(pages[1]).toBe(tree.getPage(2));
    // Clamp out-of-range.
    const clamped = tree.getPages(-5, 999);
    expect(clamped.length).toBe(tree.plan.entries.length);
    expect(clamped[0]).toBe(tree.getPage(0));
  });

  it("type discriminant is virtual-root", () => {
    const fx = fixtures()[0];
    const { tree } = buildPlanAndTree(fx.root, fx.pageConfig);
    expect(tree.type).toBe("virtual-root");
  });

  it("getPage throws for out-of-range indices", () => {
    const fx = fixtures()[0];
    const { tree } = buildPlanAndTree(fx.root, fx.pageConfig);
    expect(() => tree.getPage(tree.plan.entries.length)).toThrow();
    expect(() => tree.getPage(-1)).toThrow();
  });

  it("internal carry-forward hooks are non-enumerable (not exposed by Object.keys)", () => {
    const fx = fixtures()[0];
    const { tree } = buildPlanAndTree(fx.root, fx.pageConfig);
    const keys = Object.keys(tree);
    expect(keys).not.toContain("__peekMaterializedPage");
    expect(keys).not.toContain("__fingerprintAt");
  });
});

// ---------------------------------------------------------------------------
// Task 3: materializeAll() ≡ paginateRoot's whole tree
// ---------------------------------------------------------------------------

describe("VirtualLayoutTree — materializeAll() deep-equals paginateRoot", () => {
  for (const fx of fixtures()) {
    it(fx.name, () => {
      const paginated = runPaginate(fx.root, fx.pageConfig);
      const { tree } = buildPlanAndTree(fx.root, fx.pageConfig);
      expect(tree.materializeAll()).toEqual(paginated);
    });
  }
});

// ---------------------------------------------------------------------------
// Task 4: carry-forward memo
// ---------------------------------------------------------------------------

describe("VirtualLayoutTree — carry-forward memo", () => {
  it("unchanged trailing pages reused by reference; edited page is not", () => {
    // 10 fixed blocks of 100, 3/page ⇒ 4 pages. Edit page 0's first block
    // (change its blockSize) — only page 0's child refs change; pages 1–3 keep
    // identical child refs + resume tokens, so they carry forward by reference.
    const pageConfig = noMarginPageConfig(300);
    const childrenA = Array.from({ length: 10 }, (_, i) => fixedBlock(`b${i}`, 100));
    const rootA = cascadeRoot({ display: "block" }, childrenA);
    const { tree: treeA } = buildPlanAndTree(rootA, pageConfig);
    // Force all pages materialized.
    for (let i = 0; i < treeA.plan.entries.length; i++) treeA.getPage(i);

    // Tree B: page 0's first block is edited (a fresh CASCADED ref, same key +
    // same size so the page geometry is unchanged) while blocks 1..9 reuse
    // treeA's exact cascaded refs — so pages 1–3's fingerprints are identical
    // and carry forward; page 0's children-ref fingerprint differs.
    const editedRoot = cascadeRoot({ display: "block" }, [fixedBlock("b0", 100)]);
    const editedB0 = editedRoot.children[0]; // freshly cascaded ⇒ new ref
    expect(editedB0).not.toBe(rootA.children[0]);
    const sharedChildren = [editedB0, ...rootA.children.slice(1)];
    const rootBShared: ElementBox = {
      type: "element",
      key: rootA.key,
      style: rootA.style,
      computedStyle: rootA.computedStyle,
      children: Object.freeze(sharedChildren),
    };
    const pcis = pageConfig.pageInlineSize - pageConfig.pageMargins.inlineStart - pageConfig.pageMargins.inlineEnd;
    const metasB = buildBlockFitMetas(rootBShared, createMockShaper(8, 16), pcis);
    const planB = measurePass(metasB, pageConfig, rootBShared.children);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize);
    const treeB = makeVirtualLayoutTree(planB, rootBShared, ctx, createMockShaper(8, 16), pageConfig, treeA);

    // Page 0 changed (fresh first-child ref) ⇒ NOT reused.
    expect(treeB.getPage(0)).not.toBe(treeA.getPage(0));
    // Pages 1–3 unchanged ⇒ reused by reference.
    for (let k = 1; k < treeB.plan.entries.length; k++) {
      expect(treeB.getPage(k), `page ${k} carry-forward`).toBe(treeA.getPage(k));
    }
  });

  it("a page whose pageInlineSize changed is NOT reused (width-change guard)", () => {
    const childrenA = Array.from({ length: 6 }, (_, i) => fixedBlock(`b${i}`, 100));
    const rootA = cascadeRoot({ display: "block" }, childrenA);
    const cfgA = noMarginPageConfig(300, 600);
    const { tree: treeA } = buildPlanAndTree(rootA, cfgA);
    for (let i = 0; i < treeA.plan.entries.length; i++) treeA.getPage(i);

    // Tree B: SAME children refs, but wider page. pageInlineSize is in the
    // fingerprint ⇒ no carry-forward.
    const cfgB = noMarginPageConfig(300, 800);
    const rootBShared: ElementBox = {
      type: "element",
      key: rootA.key,
      style: rootA.style,
      computedStyle: rootA.computedStyle,
      children: rootA.children,
    };
    const pcis = cfgB.pageInlineSize - cfgB.pageMargins.inlineStart - cfgB.pageMargins.inlineEnd;
    const metasB = buildBlockFitMetas(rootBShared, createMockShaper(8, 16), pcis);
    const planB = measurePass(metasB, cfgB, rootBShared.children);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, cfgB.pageInlineSize);
    const treeB = makeVirtualLayoutTree(planB, rootBShared, ctx, createMockShaper(8, 16), cfgB, treeA);

    for (let k = 0; k < treeB.plan.entries.length; k++) {
      expect(treeB.getPage(k), `page ${k} width-change`).not.toBe(treeA.getPage(k));
    }
  });

  it("a later page whose listCounterAtStart changed is NOT reused (list-seed guard)", () => {
    // An ordered list (list-items as top-level children) spanning 3 pages, 3
    // items/page. listCounterAtStart per page is 0, 3, 6 — so an upstream edit
    // that adds/removes a leading item shifts every LATER page's marker
    // numbering even when that page's child refs + resume tokens are unchanged.
    // The fingerprint includes listCounterAtStart precisely to defeat reuse in
    // that case; this test proves the guard actually fires.
    const pageConfig = noMarginPageConfig(50, 600);
    const rootA = cascadeRoot({ display: "block" }, listItems(8));
    const { plan: planA, tree: treeA } = buildPlanAndTree(rootA, pageConfig);
    // Sanity: the list really does span >2 pages with distinct seeds.
    expect(planA.entries.length).toBeGreaterThanOrEqual(3);
    expect(planA.entries[1].listCounterAtStart).not.toBe(planA.entries[0].listCounterAtStart);
    // Force all pages materialized so carry-forward has candidates to reuse.
    for (let i = 0; i < planA.entries.length; i++) treeA.getPage(i);

    // Tree B's plan = tree A's plan with ONE LATER entry's listCounterAtStart
    // bumped; every other field (children refs, resume tokens, blockOffset,
    // dimensions) is byte-for-byte identical. Built against the SAME rootA so
    // the cascaded child references match — the only fingerprint delta is the
    // bumped list seed on the changed page.
    const changedPage = planA.entries.length - 1; // a LATER page
    const entriesB: PagePlanEntry[] = planA.entries.map((e) =>
      e.pageIndex === changedPage
        ? { ...e, listCounterAtStart: e.listCounterAtStart + 1 }
        : e,
    );
    const planB: PagePlan = {
      entries: entriesB,
      totalBlockSize: planA.totalBlockSize,
      pageInlineSize: planA.pageInlineSize,
      pageIndexAtBlockOffset: planA.pageIndexAtBlockOffset.bind(planA),
      pageIndexOfBlock: planA.pageIndexOfBlock.bind(planA),
    };
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize);
    const treeB = makeVirtualLayoutTree(planB, rootA, ctx, createMockShaper(8, 16), pageConfig, treeA);

    // Page 0 has an identical fingerprint ⇒ STILL reused by reference.
    expect(treeB.getPage(0)).toBe(treeA.getPage(0));
    // The page whose listCounterAtStart changed ⇒ NOT reused.
    expect(treeB.getPage(changedPage)).not.toBe(treeA.getPage(changedPage));
  });

  it("carry-forward only applies to pages the prev tree actually materialized", () => {
    // If a prev page was never materialized, the new tree must materialize it
    // fresh (not crash, not return undefined).
    const pageConfig = noMarginPageConfig(300);
    const childrenA = Array.from({ length: 6 }, (_, i) => fixedBlock(`b${i}`, 100));
    const rootA = cascadeRoot({ display: "block" }, childrenA);
    const { tree: treeA } = buildPlanAndTree(rootA, pageConfig);
    // Only materialize page 0; leave page 1 un-materialized.
    treeA.getPage(0);

    const rootBShared: ElementBox = {
      type: "element",
      key: rootA.key,
      style: rootA.style,
      computedStyle: rootA.computedStyle,
      children: rootA.children,
    };
    const pcis = pageConfig.pageInlineSize - pageConfig.pageMargins.inlineStart - pageConfig.pageMargins.inlineEnd;
    const metasB = buildBlockFitMetas(rootBShared, createMockShaper(8, 16), pcis);
    const planB = measurePass(metasB, pageConfig, rootBShared.children);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize);
    const treeB = makeVirtualLayoutTree(planB, rootBShared, ctx, createMockShaper(8, 16), pageConfig, treeA);

    // Page 0 was materialized in A and is unchanged ⇒ reused by ref.
    expect(treeB.getPage(0)).toBe(treeA.getPage(0));
    // Page 1 was never materialized in A ⇒ B builds it fresh (defined PageBox).
    const p1 = treeB.getPage(1);
    expect(p1.type).toBe("page");
    expect(p1.pageIndex).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Task 5: materializes only requested pages
// ---------------------------------------------------------------------------

describe("VirtualLayoutTree — materializes only requested pages", () => {
  beforeEach(() => {
    __resetGetPageDriverCountForTest();
  });

  it("getPage(19) on a 20-page doc runs exactly ONE per-page layoutBlock driver call", () => {
    // 60 fixed blocks of 100, 3/page ⇒ 20 pages.
    const pageConfig = noMarginPageConfig(300);
    const children = Array.from({ length: 60 }, (_, i) => fixedBlock(`b${i}`, 100));
    const root = cascadeRoot({ display: "block" }, children);
    const { tree } = buildPlanAndTree(root, pageConfig);
    expect(tree.plan.entries.length).toBe(20);

    __resetGetPageDriverCountForTest();
    tree.getPage(19);
    // Positioning page 19 must NOT position pages 0–18.
    expect(__getGetPageDriverCountForTest()).toBe(1);
  });
});
