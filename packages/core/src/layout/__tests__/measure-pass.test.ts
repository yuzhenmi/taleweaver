// packages/core/src/layout/__tests__/measure-pass.test.ts
//
// Direct unit tests for `measurePass` + `measurePassUnsupported`. The broad
// oracle-driven equivalence suite lives in `measure-pass-equivalence.test.ts`;
// these assert the plan SHAPE (offsets, slices, resume tokens, totals) and the
// unsupported-doc fallback detector (now ONLY float/clear — padded/bordered
// containers and mixed content are modeled per #253/#254) on hand-built inputs.

import { describe, it, expect } from "vitest";
import {
  measurePass,
  measurePassUnsupported,
  __getFitOnePageCallCountForTest,
  __resetFitOnePageCallCountForTest,
} from "../measure-pass";
import type { BlockFitMeta } from "../fit-core";
import type { PageConfig } from "../page-config";
import { cascadePass, cascadePassIncremental } from "../../cascade";
import { createElementBox, createTextBox } from "../../render/render-node";
import type { ElementBox, RenderNode } from "../../render/render-node";
import type { Style } from "../../styles";
import type { BlockId } from "../../state/block-id";
import { buildBlockFitMetas } from "../build-fit-metas";
import { createMockShaper } from "../mock-shaper";
import { flattenContents } from "../group-children";
import {
  buildSectionPlan,
  IMPLICIT_SECTION_PLAN,
  type SectionPlan,
} from "../section-plan";

function blockMeta(totalBlockSize: number, extra?: Partial<BlockFitMeta>): BlockFitMeta {
  return {
    kind: "block",
    marginBlockStart: 0,
    marginBlockEnd: 0,
    breakBefore: "auto",
    breakAfter: "auto",
    breakInsideAvoid: false,
    totalBlockSize,
    children: [],
    ...extra,
  };
}

const PAGE: PageConfig = {
  pageInlineSize: 600,
  pageBlockSize: 300,
  pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
  pageGap: 20,
};

describe("measurePass", () => {
  it("single page when all blocks fit", () => {
    const metas = [blockMeta(50), blockMeta(50), blockMeta(50)];
    const plan = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN);
    expect(plan.entries.length).toBe(1);
    expect(plan.entries[0].pageIndex).toBe(0);
    expect(plan.entries[0].blockOffset).toBe(0);
    expect(plan.entries[0].resumeInto).toBeNull();
    expect(plan.entries[0].resumeOut).toBeNull();
    expect(plan.totalBlockSize).toBe(300);
  });

  it("multi-page: per-entry blockOffset = pageIndex * (pageBlockSize + pageGap)", () => {
    // 10 × 100; page content 300 ⇒ 3 per page ⇒ 4 pages.
    const metas = Array.from({ length: 10 }, () => blockMeta(100));
    const plan = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN);
    expect(plan.entries.length).toBe(4);
    expect(plan.entries.map((e) => e.blockOffset)).toEqual([0, 320, 640, 960]);
    expect(plan.entries.map((e) => e.startIndex)).toEqual([0, 3, 6, 9]);
    // total = 4 pages × 300 + 3 gaps × 20 = 1260.
    expect(plan.totalBlockSize).toBe(1260);
  });

  it("resume tokens chain across pages", () => {
    const metas = Array.from({ length: 5 }, () => blockMeta(100));
    const plan = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN);
    expect(plan.entries[0].resumeInto).toBeNull();
    expect(plan.entries[0].resumeOut).toEqual({
      type: "block",
      resumeChildIndex: 3,
      resumeChildToken: null,
    });
    expect(plan.entries[1].resumeInto).toEqual(plan.entries[0].resumeOut);
    expect(plan.entries[1].resumeOut).toBeNull();
  });

  it("attaches children slices when rootChildren provided", () => {
    const metas = Array.from({ length: 5 }, () => blockMeta(100));
    const fakeChildren = Array.from({ length: 5 }, (_, i) => ({ id: i }));
    // measurePass slices by index; pass arbitrary refs to verify slicing.
    const plan = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN, fakeChildren as never[]);
    expect(plan.entries[0].children).toEqual([{ id: 0 }, { id: 1 }, { id: 2 }]);
    expect(plan.entries[1].children).toEqual([{ id: 3 }, { id: 4 }]);
  });

  it("empty children when rootChildren omitted", () => {
    const plan = measurePass([blockMeta(50)], PAGE, IMPLICIT_SECTION_PLAN);
    expect(plan.entries[0].children).toEqual([]);
  });

  it("seeds listCounterAtStart per page", () => {
    // 9 list-items of 100; 3 per page ⇒ page seeds 0, 3, 6.
    const metas = Array.from({ length: 9 }, () => blockMeta(100, { listItem: true }));
    const plan = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN);
    expect(plan.entries.map((e) => e.listCounterAtStart)).toEqual([0, 3, 6]);
  });

  it("throws on a degenerate page config (content block-size <= 0)", () => {
    const bad: PageConfig = { ...PAGE, pageMargins: { blockStart: 200, blockEnd: 200, inlineStart: 0, inlineEnd: 0 } };
    expect(() => measurePass([blockMeta(50)], bad, IMPLICIT_SECTION_PLAN)).toThrow();
  });

  it("stays within the safe page-count bound for a healthy multi-page doc", () => {
    // The page-count guard (`pageIndex > metas.length * 2 + 2`) is unreachable
    // whenever each page advances state. A normal doc that produces many pages
    // (50 blocks, 3/page ⇒ ~17 pages, well under the bound 50*2+2=102) must
    // never trip it.
    const metas = Array.from({ length: 50 }, () => blockMeta(100));
    expect(() => measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN)).not.toThrow();
    const plan = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN);
    expect(plan.entries.length).toBeLessThanOrEqual(metas.length * 2 + 2);
  });
});

