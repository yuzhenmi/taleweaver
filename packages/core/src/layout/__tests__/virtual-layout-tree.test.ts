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
import type { BlockId } from "../../state";
import type { Style } from "../../styles";
import type { PageConfig } from "../page-config";
import { buildBlockFitMetas } from "../build-fit-metas";
import { measurePass } from "../measure-pass";
import type { PagePlan, PagePlanEntry } from "../measure-pass";
import { IMPLICIT_SECTION_PLAN } from "../section-plan";
import { DEFAULT_COLUMN_CONFIG } from "../column-config";
import { balanceColumnHeight, fitColumnsOnPage } from "../column-fit";
import {
  makeVirtualLayoutTree,
  __getGetPageDriverCountForTest,
  __resetGetPageDriverCountForTest,
} from "../virtual-layout-tree";

/**
 * Rebuild a `PagePlan` from `base`'s entries, overriding per-entry fields via
 * `override(entry)` and RECOMPUTING the running-sum `blockOffset` + `totalBlockSize`
 * from each entry's (possibly overridden) `pageConfig.pageBlockSize` + `pageGap`.
 * Mirrors `measurePass`'s running-sum so a per-section geometry override produces
 * a mixed-height plan whose offsets are correct. Plan methods (binary search etc.)
 * are rebound against the rewritten entries by delegating through a fresh closure.
 */
