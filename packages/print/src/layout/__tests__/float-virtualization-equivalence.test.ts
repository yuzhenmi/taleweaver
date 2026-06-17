// packages/core/src/layout/__tests__/float-virtualization-equivalence.test.ts
//
// THE FLOAT EQUIVALENCE MATRIX (VL float fast-path Task 6). This is the
// load-bearing correctness gate that PROVES the Task-5 gate flip (single-column
// float/`clear` docs now use the virtualized fast path) is safe: it runs the
// shared `runOracle` (the real `layoutBlock`, page-by-page) AND `measurePass`
// WITH a `floatPageMeasurer` closure that MIRRORS the production producer closure
// EXACTLY (same root/shaper/hyphenator/contentCtx, the same per-page origin, the
// same `accumulateListCounter` loop), then asserts the plan matches the oracle
// page-for-page (blockOffset / childrenCount / resumeOut). Because the measurer
// runs the IDENTICAL `layoutBlock` materialize runs, equivalence is by
// construction — this test is the empirical proof.
//
// It also covers:
//   - the HIGHEST-RISK incremental==full re-measure of a tall-float doc
//     (Task 6 Step 3 — guards the Task-3 incremental carry seeding);
//   - an ordered-list + float fixture (PR1-1 — listCounterAtStart path-independence);
//   - the PR2-B per-page origin equality (measurer's inlineOrigin/blockOrigin ==
//     materializePage's effMargins.inlineStart / effTopInset);
//   - the `paginationFallsBackToLegacy` gate truth-table (Task 5 Step 3).

import { describe, it, expect } from "vitest";
import type { FootnoteAnchorRef } from "@taleweaver/core";
import type { BlockId } from "@taleweaver/core";
import { layoutBlock, placeIncomingPushedFloats } from "../bfc";
import { createMockShaper } from "@taleweaver/core";
import { makeRootContext } from "../layout-context";
import type { LayoutContext } from "../layout-context";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import type { Hyphenator } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { createElementBox, createTextBox } from "@taleweaver/core";
import type { ElementBox } from "@taleweaver/core";
import type { Style } from "@taleweaver/core";
import { breakTokensEqual } from "../fragmentation";
import type { PageConfig } from "../page-config";
import { buildBlockFitMetas } from "../build-fit-metas";
import {
  measurePass,
  paginationFallsBackToLegacy,
  type FloatPageMeasurer,
} from "../measure-pass";
import { accumulateListCounter } from "../fit-core";
import { createFloatEnvironment } from "../float-context";
import { IMPLICIT_SECTION_PLAN } from "../section-plan";
import { makeVirtualLayoutTree } from "../virtual-layout-tree";
import type { PageBox } from "../page-box";
import type { LayoutBox } from "../layout-box";
import { runOracle, nth } from "./equivalence-oracle";

// ---------------------------------------------------------------------------
// Page configs + fixtures (mirror float-pagination-coherent.test.ts).
// ---------------------------------------------------------------------------

/** 5 lines/page @ the mock shaper's 16px line-height, no margins. */
const PAGE: PageConfig = {
  pageInlineSize: 600,
  pageBlockSize: 80,
  pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
  pageGap: 20,
};

/** A page config WITH non-zero margins — exercises the per-page origin path. */
const PAGE_MARGINED: PageConfig = {
  pageInlineSize: 600,
  pageBlockSize: 120,
  pageMargins: { blockStart: 20, blockEnd: 20, inlineStart: 30, inlineEnd: 30 },
  pageGap: 20,
};

/** Cascade a raw root so its (and its descendants') `computedStyle` is populated. */
function cascadeRoot(rootStyle: Style, children: readonly ElementBox[]): ElementBox {
  const root = createElementBox("root", rootStyle, children);
  const cascaded = cascadePass(root);
  if (cascaded.type !== "element") throw new Error("cascadePass returned non-element");
  return cascaded;
}

/**
 * Cascade a doc root carrying a doc-wide `columnCount` METADATA override (the
 * source `resolveColumnConfig` / `hasMultiColumnRegion` read — NOT a `Style`
 * property). `cascadePass` preserves the open-schema metadata.
 */