describe("measurePass — pageIndexAtBlockOffset", () => {
  // 10 × 100; page content 300 ⇒ 3 per page ⇒ 4 pages.
  // blockOffsets: [0, 320, 640, 960]; pageBlockSize 300, pageGap 20.
  // totalBlockSize = 4 × 300 + 3 × 20 = 1260.
  const metas = Array.from({ length: 10 }, () => blockMeta(100));

  it("y in the middle of page 0 → 0", () => {
    const plan = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN);
    expect(plan.pageIndexAtBlockOffset(150)).toBe(0);
  });

  it("y at the exact top edge of a page → that page", () => {
    const plan = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN);
    expect(plan.pageIndexAtBlockOffset(0)).toBe(0);
    expect(plan.pageIndexAtBlockOffset(320)).toBe(1);
    expect(plan.pageIndexAtBlockOffset(640)).toBe(2);
    expect(plan.pageIndexAtBlockOffset(960)).toBe(3);
  });

  it("y in the middle of page 2 → 2", () => {
    const plan = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN);
    // page 2 spans [640, 960); 800 is inside it.
    expect(plan.pageIndexAtBlockOffset(800)).toBe(2);
  });

  it("y in the inter-page gap → the page above (half-open interval)", () => {
    const plan = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN);
    // gap after page 0 spans [300, 320); 310 belongs to page 0 (the interval
    // [entry.blockOffset, nextEntry.blockOffset) extends through the gap).
    expect(plan.pageIndexAtBlockOffset(310)).toBe(0);
    // gap after page 2 spans [940, 960); 950 belongs to page 2.
    expect(plan.pageIndexAtBlockOffset(950)).toBe(2);
  });

  it("y just below totalBlockSize → last page; y == totalBlockSize → last page (clamp)", () => {
    const plan = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN);
    // last page spans [960, 1260); 1259 is inside.
    expect(plan.pageIndexAtBlockOffset(1259)).toBe(3);
    // exactly totalBlockSize clamps to last page.
    expect(plan.pageIndexAtBlockOffset(plan.totalBlockSize)).toBe(3);
  });

  it("y past totalBlockSize → last (clamp)", () => {
    const plan = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN);
    expect(plan.pageIndexAtBlockOffset(99999)).toBe(3);
  });

  it("y < 0 → 0 (clamp)", () => {
    const plan = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN);
    expect(plan.pageIndexAtBlockOffset(-50)).toBe(0);
  });

  it("does NOT over-add a trailing gap on the last page", () => {
    // A naive `blockOffset + blockSize + pageGap` per-page reconstruction would
    // place the last page's bottom at 960 + 300 + 20 = 1280, past
    // totalBlockSize (1260). y = 1265 (above totalBlockSize) must still clamp to
    // the last page, NOT report some phantom page index.
    const plan = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN);
    expect(plan.pageIndexAtBlockOffset(1265)).toBe(3);
  });

  it("single-page doc → always page 0", () => {
    const plan = measurePass([blockMeta(50)], PAGE, IMPLICIT_SECTION_PLAN);
    expect(plan.pageIndexAtBlockOffset(0)).toBe(0);
    expect(plan.pageIndexAtBlockOffset(150)).toBe(0);
    expect(plan.pageIndexAtBlockOffset(99999)).toBe(0);
    expect(plan.pageIndexAtBlockOffset(-1)).toBe(0);
  });
});

