// packages/core/src/integration/floats-pagination.test.ts
//
// #528 cross-page float PUSHING — end-to-end behavior through the virtualized
// fast-path (measure producer + materialize consumer). A float that does NOT fit
// the remaining block space on its page is deferred ("pushed") to the TOP of the
// next page; in-flow content keeps flowing on the source page; the landing page's
// lines narrow beside the placed float.
//
// The plan is built with a `floatPageMeasurer` that MIRRORS the production
// producer closure (virtual-producer.ts) exactly, then `makeVirtualLayoutTree` +
// `getPage(i)` materializes real PageBoxes whose float / line geometry we assert.
// We deliberately do NOT compare against `runOracle` here: the oracle runs the
// LEGACY `paginateRoot` path, which is scoped OUT of float pushing — only the
// virtualized fast-path pushes. (Equivalence between the measure and materialize
// halves of the fast-path is proven separately in
// float-virtualization-equivalence.test.ts.)

import { describe, it, expect } from "vitest";
import type { LayoutContext } from "../layout/layout-context";
import { layoutBlock, placeIncomingPushedFloats } from "../layout/bfc";
import { createMockShaper } from "@taleweaver/core";
import { makeRootContext } from "../layout/layout-context";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import type { Style } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { createElementBox, createTextBox } from "@taleweaver/core";
import type { ElementBox } from "@taleweaver/core";
import type { PageConfig } from "../layout/page-config";
import type { PageBox } from "../layout/page-box";
import type { LayoutBox } from "../layout/layout-box";
import { buildBlockFitMetas } from "../layout/build-fit-metas";
import { measurePass, type FloatPageMeasurer } from "../layout/measure-pass";
import { accumulateListCounter } from "../layout/fit-core";
import { createFloatEnvironment } from "../layout/float-context";
import { IMPLICIT_SECTION_PLAN } from "../layout/section-plan";
import { makeVirtualLayoutTree } from "../layout/virtual-layout-tree";

// 5 lines/page @ the mock shaper's 16px line-height; no margins so page-2 content
// top == 0 (page-relative).
const PAGE: PageConfig = {
  pageInlineSize: 600,
  pageBlockSize: 80,
  pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
  pageGap: 20,
};

function cascadeRoot(rootStyle: Style, children: readonly ElementBox[]): ElementBox {
  const root = createElementBox("root", rootStyle, children);
  const cascaded = cascadePass(root);
  if (cascaded.type !== "element") throw new Error("cascadePass returned non-element");
  return cascaded;
}

function para(id: string, n: number, extra?: Style): ElementBox {
  const style: Style = { display: "block", whiteSpace: "pre", ...(extra ?? {}) };
  return createElementBox(id, style, [
    createTextBox(`${id}-t`, { whiteSpace: "pre" }, Array.from({ length: n }, (_, i) => `${id}${i}`).join("\n")),
  ]);
}
function leftFloat(id: string, w: number, h: number): ElementBox {
  const style: Style = { display: "block", float: "inline-start", inlineSize: w, blockSize: h };
  return createElementBox(id, style, []);
}
function rightFloat(id: string, w: number, h: number): ElementBox {
  const style: Style = { display: "block", float: "inline-end", inlineSize: w, blockSize: h };
  return createElementBox(id, style, []);
}
/** A `clear` block carrying `n` lines of text, so we can read its placed blockOffset. */
function clearBlock(id: string, clear: "inline-start" | "inline-end" | "both", n: number): ElementBox {
  const style: Style = { display: "block", whiteSpace: "pre", clear };
  return createElementBox(id, style, [
    createTextBox(`${id}-t`, { whiteSpace: "pre" }, Array.from({ length: n }, (_, i) => `${id}${i}`).join("\n")),
  ]);
}
function listItem(id: string, n: number): ElementBox {
  const style: Style = { display: "list-item", whiteSpace: "pre" };
  return createElementBox(id, style, [
    createTextBox(`${id}-t`, { whiteSpace: "pre" }, Array.from({ length: n }, (_, i) => `${id}${i}`).join("\n")),
  ]);
}

/**
 * Mirror the production `floatPageMeasurer` (virtual-producer.ts) field-for-field
 * so the measure plan a float doc gets here matches what production builds. The
 * pushed-float channel is now LIVE: `pushedFloats: env.pushedFloats()` (T4).
 */