function cascadeMulticolRoot(columnCount: number, children: readonly ElementBox[]): ElementBox {
  const root = createElementBox("root", { display: "block" } as Style, children, { columnCount });
  const cascaded = cascadePass(root);
  if (cascaded.type !== "element") throw new Error("cascadePass returned non-element");
  return cascaded;
}

function para(id: string, n: number, extra?: Partial<Style>): ElementBox {
  return createElementBox(id, { display: "block", whiteSpace: "pre", ...(extra ?? {}) } as Style, [
    createTextBox(`${id}-t`, { whiteSpace: "pre" }, Array.from({ length: n }, (_, i) => `${id}${i}`).join("\n")),
  ]);
}
function leftFloat(id: string, w: number, h: number): ElementBox {
  return createElementBox(
    id,
    { display: "block", float: "inline-start", inlineSize: w, blockSize: h } as Style,
    [],
  );
}
function rightFloat(id: string, w: number, h: number): ElementBox {
  return createElementBox(
    id,
    { display: "block", float: "inline-end", inlineSize: w, blockSize: h } as Style,
    [],
  );
}
function listItem(id: string, n: number): ElementBox {
  return createElementBox(id, { display: "list-item", whiteSpace: "pre" } as Style, [
    createTextBox(`${id}-t`, { whiteSpace: "pre" }, Array.from({ length: n }, (_, i) => `${id}${i}`).join("\n")),
  ]);
}

// ---------------------------------------------------------------------------
// The float-aware measurer — MIRRORS the production producer closure exactly.
// ---------------------------------------------------------------------------

/**
 * Build a `floatPageMeasurer` that closes over `root`/`shaper`/`hyphenator`/
 * `contentCtx` and lays each page out with the REAL `layoutBlock` — the IDENTICAL
 * call shape the production producer (virtual-producer.ts) uses. The list-counter
 * loop + the break-token → childrenCount mapping mirror the producer field-for-field.
 */
function makeMeasurer(
  root: ElementBox,
  shaper: ReturnType<typeof createMockShaper>,
  contentCtx: LayoutContext,
  metas: ReturnType<typeof buildBlockFitMetas>,
  hyphenator?: Hyphenator,
): FloatPageMeasurer {
  return (a) => {
    const env = createFloatEnvironment();
    for (const f of a.incomingFloats) env.seedPlaced(f);
    const pageCtx: LayoutContext = { ...contentCtx, floatEnv: env, isBFCRoot: true };
    const { box, breakToken, inFlowConsumed } = layoutBlock(
      root,
      a.inlineOrigin,
      a.blockOrigin,
      pageCtx,
      shaper,
      hyphenator,
      {
        availableBlockSize: a.contentBlockSize,
        pageIndex: 0,
        resumeFrom: a.resumeInto,
        stopBeforeIndex: a.stopBeforeIndex,
      },
      a.pageFlowBase,
    );
    const nextStartIndex =
      breakToken === null
        ? root.children.length
        : breakToken.type === "block"
          ? breakToken.resumeChildIndex
          : a.startIndex;
    let listCounterAtEnd = a.listCounterAtStart;
    for (let i = a.startIndex; i < nextStartIndex; i++) {
      const m = metas[i];
      if (m !== undefined) listCounterAtEnd = accumulateListCounter(m, listCounterAtEnd);
    }
    return {
      resumeOut: breakToken,
      inFlowConsumed: box !== null ? inFlowConsumed : 0,
      childrenCount: nextStartIndex - a.startIndex,
      listCounterAtEnd,
      placedFloats: env.getPlacedFloats().slice(),
      // #528 T3: pushed floats deferred to the next page. INERT — empty (no
      // producer pushes), mirroring the real producer's T3 literal.
      pushedFloats: [],
    };
  };
}