describe("measurePass — pageIndexOfBlock", () => {
  function cascade(style: Style, children: readonly ReturnType<typeof createElementBox>[]) {
    const root = cascadePass(createElementBox("root", style, children));
    if (root.type !== "element") throw new Error("non-element");
    return root;
  }

  function fixedBlock(key: string, blockSize: number): ReturnType<typeof createElementBox> {
    return createElementBox(key, { display: "block", blockSize } as Style, []);
  }

  it("maps each top-level block key to the page whose children slice contains it", () => {
    // 10 fixed blocks of 100; 3 per page ⇒ pages: [0,1,2] [3,4,5] [6,7,8] [9].
    const children = Array.from({ length: 10 }, (_, i) => fixedBlock(`b${i}`, 100));
    const root = cascade({ display: "block" }, children);
    const metas = Array.from({ length: 10 }, () => blockMeta(100));
    const plan = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN, root.children);

    expect(plan.pageIndexOfBlock("b0")).toBe(0);
    expect(plan.pageIndexOfBlock("b2")).toBe(0);
    expect(plan.pageIndexOfBlock("b3")).toBe(1);
    expect(plan.pageIndexOfBlock("b6")).toBe(2);
    // b9 is on page 3.
    expect(plan.pageIndexOfBlock("b9")).toBe(3);
  });

  it("returns -1 for an unknown block key", () => {
    const children = Array.from({ length: 3 }, (_, i) => fixedBlock(`b${i}`, 50));
    const root = cascade({ display: "block" }, children);
    const metas = Array.from({ length: 3 }, () => blockMeta(50));
    const plan = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN, root.children);
    expect(plan.pageIndexOfBlock("nope")).toBe(-1);
  });

  it("returns -1 for every block when rootChildren is omitted (no keys to map)", () => {
    const metas = Array.from({ length: 3 }, () => blockMeta(50));
    const plan = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN);
    expect(plan.pageIndexOfBlock("b0")).toBe(-1);
  });

  it("spanning block: appears only on the page where it makes whole-block progress", () => {
    // A 250-tall block followed by a 100-tall block, page content 300.
    // measurePass slices `children` by [startIndex, nextStartIndex) where a
    // child still mid-fragment at the bottom is counted on the NEXT page (its
    // resumeChildIndex). With a 250 block that fits whole and then a 100 block,
    // there is no fragment here — use a configuration that DOES span. We rely on
    // an IFC paragraph spanning the boundary so its resumeChildIndex behavior
    // applies; emulate via metas with an oversized leaf to force a split.
    //
    // Simpler deterministic case: 2 fixed blocks of 250 each, page content 300.
    // Page 0: b0 (250) fits; b1 (250) doesn't ⇒ resumeChildIndex 1 ⇒ b1 on page 1.
    const children = [fixedBlock("b0", 250), fixedBlock("b1", 250)];
    const root = cascade({ display: "block" }, children);
    const metas = [blockMeta(250), blockMeta(250)];
    const plan = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN, root.children);
    expect(plan.entries.length).toBe(2);
    expect(plan.pageIndexOfBlock("b0")).toBe(0);
    expect(plan.pageIndexOfBlock("b1")).toBe(1);
  });
});

describe("measurePass — pageSpanOfBlock", () => {
  function cascade(style: Style, children: readonly ReturnType<typeof createElementBox>[]) {
    const root = cascadePass(createElementBox("root", style, children));
    if (root.type !== "element") throw new Error("non-element");
    return root;
  }

  function fixedBlock(key: string, blockSize: number): ReturnType<typeof createElementBox> {
    return createElementBox(key, { display: "block", blockSize } as Style, []);
  }

  it("single-page blocks have first === last === their page (matching pageIndexOfBlock)", () => {
    // 10 fixed blocks of 100; 3 per page ⇒ pages: [0,1,2] [3,4,5] [6,7,8] [9].
    const children = Array.from({ length: 10 }, (_, i) => fixedBlock(`b${i}`, 100));
    const root = cascade({ display: "block" }, children);
    const metas = Array.from({ length: 10 }, () => blockMeta(100));
    const plan = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN, root.children);

    for (const key of ["b0", "b2", "b3", "b6", "b9"]) {
      const span = plan.pageSpanOfBlock(key);
      const idx = plan.pageIndexOfBlock(key);
      expect(span, key).not.toBeNull();
      if (span === null) continue;
      expect(span.first, key).toBe(idx);
      expect(span.last, key).toBe(idx);
    }
  });

  it("returns null for an unknown key and when rootChildren is omitted", () => {
    const children = Array.from({ length: 3 }, (_, i) => fixedBlock(`b${i}`, 50));
    const root = cascade({ display: "block" }, children);
    const metas = Array.from({ length: 3 }, () => blockMeta(50));
    const plan = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN, root.children);
    expect(plan.pageSpanOfBlock("nope")).toBeNull();

    const planNoChildren = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN);
    expect(planNoChildren.pageSpanOfBlock("b0")).toBeNull();
  });

  it("spanning block: span covers EVERY page it occupies (first < last), while pageIndexOfBlock returns only the last", () => {
    // A single top-level IFC block of 5 lines × 100 = 500, page content 300:
    // page 0 holds 3 lines, page 1 the remaining 2. The block thus OCCUPIES
    // pages 0 AND 1. `pageIndexOfBlock` returns only the whole-block-progress
    // (last) page (1); `pageSpanOfBlock` must report {first:0, last:1} so a
    // backward-walk consumer floors at the block's true first page (0), never
    // below it. (Here first IS 0; the point is span.last > span.first.)
    const children = [fixedBlock("b0", 500)];
    const root = cascade({ display: "block" }, children);
    const metas: BlockFitMeta[] = [
      blockMeta(500, { kind: "ifc", lineBlockSizes: [100, 100, 100, 100, 100] }),
    ];
    const plan = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN, root.children);
    expect(plan.entries.length).toBe(2);
    // Whole-block-progress page is the LAST page.
    expect(plan.pageIndexOfBlock("b0")).toBe(1);
    const span = plan.pageSpanOfBlock("b0");
    expect(span).not.toBeNull();
    if (span === null) return;
    expect(span.first).toBe(0);
    expect(span.last).toBe(1);
    // `last` always equals pageIndexOfBlock for a present block.
    expect(span.last).toBe(plan.pageIndexOfBlock("b0"));
  });

  it("block whose FIRST page is N>0: span.first is the block's own first page, never below", () => {
    // b0 fills page 0 (300). b1 is a 5-line IFC (500) starting on page 1,
    // spanning to page 2. b1's first page is 1 (NOT 0), last is 2.
    const children = [fixedBlock("b0", 300), fixedBlock("b1", 500)];
    const root = cascade({ display: "block" }, children);
    const metas: BlockFitMeta[] = [
      blockMeta(300),
      blockMeta(500, { kind: "ifc", lineBlockSizes: [100, 100, 100, 100, 100] }),
    ];
    const plan = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN, root.children);
    const span = plan.pageSpanOfBlock("b1");
    expect(span).not.toBeNull();
    if (span === null) return;
    expect(span.first).toBe(1);
    expect(span.last).toBe(2);
    expect(span.last).toBe(plan.pageIndexOfBlock("b1"));
    // b0 is single-page on page 0.
    expect(plan.pageSpanOfBlock("b0")).toEqual({ first: 0, last: 0 });
  });
});