function planWithEntries(
  base: PagePlan,
  override: (entry: PagePlanEntry) => PagePlanEntry,
): PagePlan {
  let running = 0;
  const entries: PagePlanEntry[] = base.entries.map((e) => {
    const o = override(e);
    // Keep the no-slot insets CONSISTENT with the (possibly overridden)
    // pageConfig margins (#328): when an override swaps `pageConfig` (e.g. a
    // taller/margined section) but doesn't itself set the insets, the insets
    // must track the new margins — exactly as `blockSize`/`blockOffset` do —
    // otherwise the synthetic entry carries the stale base margins. An override
    // that explicitly grows the insets (a header/footer taller than the margin)
    // is preserved via `o`'s values where they exceed the margins.
    const withOffset: PagePlanEntry = {
      ...o,
      blockOffset: running,
      blockSize: o.pageConfig.pageBlockSize,
      effectiveTopInset: Math.max(o.effectiveTopInset, o.pageConfig.pageMargins.blockStart),
      effectiveBottomInset: Math.max(o.effectiveBottomInset, o.pageConfig.pageMargins.blockEnd),
    };
    running += o.pageConfig.pageBlockSize + o.pageConfig.pageGap;
    return withOffset;
  });
  const last = entries[entries.length - 1];
  const totalBlockSize = last === undefined ? 0 : last.blockOffset + last.pageConfig.pageBlockSize;

  function pageIndexAtBlockOffset(y: number): number {
    const lastIdx = entries.length - 1;
    if (lastIdx <= 0) return 0;
    if (y <= entries[0].blockOffset) return 0;
    if (y >= totalBlockSize) return lastIdx;
    let lo = 0;
    let hi = lastIdx;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (entries[mid].blockOffset <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  return {
    entries,
    sectionPlan: base.sectionPlan,
    totalBlockSize,
    pageInlineSize: base.pageInlineSize,
    pageContentBlockSize: base.pageContentBlockSize,
    pageIndexAtBlockOffset,
    pageIndexOfBlock: base.pageIndexOfBlock.bind(base),
    pageSpanOfBlock: base.pageSpanOfBlock.bind(base),
    pageIndexOfTemplateBlock: base.pageIndexOfTemplateBlock.bind(base),
    pageIndexOfFootnoteBlock: base.pageIndexOfFootnoteBlock.bind(base),
  };
}

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
  const plan = measurePass(metas, pageConfig, IMPLICIT_SECTION_PLAN, root.children);
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
    expect(keys).not.toContain("__cascadedTemplateContents");
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
    const planB = measurePass(metasB, pageConfig, IMPLICIT_SECTION_PLAN, rootBShared.children);
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
    const planB = measurePass(metasB, cfgB, IMPLICIT_SECTION_PLAN, rootBShared.children);
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
      sectionPlan: planA.sectionPlan,
      totalBlockSize: planA.totalBlockSize,
      pageInlineSize: planA.pageInlineSize,
      pageContentBlockSize: planA.pageContentBlockSize,
      pageIndexAtBlockOffset: planA.pageIndexAtBlockOffset.bind(planA),
      pageIndexOfBlock: planA.pageIndexOfBlock.bind(planA),
      pageSpanOfBlock: planA.pageSpanOfBlock.bind(planA),
      pageIndexOfTemplateBlock: planA.pageIndexOfTemplateBlock.bind(planA),
      pageIndexOfFootnoteBlock: planA.pageIndexOfFootnoteBlock.bind(planA),
    };
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize);
    const treeB = makeVirtualLayoutTree(planB, rootA, ctx, createMockShaper(8, 16), pageConfig, treeA);

    // Page 0 has an identical fingerprint ⇒ STILL reused by reference.
    expect(treeB.getPage(0)).toBe(treeA.getPage(0));
    // The page whose listCounterAtStart changed ⇒ NOT reused.
    expect(treeB.getPage(changedPage)).not.toBe(treeA.getPage(changedPage));
  });

  it("a page whose stopBeforeIndex (section cap) changed is NOT reused (C.2b-1 fix)", () => {
    // The section page-break cap is applied at POSITIONING time
    // (materializePage threads it into bfc.layoutBlock), so two entries with
    // identical children/resume tokens but different `stopBeforeIndex` produce
    // DIFFERENT PageBoxes (one truncated at the boundary, one not). A
    // SECTION_BREAK flips a page's cap (e.g. null → N) while leaving its body
    // refs unchanged — without `stopBeforeIndex` in the fingerprint the memo
    // would reuse the prior UNCAPPED box and re-leak the next section's blocks.
    const pageConfig = noMarginPageConfig(300, 600);
    const childrenA = Array.from({ length: 6 }, (_, i) => fixedBlock(`b${i}`, 100));
    const rootA = cascadeRoot({ display: "block" }, childrenA);
    const { plan: planA, tree: treeA } = buildPlanAndTree(rootA, pageConfig);
    expect(planA.entries.length).toBeGreaterThanOrEqual(2);
    // Baseline (IMPLICIT_SECTION_PLAN) ⇒ every page is uncapped.
    expect(planA.entries.every((e) => e.stopBeforeIndex === null)).toBe(true);
    for (let i = 0; i < planA.entries.length; i++) treeA.getPage(i);

    // Tree B's plan = tree A's plan with page 0's cap flipped null → a real
    // boundary (positions one fewer block); every other field — children refs,
    // resume tokens, offsets, dimensions, list seed — byte-for-byte identical,
    // built against the SAME rootA. The ONLY fingerprint delta is page 0's cap.
    const cap = planA.entries[0].startIndex + 1;
    const entriesB: PagePlanEntry[] = planA.entries.map((e) =>
      e.pageIndex === 0 ? { ...e, stopBeforeIndex: cap } : e,
    );
    const planB: PagePlan = {
      entries: entriesB,
      sectionPlan: planA.sectionPlan,
      totalBlockSize: planA.totalBlockSize,
      pageInlineSize: planA.pageInlineSize,
      pageContentBlockSize: planA.pageContentBlockSize,
      pageIndexAtBlockOffset: planA.pageIndexAtBlockOffset.bind(planA),
      pageIndexOfBlock: planA.pageIndexOfBlock.bind(planA),
      pageSpanOfBlock: planA.pageSpanOfBlock.bind(planA),
      pageIndexOfTemplateBlock: planA.pageIndexOfTemplateBlock.bind(planA),
      pageIndexOfFootnoteBlock: planA.pageIndexOfFootnoteBlock.bind(planA),
    };
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize);
    const treeB = makeVirtualLayoutTree(planB, rootA, ctx, createMockShaper(8, 16), pageConfig, treeA);

    // Page 0's cap changed ⇒ NOT reused (re-materialized with the cap).
    expect(treeB.getPage(0)).not.toBe(treeA.getPage(0));
    // A later page with an unchanged (still-null) cap ⇒ still reused by ref.
    const laterUnchanged = planA.entries.length - 1;
    expect(treeB.getPage(laterUnchanged)).toBe(treeA.getPage(laterUnchanged));
  });

  it("a page whose columnConfig changed is NOT reused (multi-column wiring T2 fingerprint)", () => {
    // The effective multi-column config is applied at POSITIONING time (once
    // T3+ land, materializePage builds a MultiColumnBox), so two entries with
    // identical children/resume tokens but different `columnConfig` produce
    // DIFFERENT PageBoxes. A SET_SECTION_COLUMNS (slice 5) flips a section's
    // column count while leaving its body refs unchanged — without
    // `columnConfig` in the fingerprint the memo would reuse the prior box and
    // never re-distribute the columns. This proves the fingerprint guard fires.
    const pageConfig = noMarginPageConfig(300, 600);
    const childrenA = Array.from({ length: 6 }, (_, i) => fixedBlock(`b${i}`, 100));
    const rootA = cascadeRoot({ display: "block" }, childrenA);
    const { plan: planA, tree: treeA } = buildPlanAndTree(rootA, pageConfig);
    expect(planA.entries.length).toBeGreaterThanOrEqual(2);
    // Baseline (IMPLICIT_SECTION_PLAN) ⇒ every page is single-column.
    expect(planA.entries.every((e) => e.columnConfig === DEFAULT_COLUMN_CONFIG)).toBe(true);
    for (let i = 0; i < planA.entries.length; i++) treeA.getPage(i);

    // Tree B's plan = tree A's plan with page 0's columnConfig flipped 1 → 2
    // columns; every other field — children refs, resume tokens, offsets,
    // dimensions, list seed, cap — byte-for-byte identical, built against the
    // SAME rootA. The ONLY fingerprint delta is page 0's column config. T5
    // materializes the MultiColumnBox, so the flipped entry must carry the same
    // `columnFit` + `balancedColumnHeight` the measure pass would stamp for a real
    // 2-column page-0 (otherwise materialization has no per-column distribution).
    const metasA = buildBlockFitMetas(rootA, createMockShaper(8, 16), pageConfig.pageInlineSize);
    const page0Height = planA.entries[0].pageConfig.pageBlockSize; // no margins
    const balancedHeight = balanceColumnHeight(metasA, 0, planA.entries[0].resumeInto, 2, 1, page0Height);
    const page0ColumnFit = fitColumnsOnPage(metasA, 0, planA.entries[0].resumeInto, balancedHeight, 2, 1);
    const entriesB: PagePlanEntry[] = planA.entries.map((e) =>
      e.pageIndex === 0
        ? {
            ...e,
            columnConfig: { columnCount: 2, columnGap: 48, columnRule: null },
            columnFit: page0ColumnFit,
            balancedColumnHeight: balancedHeight,
          }
        : e,
    );
    const planB: PagePlan = {
      entries: entriesB,
      sectionPlan: planA.sectionPlan,
      totalBlockSize: planA.totalBlockSize,
      pageInlineSize: planA.pageInlineSize,
      pageContentBlockSize: planA.pageContentBlockSize,
      pageIndexAtBlockOffset: planA.pageIndexAtBlockOffset.bind(planA),
      pageIndexOfBlock: planA.pageIndexOfBlock.bind(planA),
      pageSpanOfBlock: planA.pageSpanOfBlock.bind(planA),
      pageIndexOfTemplateBlock: planA.pageIndexOfTemplateBlock.bind(planA),
      pageIndexOfFootnoteBlock: planA.pageIndexOfFootnoteBlock.bind(planA),
    };
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize);
    const treeB = makeVirtualLayoutTree(planB, rootA, ctx, createMockShaper(8, 16), pageConfig, treeA);

    // Page 0's column config changed ⇒ NOT reused.
    expect(treeB.getPage(0)).not.toBe(treeA.getPage(0));
    // A later page with unchanged (still single-column) config ⇒ still reused.
    const laterUnchanged = planA.entries.length - 1;
    expect(treeB.getPage(laterUnchanged)).toBe(treeA.getPage(laterUnchanged));
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
    const planB = measurePass(metasB, pageConfig, IMPLICIT_SECTION_PLAN, rootBShared.children);
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

// ---------------------------------------------------------------------------
// C.2b-2 Task 3: per-entry page geometry
//
// `materializePage` positions each page with its OWN `entry.pageConfig`
// (block-size / inline-size / margins / running-sum blockOffset) — NOT the
// single doc-wide closure config. The fingerprint deep-compares the whole
// `pageConfig`, so a section-geometry change invalidates that section's pages
// onward while earlier (unchanged) sections still carry forward by reference.
// ---------------------------------------------------------------------------

describe("VirtualLayoutTree — per-entry page geometry (C.2b-2)", () => {
  it("materialized PageBox adopts the entry's TALLER pageConfig (height/inline/margins/offset)", () => {
    // 6 fixed blocks of 100, 3/page at doc-wide 300 ⇒ 2 pages. Override page 1's
    // entry to a taller + wider + margined config; the running-sum offset shifts
    // accordingly. Page 0 keeps doc-wide dims.
    const docWide = noMarginPageConfig(300, 600, 20);
    const children = Array.from({ length: 6 }, (_, i) => fixedBlock(`b${i}`, 100));
    const root = cascadeRoot({ display: "block" }, children);
    const { plan: planA } = buildPlanAndTree(root, docWide);
    expect(planA.entries.length).toBe(2);

    // A genuinely different section geometry: taller page, wider page, non-zero
    // margins, different gap. Its content area (700 - 10 - 10 = 680 block, 800 -
    // 15 - 15 = 770 inline) easily holds page 1's three 100-tall blocks.
    const tallCfg: PageConfig = {
      pageInlineSize: 800,
      pageBlockSize: 700,
      pageMargins: { blockStart: 10, blockEnd: 10, inlineStart: 15, inlineEnd: 15 },
      pageGap: 40,
    };
    const planB = planWithEntries(planA, (e) =>
      e.pageIndex === 1 ? { ...e, pageConfig: tallCfg, blockSize: tallCfg.pageBlockSize } : e,
    );
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, docWide.pageInlineSize);
    const tree = makeVirtualLayoutTree(planB, root, ctx, createMockShaper(8, 16), docWide);

    // Page 0: unchanged doc-wide dims + offset 0.
    const p0 = tree.getPage(0);
    expect(p0.blockSize).toBe(docWide.pageBlockSize);
    expect(p0.inlineSize).toBe(docWide.pageInlineSize);
    expect(p0.blockOffset).toBe(0);
    // Doc-wide page has zero margins ⇒ its BFC child sits at the content origin (0,0).
    expect(p0.children[0]?.inlineOffset).toBe(0);
    expect(p0.children[0]?.blockOffset).toBe(0);

    // Page 1: the override geometry.
    const p1 = tree.getPage(1);
    expect(p1.blockSize).toBe(tallCfg.pageBlockSize);
    expect(p1.inlineSize).toBe(tallCfg.pageInlineSize);
    // Running-sum offset = page 0's effective height + its gap (300 + 20).
    expect(p1.blockOffset).toBe(docWide.pageBlockSize + docWide.pageGap);
    expect(p1.blockOffset).toBe(planB.entries[1].blockOffset);
    // The BFC child is inset by the section's margins.
    expect(p1.children[0]?.inlineOffset).toBe(tallCfg.pageMargins.inlineStart);
    expect(p1.children[0]?.blockOffset).toBe(tallCfg.pageMargins.blockStart);
  });

  it("tree.blockSize and materializeAll().blockSize equal the running-sum totalBlockSize (mixed heights)", () => {
    const docWide = noMarginPageConfig(300, 600, 20);
    const children = Array.from({ length: 6 }, (_, i) => fixedBlock(`b${i}`, 100));
    const root = cascadeRoot({ display: "block" }, children);
    const { plan: planA } = buildPlanAndTree(root, docWide);
    expect(planA.entries.length).toBe(2);

    const tallCfg: PageConfig = {
      pageInlineSize: 600,
      pageBlockSize: 900,
      pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
      pageGap: 20,
    };
    const planB = planWithEntries(planA, (e) =>
      e.pageIndex === 1 ? { ...e, pageConfig: tallCfg, blockSize: tallCfg.pageBlockSize } : e,
    );
    // Expected running sum: page0 (300) + gap (20) + page1 (900), no trailing gap.
    const expectedTotal = 300 + 20 + 900;
    expect(planB.totalBlockSize).toBe(expectedTotal);

    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, docWide.pageInlineSize);
    const tree = makeVirtualLayoutTree(planB, root, ctx, createMockShaper(8, 16), docWide);
    expect(tree.blockSize).toBe(expectedTotal);
    expect(tree.materializeAll().blockSize).toBe(expectedTotal);
    // The outer BlockBox keeps the doc-wide inline-size (bridge contract).
    expect(tree.materializeAll().inlineSize).toBe(docWide.pageInlineSize);
  });

  it("carry-forward refuses a page whose pageConfig changed; an unchanged page still reuses", () => {
    const docWide = noMarginPageConfig(300, 600, 20);
    const children = Array.from({ length: 6 }, (_, i) => fixedBlock(`b${i}`, 100));
    const root = cascadeRoot({ display: "block" }, children);
    const { plan: planA, tree: treeA } = buildPlanAndTree(root, docWide);
    expect(planA.entries.length).toBe(2);
    for (let i = 0; i < planA.entries.length; i++) treeA.getPage(i);

    // Tree B: page 0 keeps doc-wide config (unchanged), page 1 gets a taller
    // config. Page 0 ⇒ reused by reference; page 1 ⇒ re-materialized.
    const tallCfg: PageConfig = {
      pageInlineSize: 600,
      pageBlockSize: 700,
      pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
      pageGap: 20,
    };
    const planB = planWithEntries(planA, (e) =>
      e.pageIndex === 1 ? { ...e, pageConfig: tallCfg, blockSize: tallCfg.pageBlockSize } : e,
    );
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, docWide.pageInlineSize);
    const treeB = makeVirtualLayoutTree(planB, root, ctx, createMockShaper(8, 16), docWide, treeA);

    // Page 0's pageConfig unchanged ⇒ reused by reference.
    expect(treeB.getPage(0)).toBe(treeA.getPage(0));
    // Page 1's pageConfig changed (taller) ⇒ NOT reused.
    expect(treeB.getPage(1)).not.toBe(treeA.getPage(1));
  });

  it("carry-forward refuses on a margins-only pageConfig change (same content-block-size)", () => {
    // Two configs can share content-block-size yet differ in margins ⇒ different
    // PageBox height + BFC child offset. The whole-pageConfig deep-equal catches
    // this where a content-block-size-only compare would miss it.
    const docWide = noMarginPageConfig(300, 600, 20);
    const children = Array.from({ length: 6 }, (_, i) => fixedBlock(`b${i}`, 100));
    const root = cascadeRoot({ display: "block" }, children);
    const { plan: planA, tree: treeA } = buildPlanAndTree(root, docWide);
    for (let i = 0; i < planA.entries.length; i++) treeA.getPage(i);

    // Same content-block-size (300) but +20/+20 margins ⇒ pageBlockSize 340.
    // (Picked so 300 - 0 - 0 === 340 - 20 - 20 = 300 content block-size.)
    const remarginedCfg: PageConfig = {
      pageInlineSize: 600,
      pageBlockSize: 340,
      pageMargins: { blockStart: 20, blockEnd: 20, inlineStart: 0, inlineEnd: 0 },
      pageGap: 20,
    };
    expect(remarginedCfg.pageBlockSize - 20 - 20).toBe(docWide.pageBlockSize);
    const planB = planWithEntries(planA, (e) =>
      e.pageIndex === 0 ? { ...e, pageConfig: remarginedCfg, blockSize: remarginedCfg.pageBlockSize } : e,
    );
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, docWide.pageInlineSize);
    const treeB = makeVirtualLayoutTree(planB, root, ctx, createMockShaper(8, 16), docWide, treeA);

    // Page 0's margins changed (even though content-block-size is identical) ⇒
    // NOT reused: its PageBox height and BFC offset differ.
    expect(treeB.getPage(0)).not.toBe(treeA.getPage(0));
  });
});