/** Build the doc-wide content `LayoutContext` + full-width metas for a cascaded root. */
function buildHarness(root: ElementBox, pageConfig: PageConfig, hyphenator?: Hyphenator) {
  const shaper = createMockShaper(8, 16);
  const margins = pageConfig.pageMargins;
  const pageContentInlineSize =
    pageConfig.pageInlineSize - margins.inlineStart - margins.inlineEnd;
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize);
  const contentCtx: LayoutContext = { ...ctx, containingInlineSize: pageContentInlineSize };
  const metas = buildBlockFitMetas(root, shaper, hyphenator, pageContentInlineSize);
  const measurer = makeMeasurer(root, shaper, contentCtx, metas, hyphenator);
  return { shaper, metas, measurer, margins };
}

/**
 * Run the oracle AND `measurePass(... floatPageMeasurer ...)` for a cascaded float
 * root and assert the plan matches the oracle page-for-page.
 */
function assertFloatEquivalent(root: ElementBox, pageConfig: PageConfig, hyphenator?: Hyphenator): void {
  const { shaper, metas, measurer } = buildHarness(root, pageConfig, hyphenator);
  const oracle = runOracle(root, shaper, pageConfig, hyphenator);
  const plan = measurePass(
    metas, pageConfig, IMPLICIT_SECTION_PLAN, root.children,
    undefined, undefined, undefined, measurer,
  );

  expect(plan.entries.length, "page count").toBe(oracle.pages.length);
  expect(plan.totalBlockSize, "totalBlockSize").toBe(oracle.totalBlockSize);
  for (let i = 0; i < oracle.pages.length; i++) {
    const o = nth(oracle.pages, i, "oracle page");
    const p = nth(plan.entries, i, "plan entry");
    expect(p.blockOffset, `page ${i} blockOffset`).toBe(o.blockOffset);
    expect(p.startIndex, `page ${i} startIndex`).toBe(o.startIndex);
    expect(p.children.length, `page ${i} childrenCount`).toBe(o.childrenCount);
    expect(breakTokensEqual(p.resumeInto, o.resumeInto), `page ${i} resumeInto`).toBe(true);
    expect(breakTokensEqual(p.resumeOut, o.resumeOut), `page ${i} resumeOut`).toBe(true);
  }
}

// ---------------------------------------------------------------------------
// (1) The float fixture matrix.
// ---------------------------------------------------------------------------

describe("float virtualization equivalence — measurePass(floatPageMeasurer) == oracle", () => {
  it("right float (inline-end) on page ≥1", () => {
    assertFloatEquivalent(
      cascadeRoot({ display: "block" }, [para("a", 5), rightFloat("f", 200, 40), para("b", 10)]),
      PAGE,
    );
  });

  it("left float crossing a page boundary (tall float)", () => {
    // float at cumulative 64, blockSize 56 → spans [64,120], crossing page 0→1.
    assertFloatEquivalent(
      cascadeRoot({ display: "block" }, [para("a", 4), leftFloat("f", 200, 56), para("b", 10)]),
      PAGE,
    );
  });

  it("float taller than a full page (shadow spans ≥3 pages)", () => {
    // float [0,200] = 2.5 pages → incomingActiveFloats carried across pages 1 & 2.
    assertFloatEquivalent(
      cascadeRoot({ display: "block" }, [leftFloat("f", 200, 200), para("b", 24)]),
      PAGE,
    );
  });

  it("clear across a page boundary", () => {
    assertFloatEquivalent(
      cascadeRoot({ display: "block" }, [
        para("a", 4),
        leftFloat("f", 200, 56),
        createElementBox(
          "c",
          { display: "block", clear: "inline-start", whiteSpace: "pre" } as Style,
          [createTextBox("c-t", { whiteSpace: "pre" }, "C0\nC1\nC2")],
        ),
      ]),
      PAGE,
    );
  });

  it("two floats on different pages", () => {
    assertFloatEquivalent(
      cascadeRoot({ display: "block" }, [
        leftFloat("f0", 200, 32), para("a", 5), leftFloat("f1", 200, 32), para("b", 5),
      ]),
      PAGE,
    );
  });

  it("negative evidence: a late-page float does not narrow page 0", () => {
    assertFloatEquivalent(
      cascadeRoot({ display: "block" }, [para("a", 10), leftFloat("f", 200, 40), para("b", 5)]),
      PAGE,
    );
  });

  it("RTL doc with a logical-start float", () => {
    assertFloatEquivalent(
      cascadeRoot({ display: "block", direction: "rtl" } as Style, [
        para("a", 4), leftFloat("f", 200, 56), para("b", 10),
      ]),
      PAGE,
    );
  });

  it("float doc with non-zero page margins (per-page origin path)", () => {
    assertFloatEquivalent(
      cascadeRoot({ display: "block" }, [para("a", 3), leftFloat("f", 150, 60), para("b", 12)]),
      PAGE_MARGINED,
    );
  });
});