describe("measurePassUnsupported", () => {
  function cascade(style: Style, children: readonly ReturnType<typeof createElementBox>[]) {
    const root = cascadePass(createElementBox("root", style, children));
    if (root.type !== "element") throw new Error("non-element");
    return root;
  }

  /** A paragraph (block element whose only content is text → an IFC leaf). */
  function para(key: string, text = "hello"): ReturnType<typeof createElementBox> {
    return createElementBox(key, { display: "block" } as Style, [createTextBox(`${key}-t`, {}, text)]);
  }

  // --- (1) float / clear (existing behavior, preserved under the new name). ---

  it("false for a plain block document", () => {
    const root = cascade({ display: "block" }, [
      createElementBox("a", { display: "block" } as Style, []),
      createElementBox("b", { display: "block" } as Style, []),
    ]);
    expect(measurePassUnsupported(root)).toBe(false);
  });

  it("true when a descendant floats", () => {
    const root = cascade({ display: "block" }, [
      createElementBox("a", { display: "block" } as Style, [
        createElementBox("f", { display: "block", float: "inline-start" } as Style, []),
      ]),
    ]);
    expect(measurePassUnsupported(root)).toBe(true);
  });

  it("true when a descendant uses clear", () => {
    const root = cascade({ display: "block" }, [
      createElementBox("a", { display: "block", clear: "both" } as Style, []),
    ]);
    expect(measurePassUnsupported(root)).toBe(true);
  });

  // --- (2) padded / bordered CONTAINER — now SUPPORTED (#254 handled). ---
  // `buildBlockFitMetas` / `fitOnePage` model block-axis padding (and the
  // border margin-collapse boundary); oracle-proven equivalent to paginateRoot.

  it("false for a container with block-axis padding > 0 (#254 handled)", () => {
    const container = createElementBox("c", { display: "block", paddingBlockStart: 12 } as Style, [
      para("p0"),
      para("p1"),
    ]);
    const root = cascade({ display: "block" }, [container]);
    expect(measurePassUnsupported(root)).toBe(false);
  });

  it("false for a container with a block-axis border > 0 (#254 handled)", () => {
    const container = createElementBox(
      "c",
      { display: "block", borderBlockEndWidth: 3, borderBlockEndStyle: "solid" } as Style,
      [para("p0"), para("p1")],
    );
    const root = cascade({ display: "block" }, [container]);
    expect(measurePassUnsupported(root)).toBe(false);
  });

  it("false for a LEAF paragraph with padding (padding folds into its own height)", () => {
    // A paragraph (no block children) with padding is fine — there is no
    // recursion to mis-budget; the padding lives in the leaf's totalBlockSize.
    const root = cascade({ display: "block" }, [
      createElementBox("p", { display: "block", paddingBlockStart: 20 } as Style, [
        createTextBox("p-t", {}, "hello"),
      ]),
    ]);
    expect(measurePassUnsupported(root)).toBe(false);
  });

  it("false for an unpadded container of paragraphs", () => {
    const container = createElementBox("c", { display: "block" } as Style, [para("p0"), para("p1")]);
    const root = cascade({ display: "block" }, [container]);
    expect(measurePassUnsupported(root)).toBe(false);
  });

  // --- (3) MIXED content — now SUPPORTED (#253 handled). ---
  // `buildBlockFitMetas` mirrors `groupChildren`, emitting an ifc-leaf meta for
  // each bare inline run; oracle-proven equivalent to paginateRoot.

  it("false for a block element with both block and inline children (#253 handled)", () => {
    const mixed = createElementBox("m", { display: "block" } as Style, [
      para("p0"),
      createTextBox("loose-t", {}, "bare inline text"),
    ]);
    const root = cascade({ display: "block" }, [mixed]);
    expect(measurePassUnsupported(root)).toBe(false);
  });

  it("false for a pure-inline paragraph (only text children, no block children)", () => {
    const root = cascade({ display: "block" }, [para("p0")]);
    expect(measurePassUnsupported(root)).toBe(false);
  });

  it("true for a floated descendant inside a padded container (only float/clear unsupported)", () => {
    // Padding alone is now supported; the float is what still routes to legacy.
    const container = createElementBox("c", { display: "block", paddingBlockStart: 12 } as Style, [
      para("p0"),
      createElementBox("f", { display: "block", float: "inline-start" } as Style, []),
    ]);
    const root = cascade({ display: "block" }, [container]);
    expect(measurePassUnsupported(root)).toBe(true);
  });
});