// ---------------------------------------------------------------------------
// C.2c Task 3: cascaded header/footer template-body map threading
//
// `makeVirtualLayoutTree` accepts a `cascadedTemplateContents` map and STORES
// it in its closure (exposed as the non-enumerable `__cascadedTemplateContents`
// hook). T3 only stores it — `materializePage` does NOT read it yet (T4), so
// passing a map must NOT change any page output.
// ---------------------------------------------------------------------------
describe("VirtualLayoutTree — cascaded template-body map threading (C.2c T3)", () => {
  type WithHook = {
    readonly __cascadedTemplateContents?: ReadonlyMap<BlockId, ElementBox>;
  };

  it("stores the passed cascadedTemplateContents map (by reference)", () => {
    const pageConfig = noMarginPageConfig(300);
    const children = Array.from({ length: 6 }, (_, i) => fixedBlock(`b${i}`, 100));
    const root = cascadeRoot({ display: "block" }, children);
    const pageContentInlineSize = pageConfig.pageInlineSize;
    const metas = buildBlockFitMetas(root, createMockShaper(8, 16), pageContentInlineSize);
    const plan = measurePass(metas, pageConfig, IMPLICIT_SECTION_PLAN, root.children);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize);

    const hdrBody = cascadeRoot({ display: "block" }, [paragraph("hdr", 1)]);
    const bodies = new Map<BlockId, ElementBox>([["hdr-root" as BlockId, hdrBody]]);

    const tree = makeVirtualLayoutTree(
      plan, root, ctx, createMockShaper(8, 16), pageConfig, undefined, bodies,
    );
    expect((tree as WithHook).__cascadedTemplateContents).toBe(bodies);
  });

  it("defaults to an empty map when omitted", () => {
    const pageConfig = noMarginPageConfig(300);
    const children = Array.from({ length: 6 }, (_, i) => fixedBlock(`b${i}`, 100));
    const root = cascadeRoot({ display: "block" }, children);
    const { tree } = buildPlanAndTree(root, pageConfig);
    const hook = (tree as WithHook).__cascadedTemplateContents;
    expect(hook).toBeDefined();
    expect(hook?.size).toBe(0);
  });

  it("no-regression: passing a body map does NOT change getPage output (T3 stores only)", () => {
    const pageConfig = marginedPageConfig(300);
    const children = Array.from({ length: 6 }, (_, i) => fixedBlock(`b${i}`, 100));
    const root = cascadeRoot({ display: "block" }, children);
    const pageContentInlineSize =
      pageConfig.pageInlineSize - pageConfig.pageMargins.inlineStart - pageConfig.pageMargins.inlineEnd;
    const metas = buildBlockFitMetas(root, createMockShaper(8, 16), pageContentInlineSize);
    const plan = measurePass(metas, pageConfig, IMPLICIT_SECTION_PLAN, root.children);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize);

    const withoutBodies = makeVirtualLayoutTree(plan, root, ctx, createMockShaper(8, 16), pageConfig);
    const hdrBody = cascadeRoot({ display: "block" }, [paragraph("hdr", 2)]);
    const bodies = new Map<BlockId, ElementBox>([["hdr-root" as BlockId, hdrBody]]);
    const withBodies = makeVirtualLayoutTree(
      plan, root, ctx, createMockShaper(8, 16), pageConfig, undefined, bodies,
    );

    // Every page is byte-identical (the header/footer slots are still null in T3).
    for (let i = 0; i < plan.entries.length; i++) {
      expect(withBodies.getPage(i)).toEqual(withoutBodies.getPage(i));
      expect(withBodies.getPage(i).headerSlot).toBeNull();
      expect(withBodies.getPage(i).footerSlot).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// C.2c Task 4: lay out header/footer SLOTS in materializePage + slot-aware
// fingerprint.
//
// A page whose entry carries `headerBlockId`/`footerBlockId` (and whose body is
// in `cascadedTemplateContents`) gets a positioned `headerSlot`/`footerSlot`
// BlockBox laid into the page's TOP/BOTTOM margin band. The fingerprint gains
// header/footer id + body-ref identity so a header edit (new cascaded body ref)
// or a section header-id change re-materializes the page.
// ---------------------------------------------------------------------------
describe("VirtualLayoutTree — header/footer slot layout (C.2c T4)", () => {
  /** Build {plan, ctx, shaper, cfg} with non-zero margins, plus the header/footer body builders. */
  function setup(cfg: PageConfig) {
    const children = Array.from({ length: 6 }, (_, i) => fixedBlock(`b${i}`, 100));
    const root = cascadeRoot({ display: "block" }, children);
    const pcis = cfg.pageInlineSize - cfg.pageMargins.inlineStart - cfg.pageMargins.inlineEnd;
    const metas = buildBlockFitMetas(root, createMockShaper(8, 16), pcis);
    const plan = measurePass(metas, cfg, IMPLICIT_SECTION_PLAN, root.children);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, cfg.pageInlineSize);
    return { root, plan, ctx };
  }

  it("lays the header body into the TOP margin band (geometry) and footer into the BOTTOM band", () => {
    // Margins: blockStart 10, blockEnd 10, inlineStart 15, inlineEnd 15 (marginedPageConfig).
    const cfg = marginedPageConfig(300);
    const { root, plan, ctx } = setup(cfg);

    const hdrId = "hdr-root" as BlockId;
    const ftrId = "ftr-root" as BlockId;
    const hdrBody = cascadeRoot({ display: "block" }, [paragraph("hdr", 1)]);
    const ftrBody = cascadeRoot({ display: "block" }, [paragraph("ftr", 1)]);
    const bodies = new Map<BlockId, ElementBox>([
      [hdrId, hdrBody],
      [ftrId, ftrBody],
    ]);

    // Tag page 0's entry with both ids (every other field unchanged).
    const planWithIds = planWithEntries(plan, (e) =>
      e.pageIndex === 0 ? { ...e, headerBlockId: hdrId, footerBlockId: ftrId } : e,
    );
    const tree = makeVirtualLayoutTree(
      planWithIds, root, ctx, createMockShaper(8, 16), cfg, undefined, bodies,
    );

    const p0 = tree.getPage(0);
    // Header slot: BlockBox at the top margin band origin (inlineStart, 0).
    expect(p0.headerSlot).not.toBeNull();
    const hdr = p0.headerSlot;
    if (hdr === null) throw new Error("header slot null");
    expect(hdr.type).toBe("block");
    expect(hdr.inlineOffset).toBe(cfg.pageMargins.inlineStart);
    expect(hdr.blockOffset).toBe(0);
    // The body is one paragraph with a single 16px mock line. The slot is laid
    // at its NATURAL height (uncapped, #328) ⇒ 16px — never clipped to the 10px
    // band. (This synthetic entry's `effectiveTopInset` is the raw margin 10
    // because the plan was built without per-section `slotInsets`; in production
    // the producer's `computeSlotInsets` would grow the inset to 16 and push the
    // body down. This test isolates the SLOT-layout geometry; the body-push /
    // grow-the-inset behavior is covered end-to-end in growing-slot.test.ts.)
    expect(hdr.blockSize).toBe(16);
    expect(hdr.children.length).toBe(1); // one paragraph

    // Footer slot: BlockBox at the top of the BOTTOM margin band.
    expect(p0.footerSlot).not.toBeNull();
    const ftr = p0.footerSlot;
    if (ftr === null) throw new Error("footer slot null");
    expect(ftr.type).toBe("block");
    expect(ftr.inlineOffset).toBe(cfg.pageMargins.inlineStart);
    expect(ftr.blockOffset).toBe(cfg.pageBlockSize - cfg.pageMargins.blockEnd);
    expect(ftr.blockSize).toBe(16);
    expect(ftr.children.length).toBe(1);

    // The body content is laid out at EXACTLY the CONTENT width (page minus
    // inline margins), not the full page width — a display:block fills its
    // containing inline size, which is effContentInlineSize.
    const contentInline = cfg.pageInlineSize - cfg.pageMargins.inlineStart - cfg.pageMargins.inlineEnd;
    expect(hdr.inlineSize).toBe(contentInline);
    expect(ftr.inlineSize).toBe(contentInline);
  });

  it("#326: a CONTAINER header body with TWO paragraph children renders BOTH lines in the slot", () => {
    // After Enter in a header, the body is a container holding two paragraph
    // children. The slot lays out the container root via its BFC, so BOTH
    // paragraphs become children of the headerSlot box (two lines render).
    // A 50px top band fits both 16px mock lines (32px total) without the
    // band-overflow short-circuit the 10px-band single-paragraph test documents.
    const cfg: PageConfig = {
      pageInlineSize: 600,
      pageBlockSize: 300,
      pageMargins: { blockStart: 50, blockEnd: 50, inlineStart: 15, inlineEnd: 15 },
      pageGap: 20,
    };
    const { root, plan, ctx } = setup(cfg);

    const hdrId = "hdr-root" as BlockId;
    // A container root (the `template-body` shape) with two paragraph children.
    const hdrBody = cascadeRoot({ display: "block" }, [
      paragraph("h0", 1),
      paragraph("h1", 1),
    ]);
    const bodies = new Map<BlockId, ElementBox>([[hdrId, hdrBody]]);
    const planWithIds = planWithEntries(plan, (e) =>
      e.pageIndex === 0 ? { ...e, headerBlockId: hdrId } : e,
    );
    const tree = makeVirtualLayoutTree(
      planWithIds, root, ctx, createMockShaper(8, 16), cfg, undefined, bodies,
    );

    const hdr = tree.getPage(0).headerSlot;
    expect(hdr).not.toBeNull();
    if (hdr === null) throw new Error("header slot null");
    // BOTH paragraphs laid out under the slot box (two lines).
    expect(hdr.children.length).toBe(2);
    // Each is a 16px mock line; the second sits below the first.
    expect(hdr.children[0]?.blockOffset).toBe(0);
    expect(hdr.children[1]?.blockOffset).toBe(16);
    // The slot box's natural content height is the sum of the two lines.
    expect(hdr.blockSize).toBe(32);
  });

  it("a page with NO header/footer id ⇒ both slots null", () => {
    const cfg = marginedPageConfig(300);
    const { root, plan, ctx } = setup(cfg);
    // Even with bodies present in the map, an entry without ids gets null slots.
    const bodies = new Map<BlockId, ElementBox>([
      ["hdr-root" as BlockId, cascadeRoot({ display: "block" }, [paragraph("hdr", 1)])],
    ]);
    const tree = makeVirtualLayoutTree(
      plan, root, ctx, createMockShaper(8, 16), cfg, undefined, bodies,
    );
    for (let i = 0; i < plan.entries.length; i++) {
      const p = tree.getPage(i);
      expect(p.headerSlot, `page ${i} header`).toBeNull();
      expect(p.footerSlot, `page ${i} footer`).toBeNull();
    }
  });

  it("an id with NO matching body in the map ⇒ that slot is null", () => {
    const cfg = marginedPageConfig(300);
    const { root, plan, ctx } = setup(cfg);
    // Tag page 0 with a header id whose body is NOT in the map.
    const planWithIds = planWithEntries(plan, (e) =>
      e.pageIndex === 0 ? { ...e, headerBlockId: "missing-hdr" as BlockId } : e,
    );
    const tree = makeVirtualLayoutTree(
      planWithIds, root, ctx, createMockShaper(8, 16), cfg, undefined, new Map(),
    );
    expect(tree.getPage(0).headerSlot).toBeNull();
    expect(tree.getPage(0).footerSlot).toBeNull();
  });

  it("NO-REGRESSION: a no-header/footer doc is byte-identical to no-bodies (slots null, body unchanged)", () => {
    const cfg = marginedPageConfig(300);
    const { root, plan, ctx } = setup(cfg);
    const noBodies = makeVirtualLayoutTree(plan, root, ctx, createMockShaper(8, 16), cfg);
    // A separate tree with an unrelated body in the map but NO entry ids.
    const withMap = makeVirtualLayoutTree(
      plan, root, ctx, createMockShaper(8, 16), cfg, undefined,
      new Map<BlockId, ElementBox>([["x" as BlockId, cascadeRoot({ display: "block" }, [paragraph("x", 1)])]]),
    );
    for (let i = 0; i < plan.entries.length; i++) {
      expect(withMap.getPage(i)).toEqual(noBodies.getPage(i));
      expect(noBodies.getPage(i).headerSlot).toBeNull();
      expect(noBodies.getPage(i).footerSlot).toBeNull();
    }
  });

  it("FINGERPRINT: a CHANGED header body ref re-materializes; an UNCHANGED carried-forward body ref reuses (I3)", () => {
    const cfg = marginedPageConfig(300);
    const { root, plan, ctx } = setup(cfg);
    const hdrId = "hdr-root" as BlockId;

    // Tree A: page 0 carries the header id; body in the map.
    const hdrBodyA = cascadeRoot({ display: "block" }, [paragraph("hdr", 1)]);
    const planWithIds = planWithEntries(plan, (e) =>
      e.pageIndex === 0 ? { ...e, headerBlockId: hdrId } : e,
    );
    const bodiesA = new Map<BlockId, ElementBox>([[hdrId, hdrBodyA]]);
    const treeA = makeVirtualLayoutTree(
      planWithIds, root, ctx, createMockShaper(8, 16), cfg, undefined, bodiesA,
    );
    for (let i = 0; i < planWithIds.entries.length; i++) treeA.getPage(i);

    // Tree B: SAME plan-entry ids, but the header body is a NEW cascaded ref
    // (a header edit). Page 0's fingerprint differs (body ref) ⇒ NOT reused.
    // Page 1 has no header id, unchanged ⇒ carried forward.
    const hdrBodyB = cascadeRoot({ display: "block" }, [paragraph("hdr", 1)]);
    expect(hdrBodyB).not.toBe(hdrBodyA);
    const bodiesB = new Map<BlockId, ElementBox>([[hdrId, hdrBodyB]]);
    const treeB = makeVirtualLayoutTree(
      planWithIds, root, ctx, createMockShaper(8, 16), cfg, treeA, bodiesB,
    );
    expect(treeB.getPage(0)).not.toBe(treeA.getPage(0));
    const laterNoHeader = planWithIds.entries.length - 1;
    expect(treeB.getPage(laterNoHeader)).toBe(treeA.getPage(laterNoHeader));

    // Tree C: SAME body ref as B carried forward (unchanged) ⇒ page 0 reused.
    const treeC = makeVirtualLayoutTree(
      planWithIds, root, ctx, createMockShaper(8, 16), cfg, treeB, bodiesB,
    );
    expect(treeC.getPage(0)).toBe(treeB.getPage(0));
  });

  it("FINGERPRINT: two entries with DIFFERENT header ids materialize independently (no stale-slot cross-reuse, M2)", () => {
    const cfg = marginedPageConfig(300);
    const { root, plan, ctx } = setup(cfg);
    expect(plan.entries.length).toBeGreaterThanOrEqual(2);
    const idA = "hdr-A" as BlockId;
    const idB = "hdr-B" as BlockId;
    const bodyA = cascadeRoot({ display: "block" }, [paragraph("hdrA", 1)]);
    const bodyB = cascadeRoot({ display: "block" }, [paragraph("hdrB", 1)]);
    const bodies = new Map<BlockId, ElementBox>([[idA, bodyA], [idB, bodyB]]);

    // Tree 1: page 0 → idA, page 1 → idB.
    const plan1 = planWithEntries(plan, (e) =>
      e.pageIndex === 0 ? { ...e, headerBlockId: idA } : { ...e, headerBlockId: idB },
    );
    const tree1 = makeVirtualLayoutTree(
      plan1, root, ctx, createMockShaper(8, 16), cfg, undefined, bodies,
    );
    for (let i = 0; i < plan1.entries.length; i++) tree1.getPage(i);

    // Tree 2: page 0 and page 1 SWAP their header ids (idB then idA). Both pages'
    // header-id fingerprints differ from tree1 ⇒ both re-materialize. Crucially,
    // page 0 must NOT reuse tree1's page-0 box (which had idA's body) since it
    // now carries idB's body.
    const plan2 = planWithEntries(plan, (e) =>
      e.pageIndex === 0 ? { ...e, headerBlockId: idB } : { ...e, headerBlockId: idA },
    );
    const tree2 = makeVirtualLayoutTree(
      plan2, root, ctx, createMockShaper(8, 16), cfg, tree1, bodies,
    );
    expect(tree2.getPage(0)).not.toBe(tree1.getPage(0));
    expect(tree2.getPage(1)).not.toBe(tree1.getPage(1));
    // And the rendered header bodies are the swapped ones: page 0's header child
    // count > 0 and its body came from idB (paragraph "hdrB").
    const p0Hdr = tree2.getPage(0).headerSlot;
    expect(p0Hdr).not.toBeNull();
  });
});