// ---------------------------------------------------------------------------
// (2) PR1-1: ordered-list + float — listCounterAtStart path-independence.
// ---------------------------------------------------------------------------

describe("float virtualization equivalence — ordered-list + float (PR1-1)", () => {
  it("list items beside/after a float crossing a page boundary advance the counter correctly", () => {
    const root = cascadeRoot({ display: "block" }, [
      listItem("li0", 2),
      leftFloat("f", 200, 56),
      listItem("li1", 3),
      listItem("li2", 3),
      listItem("li3", 3),
    ]);
    const pageConfig = PAGE;
    // Boundaries are oracle-exact (the float branch runs the real layoutBlock).
    assertFloatEquivalent(root, pageConfig);

    // PR1-1: each entry's `listCounterAtStart` must be PATH-INDEPENDENT — equal to
    // the value `accumulateListCounter` produces over the children consumed BEFORE
    // this page (the same advance `fitOnePage` does). Reconstruct that ground truth
    // independently from the plan's own per-page child ranges and assert the float
    // branch reproduces it exactly (a float item is a `block`, not a list-item, so
    // it contributes 0 to the counter — the floor/list ordering must survive it).
    const { metas, measurer } = buildHarness(root, pageConfig);
    const floatPlan = measurePass(
      metas, pageConfig, IMPLICIT_SECTION_PLAN, root.children,
      undefined, undefined, undefined, measurer,
    );
    let expectedCounter = 0;
    for (let i = 0; i < floatPlan.entries.length; i++) {
      const entry = nth(floatPlan.entries, i, "float entry");
      expect(entry.listCounterAtStart, `page ${i} listCounterAtStart`).toBe(expectedCounter);
      // Advance over the WHOLE children this page consumed (its `startIndex` up to
      // the next page's `startIndex`, or the doc end on the last page).
      const next = floatPlan.entries[i + 1];
      const end = next !== undefined ? next.startIndex : metas.length;
      for (let j = entry.startIndex; j < end; j++) {
        const m = metas[j];
        if (m !== undefined) expectedCounter = accumulateListCounter(m, expectedCounter);
      }
    }
    // Sanity: all four list items counted by the document end.
    expect(expectedCounter).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// (3) HIGHEST RISK: incremental re-measure == from-scratch (Task 6 Step 3).
// ---------------------------------------------------------------------------

describe("float virtualization equivalence — incremental == from-scratch (multi-page shadow)", () => {
  it("editing a block ABOVE a tall float re-measures byte-identically to from-scratch", () => {
    // BEFORE: para a(3) + tall float (shadow spans pages 1-3) + tail.
    const before = cascadeRoot({ display: "block" }, [
      para("a", 3), leftFloat("f", 200, 200), para("b", 24),
    ]);
    const pageConfig = PAGE;
    const beforeH = buildHarness(before, pageConfig);
    const beforePlan = measurePass(
      beforeH.metas, pageConfig, IMPLICIT_SECTION_PLAN, before.children,
      undefined, undefined, undefined, beforeH.measurer,
    );

    // EDITED: grow para a above the float (3 → 5 lines) — shifts every downstream
    // boundary, exercises the incremental carry-seeding across reused/refit pages.
    const edited = cascadeRoot({ display: "block" }, [
      para("a", 5), leftFloat("f", 200, 200), para("b", 24),
    ]);
    const editedH = buildHarness(edited, pageConfig);

    const fromScratch = measurePass(
      editedH.metas, pageConfig, IMPLICIT_SECTION_PLAN, edited.children,
      undefined, undefined, undefined, editedH.measurer,
    );
    const incremental = measurePass(
      editedH.metas, pageConfig, IMPLICIT_SECTION_PLAN, edited.children,
      beforePlan, undefined, undefined, editedH.measurer,
    );

    expect(incremental.entries.length, "page count").toBe(fromScratch.entries.length);
    for (let i = 0; i < fromScratch.entries.length; i++) {
      const inc = nth(incremental.entries, i, "incremental entry");
      const fs = nth(fromScratch.entries, i, "from-scratch entry");
      expect(inc.incomingActiveFloats, `page ${i} incomingActiveFloats`).toEqual(fs.incomingActiveFloats);
      expect(inc.startIndex, `page ${i} startIndex`).toBe(fs.startIndex);
      expect(inc.children.length, `page ${i} childrenCount`).toBe(fs.children.length);
      expect(inc.blockOffset, `page ${i} blockOffset`).toBe(fs.blockOffset);
      expect(breakTokensEqual(inc.resumeOut, fs.resumeOut), `page ${i} resumeOut`).toBe(true);
      expect(inc.listCounterAtStart, `page ${i} listCounterAtStart`).toBe(fs.listCounterAtStart);
    }
  });
});

// ---------------------------------------------------------------------------
// (4) PR2-B: the measurer's per-page origin == materializePage's per-page origin.
// ---------------------------------------------------------------------------

describe("float virtualization equivalence — per-page origin (PR2-B)", () => {
  it("the float-branch measurer receives inlineOrigin/blockOrigin == effMargins.inlineStart / effTopInset", () => {
    // For a header-free single-column float doc, materializePage lays the body at
    // origin (effMargins.inlineStart, effTopInset). With no header/footer slot,
    // effTopInset == effMargins.blockStart. The measure-pass float branch stamps
    // inlineOrigin = effCfg.pageMargins.inlineStart and blockOrigin = effTop (the
    // effective top inset). Capture every page's args and assert they equal the
    // raw page margins (the per-page origin materialize would use).
    const root = cascadeRoot({ display: "block" }, [para("a", 3), leftFloat("f", 150, 60), para("b", 12)]);
    const pageConfig = PAGE_MARGINED;
    const { metas } = buildHarness(root, pageConfig);
    const shaper = createMockShaper(8, 16);
    const pageContentInlineSize =
      pageConfig.pageInlineSize - pageConfig.pageMargins.inlineStart - pageConfig.pageMargins.inlineEnd;
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize);
    const contentCtx: LayoutContext = { ...ctx, containingInlineSize: pageContentInlineSize };
    const inner = makeMeasurer(root, shaper, contentCtx, metas);

    const seen: { inlineOrigin: number; blockOrigin: number }[] = [];
    const spyMeasurer: FloatPageMeasurer = (a) => {
      seen.push({ inlineOrigin: a.inlineOrigin, blockOrigin: a.blockOrigin });
      return inner(a);
    };
    measurePass(
      metas, pageConfig, IMPLICIT_SECTION_PLAN, root.children,
      undefined, undefined, undefined, spyMeasurer,
    );

    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen) {
      // No header slot ⇒ effTopInset == raw blockStart; inline origin == raw inlineStart.
      expect(s.inlineOrigin).toBe(pageConfig.pageMargins.inlineStart);
      expect(s.blockOrigin).toBe(pageConfig.pageMargins.blockStart);
    }
  });
});

// ---------------------------------------------------------------------------
// (5) The gate truth-table (Task 5 Step 3).
// ---------------------------------------------------------------------------

describe("paginationFallsBackToLegacy gate truth-table", () => {
  it("single-column float doc → false (virtual)", () => {
    const root = cascadeRoot({ display: "block" }, [para("a", 3), leftFloat("f", 200, 40), para("b", 5)]);
    expect(paginationFallsBackToLegacy(root, [])).toBe(false);
  });

  it("float + footnote → true (legacy)", () => {
    const root = cascadeRoot({ display: "block" }, [para("a", 3), leftFloat("f", 200, 40), para("b", 5)]);
    // A non-empty footnoteAnchors array routes a float doc to legacy (the gate
    // only reads `.length`, so a minimal valid anchor suffices).
    const anchors: readonly FootnoteAnchorRef[] = [
      { blockId: "a" as BlockId, contentBlockId: "fn0" as BlockId, sectionId: null },
    ];
    expect(paginationFallsBackToLegacy(root, anchors)).toBe(true);
  });

  it("float + multicol → true (legacy)", () => {
    // A doc-root multi-column region (columnCount > 1 in metadata — the source
    // `resolveColumnConfig` reads) WITH a float ⇒ legacy.
    const root = cascadeMulticolRoot(2, [para("a", 3), leftFloat("f", 200, 40), para("b", 5)]);
    expect(paginationFallsBackToLegacy(root, [])).toBe(true);
  });

  it("position:absolute doc → true (legacy)", () => {
    const root = cascadeRoot({ display: "block" }, [
      para("a", 3),
      createElementBox("abs", { display: "block", position: "absolute" } as Style, [
        createTextBox("abs-t", {}, "x"),
      ]),
    ]);
    expect(paginationFallsBackToLegacy(root, [])).toBe(true);
  });

  it("float-free doc → false (virtual)", () => {
    const root = cascadeRoot({ display: "block" }, [para("a", 3), para("b", 5)]);
    expect(paginationFallsBackToLegacy(root, [])).toBe(false);
  });

  it("multicol WITHOUT float → false (virtual handles plain multicol)", () => {
    const root = cascadeMulticolRoot(2, [para("a", 3), para("b", 5)]);
    expect(paginationFallsBackToLegacy(root, [])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (6) #528 — MULTI-PUSHED-FLOAT measure ↔ materialize equivalence (Task 5 #8).
//
// The oracle (legacy `paginateRoot`) does NOT push floats (scoped out), so it
// cannot be the reference for a pushing doc. Instead we prove the load-bearing
// property of the virtualized fast-path DIRECTLY: a PUSHING-enabled measurer
// (mirroring the production producer — seeds incoming pushed floats via
// `placeIncomingPushedFloats`, then `layoutBlock` with `enableFloatPushing`)
// and the materialize tree (`makeVirtualLayoutTree` with float pushing on) agree
// page-for-page on a doc that pushes MULTIPLE floats. Equivalence holds by
// construction (both run the same `layoutBlock` + seed step); this is the proof.
// ---------------------------------------------------------------------------

/** A PUSHING-aware float measurer mirroring the production producer (virtual-producer.ts). */
function makePushingMeasurer(
  root: ElementBox,
  shaper: ReturnType<typeof createMockShaper>,
  contentCtx: LayoutContext,
  metas: ReturnType<typeof buildBlockFitMetas>,
): FloatPageMeasurer {
  return (a) => {
    const env = createFloatEnvironment();
    for (const f of a.incomingFloats) env.seedPlaced(f);
    const pageCtx: LayoutContext = { ...contentCtx, floatEnv: env, isBFCRoot: true };
    placeIncomingPushedFloats(
      a.incomingPushedFloats, env, pageCtx, root, shaper, undefined, a.pageFlowBase,
    );
    const { box, breakToken, inFlowConsumed } = layoutBlock(
      root, a.inlineOrigin, a.blockOrigin, pageCtx, shaper, undefined,
      {
        availableBlockSize: a.contentBlockSize,
        pageIndex: 0,
        resumeFrom: a.resumeInto,
        stopBeforeIndex: a.stopBeforeIndex,
        enableFloatPushing: true,
      },
      a.pageFlowBase,
    );
    const nextStartIndex =
      breakToken === null
        ? root.children.length
        : breakToken.type === "block"
          ? breakToken.resumeChildIndex
          : a.startIndex;
    let listCounterAtEnd = a.listCounterAtStart;
    for (let i = a.startIndex; i < nextStartIndex; i++) {
      const m = metas[i];
      if (m !== undefined) listCounterAtEnd = accumulateListCounter(m, listCounterAtEnd);
    }
    return {
      resumeOut: breakToken,
      inFlowConsumed: box !== null ? inFlowConsumed : 0,
      childrenCount: nextStartIndex - a.startIndex,
      listCounterAtEnd,
      placedFloats: env.getPlacedFloats().slice(),
      pushedFloats: env.pushedFloats().slice(),
    };
  };
}

function buildPushingTree(root: ElementBox, pageConfig: PageConfig) {
  const shaper = createMockShaper(8, 16);
  const margins = pageConfig.pageMargins;
  const pageContentInlineSize =
    pageConfig.pageInlineSize - margins.inlineStart - margins.inlineEnd;
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize);
  const contentCtx: LayoutContext = { ...ctx, containingInlineSize: pageContentInlineSize };
  const metas = buildBlockFitMetas(root, shaper, undefined, pageContentInlineSize);
  const measurer = makePushingMeasurer(root, shaper, contentCtx, metas);
  const plan = measurePass(
    metas, pageConfig, IMPLICIT_SECTION_PLAN, root.children,
    undefined, undefined, undefined, measurer,
  );
  const tree = makeVirtualLayoutTree(
    plan, root, ctx, shaper, pageConfig,
    undefined, undefined, undefined, plan, undefined, undefined, undefined,
    undefined, undefined, /* enableFloatPushing */ true,
  );
  return { plan, tree };
}

function findBoxByKey(box: LayoutBox, key: string): LayoutBox | null {
  if (box.key === key) return box;
  if ("children" in box) {
    for (const c of box.children) {
      const r = findBoxByKey(c, key);
      if (r !== null) return r;
    }
  }
  return null;
}
function floatInPage(page: PageBox, key: string): LayoutBox | null {
  for (const child of page.children) {
    const r = findBoxByKey(child, key);
    if (r !== null) return r;
  }
  return null;
}

describe("float virtualization equivalence — multi-pushed measure ↔ materialize (#528)", () => {
  it("a doc that pushes MULTIPLE floats: measure page boundaries == materialize geometry", () => {
    // Page 1: 4 lines of "a" fill [0,64], leaving 16px. Three floats too tall for
    // the remaining 16px are all PUSHED to page 2. f0 (500px wide) forces f1 (200px)
    // to push BELOW it (only 100px free beside f0); the narrow inline-end f2 (80px)
    // coexists at the page-2 content top. Trailing "b" keeps page 1 flowing.
    const root = cascadeRoot({ display: "block" }, [
      para("a", 4),
      leftFloat("f0", 500, 40),
      leftFloat("f1", 200, 30),
      rightFloat("f2", 80, 25),
      para("b", 8),
    ]);
    const { plan, tree } = buildPushingTree(root, PAGE);

    // The measure plan carries all three floats as incoming-pushed into page 2.
    const page2Plan = nth(plan.entries, 1, "page-2 plan entry");
    const pushedKeys = page2Plan.incomingPushedFloats.map((pf) =>
      pf.node.type === "element" ? pf.node.key : "",
    );
    expect(pushedKeys, "all three floats pushed into page 2 in source order").toEqual(["f0", "f1", "f2"]);

    // Measure page boundaries == materialize page boundaries (cumulative tops).
    for (let i = 0; i < plan.entries.length; i++) {
      const entry = nth(plan.entries, i, "plan entry");
      const page = tree.getPage(i);
      expect(page.blockOffset, `page ${i} cumulative top: measure == materialize`).toBe(entry.blockOffset);
    }

    // The pushed floats MATERIALIZE on page 2 with the placement the measure env
    // computed: f0 at the content top, f1 push-belowed under it, f2 (opposite side)
    // at the content top — proving the measure-pass carry and materialize placement
    // produce identical geometry.
    const page2 = tree.getPage(1);
    const f0 = floatInPage(page2, "f0");
    const f1 = floatInPage(page2, "f1");
    const f2 = floatInPage(page2, "f2");
    expect(f0, "f0 materialized on page 2").not.toBeNull();
    expect(f1, "f1 materialized on page 2").not.toBeNull();
    expect(f2, "f2 materialized on page 2").not.toBeNull();
    if (f0 === null || f1 === null || f2 === null) throw new Error("unreachable");
    expect(f0.blockOffset, "f0 at page-2 content top").toBe(0);
    expect(f1.blockOffset, "f1 push-belowed under f0").toBe(40);
    expect(f2.blockOffset, "f2 (opposite side) at content top").toBe(0);
  });
});