// ===========================================================================
// Section-aware pagination (C.2b-1 Task 3). The measure pass consumes a
// `SectionPlan` and forces a page break before the flattened child that begins
// a new section, tagging each entry with `activeSectionId` / `sectionPageIndex`.
//
// These tests drive the REAL render→cascade→buildBlockFitMetas→buildSectionPlan
// →measurePass flow with paginated PageConfigs (mirroring display-contents.test
// + measure-pass-incremental). A `section` is a `display:contents` ElementBox
// stamped with the `{ blockType: "section" }` marker (the section component's
// output); `buildSectionPlan` reads it off the cascaded tree.
// ===========================================================================

const SECTION_SHAPER = createMockShaper(8, 16);
const SECTION_CONTENT_INLINE = 600;

// 48px content per page ⇒ 3 single-line (16px) paragraphs per page.
const SECTION_PAGE: PageConfig = {
  pageInlineSize: 600,
  pageBlockSize: 48,
  pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
  pageGap: 20,
};

/** A single-line paragraph (block whose only content is a text run) → 16px. */
function sPara(key: string, text = "x"): ElementBox {
  return createElementBox(key, { display: "block" } as Style, [
    createTextBox(`${key}-t`, {}, text),
  ]);
}

/** A section: display:contents + the `{ blockType: "section" }` marker. */
function sSection(key: string, children: readonly RenderNode[]): ElementBox {
  return createElementBox(key, { display: "contents" } as Style, children, {
    blockType: "section",
  });
}

function sDoc(children: readonly RenderNode[]): ElementBox {
  return createElementBox("doc", { display: "block" } as Style, children);
}

function sCascade(root: ElementBox): ElementBox {
  const c = cascadePass(root);
  if (c.type !== "element") throw new Error("cascadePass returned non-element");
  return c;
}

/** Build a `PagePlan` from a render-doc root via the real flow. */
function sectionPlanFrom(
  renderRoot: ElementBox,
  pageConfig: PageConfig = SECTION_PAGE,
  prevPlan?: ReturnType<typeof measurePass>,
): {
  plan: ReturnType<typeof measurePass>;
  cascaded: ElementBox;
  sectionPlan: SectionPlan;
} {
  const cascaded = sCascade(renderRoot);
  const metas = buildBlockFitMetas(cascaded, SECTION_SHAPER, SECTION_CONTENT_INLINE);
  const sectionPlan = buildSectionPlan(cascaded, pageConfig);
  // `metas` are built over the FLATTENED child list (sections are display:contents
  // and splice out), so `rootChildren` must be flattened too — matching
  // virtual-producer's `flattenContents(cascadedRoot.children)`.
  const plan = measurePass(
    metas, pageConfig, sectionPlan, flattenContents(cascaded.children), prevPlan,
  );
  return { plan, cascaded, sectionPlan };
}