function makeMeasurer(
  root: ElementBox,
  shaper: ReturnType<typeof createMockShaper>,
  contentCtx: LayoutContext,
  metas: ReturnType<typeof buildBlockFitMetas>,
): FloatPageMeasurer {
  return (a) => {
    const env = createFloatEnvironment();
    for (const f of a.incomingFloats) env.seedPlaced(f);
    const pageCtx: LayoutContext = { ...contentCtx, floatEnv: env, isBFCRoot: true };
    // #528 (T4): place the floats PUSHED from the prior page at this page's content
    // top, AFTER the active-shadow seed and BEFORE the body `layoutBlock` — exactly
    // as the production producer (virtual-producer.ts) does, so the measure plan
    // built here mirrors production.
    placeIncomingPushedFloats(
      a.incomingPushedFloats, env, pageCtx, root, shaper, undefined, a.pageFlowBase,
    );
    const { box, breakToken, inFlowConsumed } = layoutBlock(
      root,
      a.inlineOrigin,
      a.blockOrigin,
      pageCtx,
      shaper,
      undefined,
      {
        availableBlockSize: a.contentBlockSize,
        pageIndex: 0,
        resumeFrom: a.resumeInto,
        stopBeforeIndex: a.stopBeforeIndex,
        // #528: opt the measure pass into float pushing, mirroring the production
        // producer (virtual-producer.ts) so a non-fitting float defers here too.
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

function buildTree(root: ElementBox, pageConfig: PageConfig) {
  const shaper = createMockShaper(8, 16);
  const margins = pageConfig.pageMargins;
  const pageContentInlineSize =
    pageConfig.pageInlineSize - margins.inlineStart - margins.inlineEnd;
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, pageConfig.pageInlineSize);
  const contentCtx: LayoutContext = { ...ctx, containingInlineSize: pageContentInlineSize };
  const metas = buildBlockFitMetas(root, shaper, undefined, pageContentInlineSize);
  const measurer = makeMeasurer(root, shaper, contentCtx, metas);
  const plan = measurePass(
    metas, pageConfig, IMPLICIT_SECTION_PLAN, root.children,
    undefined, undefined, undefined, measurer,
  );
  // #528: enable float pushing in materialize, mirroring the production producer
  // (which passes `docHasFloat`). The trailing positional args default through to
  // `enableFloatPushing` (the last param).
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

function findFloatInPage(page: PageBox, key: string): LayoutBox | null {
  for (const child of page.children) {
    const r = findBoxByKey(child, key);
    if (r !== null) return r;
  }
  return null;
}

/** All LineBoxes in a page, in tree order. */
function collectLines(box: LayoutBox, out: LayoutBox[]): void {
  if (box.type === "line") out.push(box);
  if ("children" in box) for (const c of box.children) collectLines(c, out);
}
function pageLines(page: PageBox): LayoutBox[] {
  const out: LayoutBox[] = [];
  for (const child of page.children) collectLines(child, out);
  return out;
}

describe("#528 cross-page float pushing — virtualized fast-path", () => {
  it("a float that does not fit the remaining page space is pushed to the top of the next page", () => {
    // Page 1 (height 80 = 5 lines): 3 lines of "a" fill [0,48], leaving 32px. A
    // 200×40 left float requested at cumulative offset 48 would span [48,88] —
    // past the 80 page bottom — so it is PUSHED to page 2's content top. Trailing
    // "b" text keeps flowing into page 1's remaining two lines ([48,64], [64,80]).
    // On page 2 the float occupies [0,40] and the body lines beside it narrow.
    const root = cascadeRoot({ display: "block" }, [
      para("a", 3),
      leftFloat("f", 200, 40),
      para("b", 6),
    ]);
    const { tree } = buildTree(root, PAGE);

    // (1) The float lands on page 2, at its content top (page-relative blockOffset 0).
    const page0 = tree.getPage(0);
    const page1 = tree.getPage(1);
    expect(findFloatInPage(page0, "f"), "float must NOT be on page 1").toBeNull();
    const floatBox = findFloatInPage(page1, "f");
    expect(floatBox, "float must be on page 2").not.toBeNull();
    if (floatBox === null) throw new Error("unreachable");
    expect(floatBox.blockOffset, "float at page-2 content top").toBe(0);

    // (2) In-flow content AFTER the float still occupies page 1 (NOT deferred with
    // the float): page 1 carries the 4 "a" lines PLUS at least the leading "b"
    // line on its last row.
    const lines0 = pageLines(page0);
    expect(lines0.length, "page 1 keeps flowing in-flow content past the pushed float").toBeGreaterThanOrEqual(5);

    // (3) Lines beside the float on page 2 are narrowed by its exclusion region.
    const lines1 = pageLines(page1);
    const fullWidth = PAGE.pageInlineSize; // no margins
    const firstLine1 = lines1[0];
    expect(firstLine1, "page 2 has body lines").not.toBeUndefined();
    if (firstLine1 === undefined) throw new Error("unreachable");
    expect(firstLine1.inlineSize, "line beside the float is narrowed").toBeLessThan(fullWidth);
  });

  it("a float pushed off the LAST page lands on a NEW trailing page (not dropped)", () => {
    // Page 1 (height 80 = 5 lines): 5 lines of "a" fill [0,80] exactly. The LAST
    // child is a 200×40 left float requested at cumulative offset 80 — past the 80
    // page bottom — so it is PUSHED. There is NO in-flow content after it, so the
    // in-flow stream is exhausted on page 1 (`resumeOut === null`). Before the
    // last-page fix the measure loop broke here, dropping the pushed float (data
    // loss). The fix emits ONE MORE trailing page whose only job is to land the
    // pushed float at its content top.
    const root = cascadeRoot({ display: "block" }, [para("a", 5), leftFloat("f", 200, 40)]);
    const { plan, tree } = buildTree(root, PAGE);

    // A trailing page must exist beyond page 1 (the in-flow's last page).
    expect(plan.entries.length, "a trailing landing page is emitted").toBeGreaterThanOrEqual(2);

    const page0 = tree.getPage(0);
    const page1 = tree.getPage(1);
    // The float is NOT dropped: it materializes on the trailing page, at its content top.
    expect(findFloatInPage(page0, "f"), "float must NOT be on page 1").toBeNull();
    const floatBox = findFloatInPage(page1, "f");
    expect(floatBox, "pushed float must land on the trailing page (not dropped)").not.toBeNull();
    if (floatBox === null) throw new Error("unreachable");
    expect(floatBox.blockOffset, "float at trailing-page content top").toBe(0);

    // The trailing page carries NO in-flow body lines (it exists only to land the float).
    expect(pageLines(page1).length, "trailing page has no in-flow lines").toBe(0);
  });

  // T5.1 — `clear` NEGATIVE on the SOURCE page. A `clear: both` block AFTER a
  // pushed float on page 1 is NOT cleared by that float (it left page 1). The
  // clear block's blockOffset is governed only by the in-flow content above it,
  // unaffected by the pushed (unplaced) float. Design §5 / test #4.
  it("a clear block after a pushed float on the source page is NOT cleared by it", () => {
    // Page 1: 3 lines of "a" fill [0,48], leaving 32px. A 200×40 left float
    // requested at 48 → [48,88] past the 80 bottom → PUSHED to page 2. A
    // `clear: both` block follows. Because the float is NOT placed on page 1,
    // clearance("both", 48) === 48 — the clear block flows straight at 48, the
    // next in-flow row, NOT pushed below any phantom float bottom.
    const root = cascadeRoot({ display: "block" }, [
      para("a", 3),
      leftFloat("f", 200, 40),
      clearBlock("c", "both", 1),
    ]);
    const { tree } = buildTree(root, PAGE);
    const page0 = tree.getPage(0);
    const page1 = tree.getPage(1);

    // The float is pushed off page 1.
    expect(findFloatInPage(page0, "f"), "float pushed off page 1").toBeNull();
    expect(findFloatInPage(page1, "f"), "float lands on page 2").not.toBeNull();

    // The clear block's content sits at the next in-flow row (48), unaffected by
    // the pushed float. Were the float erroneously visible to clear on page 1, the
    // line would be pushed below its bottom (>= 88 / off this page).
    const c = findBoxByKey(page0, "c");
    expect(c, "clear block on page 1").not.toBeNull();
    if (c === null) throw new Error("unreachable");
    expect(c.blockOffset, "clear block at the in-flow row, NOT cleared by the pushed float").toBe(48);
  });

  // T5.2 — `clear` POSITIVE on the LANDING page. A pushed float integrates into
  // the landing page's float env, so a `clear: inline-start` block that flows
  // onto the landing page beside it IS cleared by it (sits at/below the float's
  // bottom). Design §5 / test #5 — proves the pushed float is a first-class
  // placed float on its landing page.
  it("a clear block on the landing page IS cleared by the pushed float", () => {
    // Page 1: 5 lines of "a" fill [0,80] exactly. A 200×40 left float requested at
    // 80 → past the bottom → PUSHED to page 2 ([0,40]). A `clear: inline-start`
    // block follows in source; with the in-flow stream exhausted on page 1, it
    // flows onto page 2 AFTER the pushed float and must clear it → blockOffset >= 40.
    const root = cascadeRoot({ display: "block" }, [
      para("a", 5),
      leftFloat("f", 200, 40),
      clearBlock("c", "inline-start", 1),
    ]);
    const { tree } = buildTree(root, PAGE);
    const page1 = tree.getPage(1);

    const floatBox = findFloatInPage(page1, "f");
    expect(floatBox, "float lands on page 2").not.toBeNull();
    if (floatBox === null) throw new Error("unreachable");
    expect(floatBox.blockOffset, "pushed float at page-2 content top").toBe(0);

    const c = findBoxByKey(page1, "c");
    expect(c, "clear block on page 2").not.toBeNull();
    if (c === null) throw new Error("unreachable");
    // The pushed float occupies [0,40] on page 2; clearing inline-start drops the
    // block to its bottom edge.
    expect(c.blockOffset, "clear block cleared below the pushed float's bottom").toBeGreaterThanOrEqual(40);
  });

  // T5.3 — MULTIPLE pushed floats land in SOURCE order, plus an opposite-side
  // pushed float coexists at the page-top. Design test #6 (Q4/Q5).
  it("two same-side pushed floats land in source order; an opposite-side pushed float coexists at the top", () => {
    // Page 1: 4 lines of "a" fill [0,64], leaving 16px. Three floats requested
    // near the bottom, all too tall for the remaining 16px → all PUSHED to page 2.
    // On the 600px-wide content box, f0 is 500px wide so a second inline-start
    // float CANNOT fit beside it (only 100px free) and must push below; the
    // narrow 80px inline-end float still fits beside f0 at the content top:
    //   f0 inline-start 500×40, f1 inline-start 200×30, f2 inline-end 80×25.
    // Trailing "b" keeps page 1 flowing. On page 2 (source order):
    //   f0 lands at [0,40] (inline-start, content top),
    //   f1 push-belows f0 → [40,70] (same side, below f0's bottom),
    //   f2 (opposite side) coexists at the content top [0,25] (inline-end).
    const root = cascadeRoot({ display: "block" }, [
      para("a", 4),
      leftFloat("f0", 500, 40),
      leftFloat("f1", 200, 30),
      rightFloat("f2", 80, 25),
      para("b", 8),
    ]);
    const { tree } = buildTree(root, PAGE);
    const page0 = tree.getPage(0);
    const page1 = tree.getPage(1);

    // None of the three floats is placed on page 1.
    expect(findFloatInPage(page0, "f0"), "f0 pushed off page 1").toBeNull();
    expect(findFloatInPage(page0, "f1"), "f1 pushed off page 1").toBeNull();
    expect(findFloatInPage(page0, "f2"), "f2 pushed off page 1").toBeNull();

    const f0 = findFloatInPage(page1, "f0");
    const f1 = findFloatInPage(page1, "f1");
    const f2 = findFloatInPage(page1, "f2");
    expect(f0, "f0 on page 2").not.toBeNull();
    expect(f1, "f1 on page 2").not.toBeNull();
    expect(f2, "f2 on page 2").not.toBeNull();
    if (f0 === null || f1 === null || f2 === null) throw new Error("unreachable");

    // Same-side source order: f0 at the content top, f1 push-belowed under it.
    expect(f0.blockOffset, "first same-side float at content top").toBe(0);
    expect(f1.blockOffset, "second same-side float push-belowed under the first").toBe(40);
    // Opposite-side float coexists at the content top.
    expect(f2.blockOffset, "opposite-side float at content top").toBe(0);
  });

  // T5.4 — TALLER-THAN-A-WHOLE-PAGE bound (termination). A float taller than a
  // whole page, on an otherwise-empty page, OVERFLOWS (is placed once, NOT
  // re-pushed infinitely). Design test #7 / Mechanism §2 "Termination".
  it("a float taller than a whole page overflows (is placed, not re-pushed) — bounded page count", () => {
    // Page 1: 4 lines of "a" fill [0,64], leaving 16px. A 200×200 left float (2.5
    // pages tall) requested at 64 does not fit → PUSHED. On page 2 it arrives on an
    // otherwise-empty page, so the empty-page predicate PLACES it (overflow) rather
    // than re-pushing — guaranteeing termination.
    const root = cascadeRoot({ display: "block" }, [para("a", 4), leftFloat("f", 200, 200)]);
    const { plan, tree } = buildTree(root, PAGE);

    // Bounded: a 200px float over an 80px page is at most a handful of pages; it
    // does NOT loop forever (the test merely completing proves termination).
    expect(plan.entries.length, "page count is bounded (no infinite push)").toBeLessThan(10);

    // The float is NOT on page 1 (didn't fit the remaining 16px) and IS placed
    // (materialized) on the next page — overflow, not dropped or re-pushed forever.
    expect(findFloatInPage(tree.getPage(0), "f"), "float not on page 1").toBeNull();
    const floatBox = findFloatInPage(tree.getPage(1), "f");
    expect(floatBox, "tall float placed (overflowing) on page 2, not re-pushed").not.toBeNull();
    if (floatBox === null) throw new Error("unreachable");
    expect(floatBox.blockOffset, "tall float at the empty landing-page content top").toBe(0);
  });

  // T5.5 — COUNTER-LEAK regression. A float pushed from page 1 between list items
  // must NOT perturb the in-flow list counter of items after it on the source
  // page. Floats are out-of-flow, so the per-page `listCounterAtStart` thread must
  // be identical whether the float fits or is pushed. Design §"Side-effect
  // idempotence" Option-C residual. If GREEN, it PINS the property.
  it("pushing a float does not perturb the in-flow list counter of subsequent items", () => {
    // li0..li4 are list-items; a left float requested mid-stream is pushed when it
    // doesn't fit the remaining page space. The per-page `listCounterAtStart` must
    // match the float-free baseline advance: each list-item advances the counter by
    // 1; the (out-of-flow) float advances it by 0 — whether placed or pushed.
    const root = cascadeRoot({ display: "block" }, [
      listItem("li0", 2),
      listItem("li1", 2),
      leftFloat("f", 200, 40),
      listItem("li2", 3),
      listItem("li3", 3),
      listItem("li4", 3),
    ]);
    const { plan } = buildTree(root, PAGE);

    // Reconstruct the ground-truth counter advance independently from the plan's
    // own per-page child ranges — exactly as the equivalence harness does. The
    // float (a `block`, not a `list-item`) contributes 0; a leaked discarded-layout
    // counter delta from the pushed float would break this equality.
    const shaper = createMockShaper(8, 16);
    const pageContentInlineSize = PAGE.pageInlineSize;
    const metas = buildBlockFitMetas(root, shaper, undefined, pageContentInlineSize);
    let expectedCounter = 0;
    for (let i = 0; i < plan.entries.length; i++) {
      const entry = plan.entries[i];
      if (entry === undefined) throw new Error("unreachable");
      expect(entry.listCounterAtStart, `page ${i} listCounterAtStart unaffected by the pushed float`).toBe(expectedCounter);
      const next = plan.entries[i + 1];
      const end = next !== undefined ? next.startIndex : metas.length;
      for (let j = entry.startIndex; j < end; j++) {
        const m = metas[j];
        if (m !== undefined) expectedCounter = accumulateListCounter(m, expectedCounter);
      }
    }
    // Sanity: all five list-items counted by the document end (float contributes 0).
    expect(expectedCounter, "five list-items counted; float contributes nothing").toBe(5);
  });
});