describe("measurePass — section page breaks", () => {
  it("forces section 2 onto a FRESH page even when section 1 leaves room", () => {
    // Section 1 = 2 single-line paras (32px, fits on page 0 with room for one
    // more line). Section 2 = 2 single-line paras. WITHOUT section awareness the
    // 4 paras would pack 3-on-page-0 + 1-on-page-1. WITH the forced break, s2's
    // first block (s2a) must start a brand-new page.
    const render = sDoc([
      sSection("s1", [sPara("s1a"), sPara("s1b")]),
      sSection("s2", [sPara("s2a"), sPara("s2b")]),
    ]);
    const { plan } = sectionPlanFrom(render);

    // 2 pages: page 0 = [s1a, s1b]; page 1 = [s2a, s2b].
    expect(plan.entries.length).toBe(2);
    expect(plan.pageIndexOfBlock("s1a")).toBe(0);
    expect(plan.pageIndexOfBlock("s1b")).toBe(0);
    // The break: s2a is NOT appended to page 0 (which had room) — it starts page 1.
    expect(plan.pageIndexOfBlock("s2a")).toBe(1);
    expect(plan.pageIndexOfBlock("s2b")).toBe(1);
    expect(plan.pageSpanOfBlock("s2a")).toEqual({ first: 1, last: 1 });
    // page 1's startIndex is 2 (the flattened index of s2a), resumeInto a block
    // token at index 2 (the forced break), resumeOut null (doc end).
    expect(plan.entries[1].startIndex).toBe(2);
    expect(plan.entries[1].resumeInto).toEqual({
      type: "block",
      resumeChildIndex: 2,
      resumeChildToken: null,
    });
    expect(plan.entries[1].resumeOut).toBeNull();
  });

  it("tags activeSectionId per entry and resets sectionPageIndex at each section", () => {
    // s1 spans 2 pages (4 single-line paras = 64px > 48 ⇒ 3 + 1). s2 = 2 paras
    // on its own page. Expect activeSectionId s1,s1 then s2; sectionPageIndex
    // 0,1 (s1) then 0 (s2).
    const render = sDoc([
      sSection("s1", [sPara("a0"), sPara("a1"), sPara("a2"), sPara("a3")]),
      sSection("s2", [sPara("b0"), sPara("b1")]),
    ]);
    const { plan } = sectionPlanFrom(render);

    // The section id is the section ElementBox key (buildSectionPlan reads
    // `child.key as BlockId`). Sections are display:contents so their keys do
    // NOT appear in the flattened cascaded.children — only the SectionPlan
    // carries them, and the measure pass stamps them on each entry.
    expect(plan.entries.length).toBe(3);
    expect(plan.entries.map((e) => e.activeSectionId)).toEqual(["s1", "s1", "s2"]);
    expect(plan.entries.map((e) => e.sectionPageIndex)).toEqual([0, 1, 0]);
  });

  it("section-less doc paginates IDENTICALLY to IMPLICIT_SECTION_PLAN (no regression)", () => {
    // A plain doc of 7 single-line paras, no sections. buildSectionPlan yields
    // [{0,null}] (== IMPLICIT_SECTION_PLAN semantics), so no breaks fire and the
    // plan is byte-identical to one built with IMPLICIT_SECTION_PLAN explicitly.
    const render = sDoc(Array.from({ length: 7 }, (_, i) => sPara(`p${i}`)));
    const cascaded = sCascade(render);
    const metas = buildBlockFitMetas(cascaded, SECTION_SHAPER, SECTION_CONTENT_INLINE);

    const builtPlan = buildSectionPlan(cascaded, SECTION_PAGE);
    expect(builtPlan.boundaries).toEqual([{ startFlattenedIndex: 0, sectionId: null }]);

    // Pass the FLATTENED children (matching virtual-producer's production
    // wiring) so the slice indices stay 1:1 with `metas` even if a future doc
    // grows a root-level display:contents node. For this section-less doc
    // flattenContents is identity, so the comparison is unaffected.
    const flatChildren = flattenContents(cascaded.children);
    const planFromBuilt = measurePass(metas, SECTION_PAGE, builtPlan, flatChildren);
    const planFromImplicit = measurePass(
      metas, SECTION_PAGE, IMPLICIT_SECTION_PLAN, flatChildren,
    );

    // Same boundaries, same offsets, same slices — section-awareness is inert.
    expect(planFromBuilt.entries.length).toBe(planFromImplicit.entries.length);
    expect(planFromBuilt.totalBlockSize).toBe(planFromImplicit.totalBlockSize);
    for (let i = 0; i < planFromBuilt.entries.length; i++) {
      const a = planFromBuilt.entries[i];
      const b = planFromImplicit.entries[i];
      expect(a.startIndex, `page ${i} startIndex`).toBe(b.startIndex);
      expect(a.blockOffset, `page ${i} blockOffset`).toBe(b.blockOffset);
      expect(a.resumeInto, `page ${i} resumeInto`).toEqual(b.resumeInto);
      expect(a.resumeOut, `page ${i} resumeOut`).toEqual(b.resumeOut);
      // activeSectionId is null (no section), sectionPageIndex increments.
      expect(a.activeSectionId, `page ${i} activeSectionId`).toBeNull();
      expect(a.sectionPageIndex, `page ${i} sectionPageIndex`).toBe(i);
    }
  });

  it("C.1b transparency holds WITHIN a section body (intra-section positions unchanged)", () => {
    // s1 has 4 single-line body blocks. Within s1, the bodies must pack exactly
    // as a section-less 4-para doc would (3 on page 0, 1 on page 1) — the section
    // adds NO box, so positions inside the body are unaffected (minus the break,
    // which here is the doc start so there is no leading break).
    const sectioned = sDoc([sSection("s1", [
      sPara("a0"), sPara("a1"), sPara("a2"), sPara("a3"),
    ])]);
    const plain = sDoc([sPara("a0"), sPara("a1"), sPara("a2"), sPara("a3")]);

    const sp = sectionPlanFrom(sectioned).plan;
    const pp = sectionPlanFrom(plain).plan;

    expect(sp.entries.length).toBe(pp.entries.length);
    for (let i = 0; i < sp.entries.length; i++) {
      expect(sp.entries[i].startIndex).toBe(pp.entries[i].startIndex);
      expect(sp.entries[i].blockOffset).toBe(pp.entries[i].blockOffset);
      expect(sp.entries[i].resumeInto).toEqual(pp.entries[i].resumeInto);
      expect(sp.entries[i].resumeOut).toEqual(pp.entries[i].resumeOut);
    }
    // Intra-section block→page mapping is identical.
    for (const key of ["a0", "a1", "a2", "a3"]) {
      expect(sp.pageIndexOfBlock(key)).toBe(pp.pageIndexOfBlock(key));
    }
  });

  it("single section starting at index 0 fires NO break (first boundary never breaks)", () => {
    // A doc that is exactly section(a,b,c). SectionPlan = [{0, s}] ⇒
    // nextBoundaryIndex always null ⇒ no break. Paginates like the bare body.
    const sectioned = sDoc([sSection("s", [sPara("a"), sPara("b"), sPara("c"), sPara("d")])]);
    const plain = sDoc([sPara("a"), sPara("b"), sPara("c"), sPara("d")]);

    const built = buildSectionPlan(sCascade(sectioned), SECTION_PAGE);
    expect(built.boundaries).toEqual([{ startFlattenedIndex: 0, sectionId: "s" }]);

    const sp = sectionPlanFrom(sectioned).plan;
    const pp = sectionPlanFrom(plain).plan;
    expect(sp.entries.length).toBe(pp.entries.length);
    for (let i = 0; i < sp.entries.length; i++) {
      expect(sp.entries[i].startIndex).toBe(pp.entries[i].startIndex);
      expect(sp.entries[i].resumeOut).toEqual(pp.entries[i].resumeOut);
    }
    // Every entry belongs to section "s".
    expect(sp.entries.every((e) => e.activeSectionId === "s")).toBe(true);
  });

  it("section break at an EXACT page boundary produces NO empty trailing page", () => {
    // Section 1 fills page 0 EXACTLY (3 single-line paras = 48px == page content).
    // Section 2 then starts. The break must NOT introduce a blank page for s1 —
    // s2's first page is page 1, the very next page.
    const render = sDoc([
      sSection("s1", [sPara("a0"), sPara("a1"), sPara("a2")]),
      sSection("s2", [sPara("b0"), sPara("b1")]),
    ]);
    const { plan } = sectionPlanFrom(render);

    // 2 pages exactly: page 0 = s1's three paras (exact fill), page 1 = s2's two.
    expect(plan.entries.length).toBe(2);
    expect(plan.pageIndexOfBlock("a2")).toBe(0);
    expect(plan.pageIndexOfBlock("b0")).toBe(1);
    expect(plan.entries[1].startIndex).toBe(3); // s2a's flattened index.
    expect(plan.entries.map((e) => e.activeSectionId)).toEqual(["s1", "s2"]);
    expect(plan.entries.map((e) => e.sectionPageIndex)).toEqual([0, 0]);
  });

  it("multi-page section body: constant activeSectionId, incrementing sectionPageIndex; next section resets", () => {
    // s1 body spans 3 pages (7 single-line paras = 112px ⇒ 3 + 3 + 1). s2 = 1
    // para on its own page. Expect activeSectionId s1×3 then s2; sectionPageIndex
    // 0,1,2 then 0.
    const render = sDoc([
      sSection("s1", Array.from({ length: 7 }, (_, i) => sPara(`a${i}`))),
      sSection("s2", [sPara("b0")]),
    ]);
    const { plan } = sectionPlanFrom(render);

    expect(plan.entries.length).toBe(4);
    expect(plan.entries.map((e) => e.activeSectionId)).toEqual(["s1", "s1", "s1", "s2"]);
    expect(plan.entries.map((e) => e.sectionPageIndex)).toEqual([0, 1, 2, 0]);
  });

  it("leading section-less run then a section (implicit boundary at 0 + section at K)", () => {
    // p0 (no section), then section(a,b). buildSectionPlan = [{0,null},{1,s}].
    // p0 on page 0; the section forces a break ⇒ a,b start page 1.
    const render = sDoc([
      sPara("p0"),
      sSection("s", [sPara("a"), sPara("b")]),
    ]);
    const { plan } = sectionPlanFrom(render);

    expect(plan.entries.length).toBe(2);
    expect(plan.pageIndexOfBlock("p0")).toBe(0);
    expect(plan.pageIndexOfBlock("a")).toBe(1);
    expect(plan.pageIndexOfBlock("b")).toBe(1);
    expect(plan.entries.map((e) => e.activeSectionId)).toEqual([null, "s"]);
    expect(plan.entries.map((e) => e.sectionPageIndex)).toEqual([0, 0]);
  });
});

// ===========================================================================
// Section-aware incremental carry-forward (C.2b-1 Task 3, item 6 — the reuse
// gate). A SECTION_BREAK changes the SectionPlan; the gate must compare section
// status so an unchanged section's pages REUSE (0 fitOnePage calls) while only
// the affected section's pages refit. A body edit within one section must reuse
// the other section's pages.
// ===========================================================================

describe("measurePass — section incremental reuse gate", () => {
  it("body edit within section 2 reuses section 1's pages (refits only s2 + trailing)", () => {
    // Two 4-para sections; each section's body spans 2 pages (4×16=64 > 48).
    // s1 → pages 0,1; s2 → pages 2,3. Edit ONLY a body ref in s2 (s1 refs
    // identical, SAME sectionPlan) ⇒ pages 0,1 reuse; only s2's pages (+ trailing)
    // refit.
    // Build s1's node + s2's UNCHANGED body paras ONCE and reuse them by
    // REFERENCE in render1, so incremental-cascade preserves every unchanged
    // block's RenderNode ref — the reuse proof needs ref-equal influencing
    // children (mirrors the incremental test's middle-edit shape). Only s2's LAST
    // body block (b3) changes; keeping the s2-START block (b0) ref-stable lets
    // s1's last page — whose section-cap resumeOut points at b0 — still prove
    // reusable. Only s2's own pages (which depend on b3) refit.
    const s1Node = sSection("s1", [sPara("a0"), sPara("a1"), sPara("a2"), sPara("a3")]);
    const b0 = sPara("b0");
    const b1 = sPara("b1");
    const b2 = sPara("b2");
    const render0 = sDoc([s1Node, sSection("s2", [b0, b1, b2, sPara("b3")])]);
    const cascaded0 = sCascade(render0);
    const metas0 = buildBlockFitMetas(cascaded0, SECTION_SHAPER, SECTION_CONTENT_INLINE);
    const sectionPlan = buildSectionPlan(cascaded0, SECTION_PAGE);
    const plan1 = measurePass(
      metas0, SECTION_PAGE, sectionPlan, flattenContents(cascaded0.children),
    );
    // s1 → pages 0,1; s2 → pages 2,3.
    expect(plan1.entries.length).toBe(4);
    expect(plan1.entries.map((e) => e.activeSectionId)).toEqual(["s1", "s1", "s2", "s2"]);

    // Mutate ONLY b3; reuse s1Node + b0/b1/b2 by reference.
    const render1 = sDoc([s1Node, sSection("s2", [b0, b1, b2, sPara("b3", "EDITED")])]);
    const cascaded1 = cascadePassIncremental(render1, render0, cascaded0) as ElementBox;
    const metas1 = buildBlockFitMetas(cascaded1, SECTION_SHAPER, SECTION_CONTENT_INLINE);
    const sectionPlan1 = buildSectionPlan(cascaded1, SECTION_PAGE);

    __resetFitOnePageCallCountForTest();
    const plan2 = measurePass(
      metas1, SECTION_PAGE, sectionPlan1, flattenContents(cascaded1.children), plan1,
    );
    const fitCalls = __getFitOnePageCallCountForTest();

    // s1's two pages (0,1) reuse — only s2's pages (2,3) refit. fitCalls is
    // strictly fewer than the 4 a full re-fit would drive (reuse engaged).
    expect(plan2.entries.length).toBe(4);
    expect(fitCalls).toBeGreaterThan(0);
    expect(fitCalls).toBeLessThanOrEqual(2);
    // Section tagging survives the reuse.
    expect(plan2.entries.map((e) => e.activeSectionId)).toEqual(["s1", "s1", "s2", "s2"]);
    expect(plan2.entries.map((e) => e.sectionPageIndex)).toEqual([0, 1, 0, 1]);
  });

  it("sectionPlan change (add a boundary) reuses an unaffected earlier section, refits the split section", () => {
    // 3 stacked single-line-para groups laid out section-less first; then a
    // SectionPlan that puts a boundary BETWEEN group 2 and group 3 (index 6).
    // Group 1 (indices 0-2, page 0) is unaffected: its (activeSectionId,
    // nextBoundaryIndex) at startIndex 0 is UNCHANGED only if the new boundary is
    // strictly after index 0 AND there is an earlier boundary already... To make
    // an earlier section demonstrably reuse, we start from a 3-SECTION plan and
    // CHANGE only the LAST boundary, so the first section's pages keep identical
    // status and reuse.
    //
    // plan1: sections at flattened indices {0:s1, 3:s2, 6:s3}; 9 single-line paras
    // ⇒ each section is exactly one page (3 paras). Pages: s1=0, s2=1, s3=2.
    const paras = (prefix: string) =>
      [sPara(`${prefix}0`), sPara(`${prefix}1`), sPara(`${prefix}2`)];
    const render = sDoc([
      sSection("s1", paras("a")),
      sSection("s2", paras("b")),
      sSection("s3", paras("c")),
    ]);
    const cascaded = sCascade(render);
    const metas = buildBlockFitMetas(cascaded, SECTION_SHAPER, SECTION_CONTENT_INLINE);

    const flatChildren = flattenContents(cascaded.children);
    const sectionPlanA = buildSectionPlan(cascaded, SECTION_PAGE);
    const plan1 = measurePass(metas, SECTION_PAGE, sectionPlanA, flatChildren);
    expect(plan1.entries.length).toBe(3);
    expect(plan1.entries.map((e) => e.startIndex)).toEqual([0, 3, 6]);

    // New plan: MOVE the s3 boundary one block earlier (index 5 instead of 6) —
    // changes s2's cap (nextBoundaryIndex at startIndex 3 goes 6→5) and s3's
    // start, but s1's status at startIndex 0 (activeSectionId s1, nextBoundaryIndex
    // 3) is UNCHANGED. So page 0 (s1) reuses; the pages from s2 onward refit.
    const sectionPlanB: SectionPlan = {
      boundaries: [
        { startFlattenedIndex: 0, sectionId: "s1" as BlockId },
        { startFlattenedIndex: 3, sectionId: "s2" as BlockId },
        { startFlattenedIndex: 5, sectionId: "s3" as BlockId },
      ],
    };

    __resetFitOnePageCallCountForTest();
    const plan2 = measurePass(metas, SECTION_PAGE, sectionPlanB, flatChildren, plan1);
    const fitCalls = __getFitOnePageCallCountForTest();

    // Page 0 (s1) reuses (its section status is unchanged); s2/s3 pages refit.
    // The total fitOnePage calls must be strictly fewer than a full from-scratch
    // re-fit of all pages, and page 0 specifically must NOT refit.
    expect(fitCalls).toBeGreaterThan(0);
    expect(fitCalls).toBeLessThan(plan2.entries.length);
    // s1 still occupies page 0 (unchanged); the new boundary split s2/s3.
    expect(plan2.entries[0].activeSectionId).toBe("s1");
    expect(plan2.entries[0].startIndex).toBe(0);
  });
});
