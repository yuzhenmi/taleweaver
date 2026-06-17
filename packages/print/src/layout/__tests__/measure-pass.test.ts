// packages/core/src/layout/__tests__/measure-pass.test.ts
//
// Direct unit tests for `measurePass` + the legacy-vs-virtual gate. The broad
// oracle-driven equivalence suite lives in `measure-pass-equivalence.test.ts`;
// these assert the plan SHAPE (offsets, slices, resume tokens, totals) and the
// fallback detectors on hand-built inputs. `measurePassUnsupported` now flags
// ONLY `position:absolute` (padded/bordered containers + mixed content are
// modeled per #253/#254; float/`clear` were lifted in the VL float fast-path).
// Float/`clear` detection is `hasFloatOrClear`; the composite legacy gate is
// `paginationFallsBackToLegacy` (single-column + footnote-free float → virtual).

import { describe, it, expect } from "vitest";
import {
  measurePass,
  measurePassUnsupported,
  hasFloatOrClear,
  paginationFallsBackToLegacy,
  __getFitOnePageCallCountForTest,
  __resetFitOnePageCallCountForTest,
} from "../measure-pass";
import type { BlockFitMeta } from "../fit-core";
import type { PageConfig } from "../page-config";
import { DEFAULT_COLUMN_CONFIG } from "@taleweaver/core";
import { cascadePass, cascadePassIncremental } from "@taleweaver/core";
import { createElementBox, createTextBox } from "@taleweaver/core";
import type { ElementBox, RenderNode } from "@taleweaver/core";
import type { Style } from "@taleweaver/core";
import type { BlockId } from "@taleweaver/core";
import type { FootnoteAnchorRef } from "@taleweaver/core";
import { buildBlockFitMetas } from "../build-fit-metas";
import { createMockShaper } from "@taleweaver/core";
import { flattenContents } from "../group-children";
import {
  buildSectionPlan,
  IMPLICIT_SECTION_PLAN,
  type SectionPlan,
} from "../section-plan";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

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

describe("measurePass — per-page columnConfig (multi-column wiring T1)", () => {
  it("stamps the doc-wide effective columnConfig (single-column default) on every entry", () => {
    const metas = [blockMeta(100), blockMeta(100), blockMeta(100), blockMeta(100)];
    const plan = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN);
    expect(plan.entries.length).toBeGreaterThan(0);
    for (const e of plan.entries) {
      expect(e.columnConfig).toEqual(DEFAULT_COLUMN_CONFIG);
    }
  });

  it("stamps a doc-wide 2-column default (effectiveDefaultColumns) onto every entry", () => {
    const metas = [blockMeta(100), blockMeta(100), blockMeta(100), blockMeta(100)];
    const twoCol: SectionPlan = {
      boundaries: [{ startFlattenedIndex: 0, sectionId: null }],
      effectiveDefaultColumns: { columnCount: 2, columnGap: 48, columnRule: null },
    };
    const plan = measurePass(metas, PAGE, twoCol);
    for (const e of plan.entries) {
      expect(e.columnConfig.columnCount).toBe(2);
      expect(e.columnConfig.columnGap).toBe(48);
    }
    // T3: the effective column config now drives the page fit (`fitColumnsOnPage`),
    // so a 2-column plan packs more content per page than the single-column plan.
    // (4 size-100 blocks at 300-px page body: single-column = 2 pages of 3+1;
    // 2-column = 1 page, all 4 in two columns.) The per-page columnFit detail is
    // asserted in the "multicol FILL fit" describe block above.
    const single = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN);
    expect(plan.entries.length).toBeLessThan(single.entries.length);
    expect(nth(plan.entries, 0, "entry").columnFit).toBeDefined();
  });
});

describe("measurePass — multicol FILL fit (multi-column wiring T3)", () => {
  // PAGE body block-size = 300 (no margins). With size-100 blocks, one column
  // holds floor(300/100) = 3 blocks; a 2-column page holds 6. 8 blocks ⇒ page 0
  // fills 6 (3+3), page 1 holds the trailing 2.
  const twoCol: SectionPlan = {
    boundaries: [{ startFlattenedIndex: 0, sectionId: null }],
    effectiveDefaultColumns: { columnCount: 2, columnGap: 48, columnRule: null },
  };

  it("page 0 fills 2 columns, overflows into page 1 with a column resume token", () => {
    const metas = Array.from({ length: 8 }, () => blockMeta(100));
    const plan = measurePass(metas, PAGE, twoCol);
    expect(plan.entries.length).toBe(2);

    const p0 = nth(plan.entries, 0, "entry");
    // columnFit set on the multicol branch.
    expect(p0.columnFit).toBeDefined();
    const fit0 = p0.columnFit;
    if (fit0 === undefined) throw new Error("expected columnFit on multicol page 0");
    expect(fit0.columns.length).toBe(2);
    // Two non-empty columns: 3 blocks each.
    expect(nth(fit0.columns, 0, "column").childrenCount).toBe(3);
    expect(nth(fit0.columns, 1, "column").childrenCount).toBe(3);
    expect(fit0.totalChildrenCount).toBe(6);
    // The page overflows ⇒ a ColumnBreakToken, and the entry stores THAT token.
    expect(fit0.pageResumeOut?.type).toBe("column");
    expect(p0.resumeOut).toBe(fit0.pageResumeOut);
    expect(p0.startIndex).toBe(0);

    // Per-column FILL height: each non-empty column consumed <= the page body
    // block-size (FILL fills to the page height).
    for (const c of fit0.columns) {
      if (c.childrenCount > 0) expect(c.consumedBlockSize).toBeLessThanOrEqual(300);
    }

    // Page 1 resumes where page 0's column token left off.
    const p1 = nth(plan.entries, 1, "entry");
    expect(p1.startIndex).toBe(p0.startIndex + fit0.totalChildrenCount); // 6
    // The loop threads page 0's column token into page 1's resumeInto.
    expect(p1.resumeInto).toBe(fit0.pageResumeOut);
    expect(p1.columnFit).toBeDefined();
    const fit1 = p1.columnFit;
    if (fit1 === undefined) throw new Error("expected columnFit on multicol page 1");
    expect(fit1.totalChildrenCount).toBe(2);
    // Content exhausts on page 1 ⇒ no further column overflow.
    expect(fit1.pageResumeOut).toBeNull();
    expect(p1.resumeOut).toBeNull();
  });

  it("inner-token block index agrees with nextStartIndex (threading invariant)", () => {
    // Verify the CRITICAL threading: innerBfcToken(columnFit.pageResumeOut) is a
    // block token at index startIndex + totalChildrenCount, so the next page's
    // startIndex (computed via the inner token's block branch) matches.
    const metas = Array.from({ length: 8 }, () => blockMeta(100));
    const plan = measurePass(metas, PAGE, twoCol);
    const p0 = nth(plan.entries, 0, "entry");
    const fit0 = p0.columnFit;
    if (fit0 === undefined) throw new Error("expected columnFit");
    const inner = fit0.pageResumeOut?.resumeChildToken;
    expect(inner?.type).toBe("block");
    if (inner !== undefined && inner !== null && inner.type === "block") {
      expect(inner.resumeChildIndex).toBe(p0.startIndex + fit0.totalChildrenCount);
      expect(nth(plan.entries, 1, "entry").startIndex).toBe(inner.resumeChildIndex);
    }
  });

  it("single-column pages have columnFit === undefined (byte-identical plan)", () => {
    const metas = Array.from({ length: 8 }, () => blockMeta(100));
    const single = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN);
    for (const e of single.entries) {
      expect(e.columnFit).toBeUndefined();
    }
    // The single-column plan is unchanged from the pre-T3 boundaries: 3 blocks
    // per page (300/100), 8 blocks ⇒ 3 pages.
    expect(single.entries.length).toBe(3);
    expect(single.entries.map((e) => e.startIndex)).toEqual([0, 3, 6]);
  });

  it("F-1: a multicol section whose content fits in one page does NOT drop the next section", () => {
    // Two sections: s1 = indices 0-1 (multicol), s2 = indices 2-3. s1's 2 blocks
    // (200px) fit within page 0's first column (≤300), so `fitColumnsOnPage`
    // exhausts at the section cap and returns `pageResumeOut === null`. Without
    // the F-1 forced-break synthesis the measure loop would treat page 0 as the
    // document end and SILENTLY DROP section 2; with it, section 2 lands on page 1.
    const sectioned: SectionPlan = {
      boundaries: [
        { startFlattenedIndex: 0, sectionId: "s1" as BlockId },
        { startFlattenedIndex: 2, sectionId: "s2" as BlockId },
      ],
      effectiveDefaultColumns: { columnCount: 2, columnGap: 0, columnRule: null },
    };
    const metas = Array.from({ length: 4 }, () => blockMeta(100));
    const plan = measurePass(metas, PAGE, sectioned);

    // The bug manifests as a 1-page plan; the fix yields 2 pages.
    expect(plan.entries.length).toBe(2);

    const p0 = nth(plan.entries, 0, "entry");
    expect(p0.startIndex).toBe(0);
    expect(p0.activeSectionId).toBe("s1");
    expect(p0.columnFit).toBeDefined();
    // Section 1's content (indices 0-1) is capped at the boundary; the page
    // resumes (a synthesized forced-break block token) into the next section.
    expect(p0.columnFit?.totalChildrenCount).toBe(2);
    expect(p0.resumeOut).toEqual({ type: "block", resumeChildIndex: 2, resumeChildToken: null });
    // T4 finality detection: page 0 is the SECTION-capped final multicol page —
    // its content exhausts at the section boundary (index 2), so it BALANCES. This
    // guards the `sectionEnd = st.nextBoundaryIndex ?? metas.length` clause: if
    // finality used `metas.length` (4) instead of the section boundary (2), this
    // page would read as non-final and keep `balancedColumnHeight === pageBlockSize`.
    expect(p0.balancedColumnHeight).toBeLessThan(PAGE.pageBlockSize);

    // Section 2 is NOT dropped — it begins a fresh page at its boundary index.
    const p1 = nth(plan.entries, 1, "entry");
    expect(p1.startIndex).toBe(2);
    expect(p1.activeSectionId).toBe("s2");
    expect(p1.columnFit).toBeDefined();
    expect(p1.columnFit?.totalChildrenCount).toBe(2);
    expect(p1.resumeOut).toBeNull();
  });
});

describe("measurePass — final-page BALANCE (multi-column wiring T4)", () => {
  // PAGE body block-size = 300, blocks of size 100, 2 columns. At FILL one column
  // holds floor(300/100) = 3 blocks. The page body block-size (effContentBlockSize)
  // is 300 for these no-margin pages.
  const twoCol: SectionPlan = {
    boundaries: [{ startFlattenedIndex: 0, sectionId: null }],
    effectiveDefaultColumns: { columnCount: 2, columnGap: 48, columnRule: null },
  };

  it("a SHORT multicol section (fits one page) BALANCES — column 1 non-empty, balancedColumnHeight < page body", () => {
    // 3 blocks of 100 → at FILL all 3 land in column 0 (300), column 1 empty.
    // Balance evens them: minimal equal height ~200 spreads 2 into column 0 and 1
    // into column 1 — so column 1 becomes non-empty. The section's single page is
    // its FINAL page (content exhausts, no overflow).
    const metas = Array.from({ length: 3 }, () => blockMeta(100));
    const plan = measurePass(metas, PAGE, twoCol);
    expect(plan.entries.length).toBe(1);

    const p0 = nth(plan.entries, 0, "entry");
    // This page is the section's final page (content exhausts here).
    expect(p0.resumeOut).toBeNull();
    // The page body block-size for these no-margin pages is 300.
    const pageBodyBlockSize = PAGE.pageBlockSize; // 300, no margins
    // Balance reduced the per-column height below the full page body height.
    expect(p0.balancedColumnHeight).toBeLessThan(pageBodyBlockSize);
    // Content now spreads across BOTH columns (NOT all in column 0).
    const fit = p0.columnFit;
    if (fit === undefined) throw new Error("expected columnFit on multicol page 0");
    expect(fit.columns.length).toBe(2);
    expect(nth(fit.columns, 1, "column").childrenCount).toBeGreaterThan(0);
    // The balanced re-fit still places all 3 children (balance only redistributes).
    expect(fit.totalChildrenCount).toBe(3);
  });

  it("a multi-page multicol section: overflow page FILLs (balancedColumnHeight === page body, NOT final); the last page BALANCES", () => {
    // 8 blocks of 100, 2 columns: page 0 fills 6 (3+3) and OVERFLOWS (not final);
    // page 1 holds the trailing 2 (short) and is the section's FINAL page → balances.
    const metas = Array.from({ length: 8 }, () => blockMeta(100));
    const plan = measurePass(metas, PAGE, twoCol);
    expect(plan.entries.length).toBe(2);
    const pageBodyBlockSize = PAGE.pageBlockSize; // 300

    // Overflow page 0: FILL, NOT the final page.
    const p0 = nth(plan.entries, 0, "entry");
    expect(p0.resumeOut).not.toBeNull();
    expect(p0.balancedColumnHeight).toBe(pageBodyBlockSize);

    // Final page 1: short (2 blocks) → balances below the page body height.
    const p1 = nth(plan.entries, 1, "entry");
    expect(p1.resumeOut).toBeNull();
    expect(p1.balancedColumnHeight).toBeLessThan(pageBodyBlockSize);
  });

  it("single-column pages: balancedColumnHeight === page body block-size for every entry", () => {
    const metas = Array.from({ length: 8 }, () => blockMeta(100));
    const single = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN);
    const pageBodyBlockSize = PAGE.pageBlockSize; // 300, no margins
    for (const e of single.entries) {
      expect(e.balancedColumnHeight).toBe(pageBodyBlockSize);
    }
    // Plan boundaries unchanged from pre-T4 (equivalence): 3 blocks/page, 3 pages.
    expect(single.entries.length).toBe(3);
    expect(single.entries.map((e) => e.startIndex)).toEqual([0, 3, 6]);
  });
});

describe("measurePass", () => {
  it("single page when all blocks fit", () => {
    const metas = [blockMeta(50), blockMeta(50), blockMeta(50)];
    const plan = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN);
    expect(plan.entries.length).toBe(1);
    expect(nth(plan.entries, 0, "entry").pageIndex).toBe(0);
    expect(nth(plan.entries, 0, "entry").blockOffset).toBe(0);
    expect(nth(plan.entries, 0, "entry").resumeInto).toBeNull();
    expect(nth(plan.entries, 0, "entry").resumeOut).toBeNull();
    expect(plan.totalBlockSize).toBe(300);
  });

  it("stamps the no-footnote defaults (footnote-unaware pass)", () => {
    // measurePass is footnote-unaware (FN-4 D2 / FN-5 E1): every entry it builds
    // carries the empty footnote defaults. `footnoteContinuation` is a LIST now
    // (widened in FN-5 E1) and defaults to an empty array, NOT null.
    const metas = [blockMeta(50), blockMeta(50), blockMeta(50)];
    const plan = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN);
    const entry = nth(plan.entries, 0, "entry");
    expect(entry.footnoteContentBlockIds).toEqual([]);
    expect(entry.footnoteSlotHeight).toBe(0);
    expect(Array.isArray(entry.footnoteContinuation)).toBe(true);
    expect(entry.footnoteContinuation.length).toBe(0);
    expect(entry.footnoteContinuation).toEqual([]);
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
    expect(nth(plan.entries, 0, "entry").resumeInto).toBeNull();
    expect(nth(plan.entries, 0, "entry").resumeOut).toEqual({
      type: "block",
      resumeChildIndex: 3,
      resumeChildToken: null,
    });
    expect(nth(plan.entries, 1, "entry").resumeInto).toEqual(nth(plan.entries, 0, "entry").resumeOut);
    expect(nth(plan.entries, 1, "entry").resumeOut).toBeNull();
  });

  it("attaches children slices when rootChildren provided", () => {
    const metas = Array.from({ length: 5 }, () => blockMeta(100));
    const fakeChildren = Array.from({ length: 5 }, (_, i) => ({ id: i }));
    // measurePass slices by index; pass arbitrary refs to verify slicing.
    const plan = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN, fakeChildren as never[]);
    expect(nth(plan.entries, 0, "entry").children).toEqual([{ id: 0 }, { id: 1 }, { id: 2 }]);
    expect(nth(plan.entries, 1, "entry").children).toEqual([{ id: 3 }, { id: 4 }]);
  });

  it("empty children when rootChildren omitted", () => {
    const plan = measurePass([blockMeta(50)], PAGE, IMPLICIT_SECTION_PLAN);
    expect(nth(plan.entries, 0, "entry").children).toEqual([]);
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

  // --- (1) float / clear: lifted from measurePassUnsupported (VL float
  // fast-path). `measurePassUnsupported` is now absolute-only; `hasFloatOrClear`
  // detects float/clear; a single-column, footnote-free float doc routes to the
  // VIRTUAL path (`paginationFallsBackToLegacy` → false). ---

  it("false for a plain block document", () => {
    const root = cascade({ display: "block" }, [
      createElementBox("a", { display: "block" } as Style, []),
      createElementBox("b", { display: "block" } as Style, []),
    ]);
    expect(measurePassUnsupported(root)).toBe(false);
    expect(hasFloatOrClear(root)).toBe(false);
    expect(paginationFallsBackToLegacy(root, [])).toBe(false);
  });

  it("a floated descendant is NOT measurePassUnsupported, IS hasFloatOrClear, and routes to virtual (single-col)", () => {
    const root = cascade({ display: "block" }, [
      createElementBox("a", { display: "block" } as Style, [
        createElementBox("f", { display: "block", float: "inline-start" } as Style, []),
      ]),
    ]);
    expect(measurePassUnsupported(root)).toBe(false);
    expect(hasFloatOrClear(root)).toBe(true);
    expect(paginationFallsBackToLegacy(root, [])).toBe(false);
  });

  it("a clear descendant is NOT measurePassUnsupported, IS hasFloatOrClear, and routes to virtual (single-col)", () => {
    const root = cascade({ display: "block" }, [
      createElementBox("a", { display: "block", clear: "both" } as Style, []),
    ]);
    expect(measurePassUnsupported(root)).toBe(false);
    expect(hasFloatOrClear(root)).toBe(true);
    expect(paginationFallsBackToLegacy(root, [])).toBe(false);
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

  it("a floated descendant inside a padded container is detected by hasFloatOrClear (and a float+footnote doc still routes to legacy)", () => {
    // Padding alone is supported; the float is detected by hasFloatOrClear. With
    // NO footnotes/multicol it routes to virtual; WITH a footnote anchor present
    // the composite gate routes the float doc to legacy.
    const container = createElementBox("c", { display: "block", paddingBlockStart: 12 } as Style, [
      para("p0"),
      createElementBox("f", { display: "block", float: "inline-start" } as Style, []),
    ]);
    const root = cascade({ display: "block" }, [container]);
    expect(measurePassUnsupported(root)).toBe(false);
    expect(hasFloatOrClear(root)).toBe(true);
    expect(paginationFallsBackToLegacy(root, [])).toBe(false);
    // A non-empty footnoteAnchors array routes the float doc to legacy (the gate
    // only reads `.length`, so a minimal valid anchor suffices).
    const anchors: readonly FootnoteAnchorRef[] = [
      { blockId: "c" as BlockId, contentBlockId: "fn0" as BlockId, sectionId: null },
    ];
    expect(paginationFallsBackToLegacy(root, anchors)).toBe(true);
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

/**
 * A section: display:contents + the `{ blockType: "section" }` marker. Optional
 * `extraMetadata` models per-section header/footer ids (C.2c T2), stamped RAW
 * exactly as the section component stamps `view.attrs.headerBlockId` etc.
 */
function sSection(
  key: string,
  children: readonly RenderNode[],
  extraMetadata?: Record<string, unknown>,
): ElementBox {
  return createElementBox(key, { display: "contents" } as Style, children, {
    blockType: "section",
    ...extraMetadata,
  });
}

/**
 * A doc-root block. Optional `metadata` models the implicit-section default
 * header/footer ids the document component stamps from its own attrs (C.2c T2).
 */
function sDoc(
  children: readonly RenderNode[],
  metadata?: Record<string, unknown>,
): ElementBox {
  return createElementBox("doc", { display: "block" } as Style, children, metadata);
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
  const metas = buildBlockFitMetas(cascaded, SECTION_SHAPER, undefined, SECTION_CONTENT_INLINE);
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
    expect(nth(plan.entries, 1, "entry").startIndex).toBe(2);
    expect(nth(plan.entries, 1, "entry").resumeInto).toEqual({
      type: "block",
      resumeChildIndex: 2,
      resumeChildToken: null,
    });
    expect(nth(plan.entries, 1, "entry").resumeOut).toBeNull();
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
    const metas = buildBlockFitMetas(cascaded, SECTION_SHAPER, undefined, SECTION_CONTENT_INLINE);

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
      const a = nth(planFromBuilt.entries, i, "entry");
      const b = nth(planFromImplicit.entries, i, "entry");
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
      expect(nth(sp.entries, i, "entry").startIndex).toBe(nth(pp.entries, i, "entry").startIndex);
      expect(nth(sp.entries, i, "entry").blockOffset).toBe(nth(pp.entries, i, "entry").blockOffset);
      expect(nth(sp.entries, i, "entry").resumeInto).toEqual(nth(pp.entries, i, "entry").resumeInto);
      expect(nth(sp.entries, i, "entry").resumeOut).toEqual(nth(pp.entries, i, "entry").resumeOut);
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
      expect(nth(sp.entries, i, "entry").startIndex).toBe(nth(pp.entries, i, "entry").startIndex);
      expect(nth(sp.entries, i, "entry").resumeOut).toEqual(nth(pp.entries, i, "entry").resumeOut);
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
    expect(nth(plan.entries, 1, "entry").startIndex).toBe(3); // s2a's flattened index.
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
// Per-section header/footer body ids (C.2c T2). The measure pass tags each page
// with the active section's `headerBlockId`/`footerBlockId` (from
// `sectionStateAt`) — carried so a later task lays the templateContents body
// into the page's header/footer slot. No layout yet — T2 only threads the ids.
// Both the re-fit path AND the carry-forward reuse path must stamp them (M1).
// ===========================================================================

describe("measurePass — per-section header/footer ids", () => {
  it("a section with a header id → its pages' PagePlanEntry.headerBlockId set", () => {
    // s1 (no header) spans 2 pages; s2 carries a header id and spans 1 page.
    const render = sDoc([
      sSection("s1", [sPara("a0"), sPara("a1"), sPara("a2"), sPara("a3")]),
      sSection("s2", [sPara("b0"), sPara("b1")], { headerBlockId: "hdr2" }),
    ]);
    const { plan } = sectionPlanFrom(render);

    expect(plan.entries.length).toBe(3);
    expect(plan.entries.map((e) => e.activeSectionId)).toEqual(["s1", "s1", "s2"]);
    // s1's two pages carry no header id; s2's page carries "hdr2".
    expect(plan.entries.map((e) => e.headerBlockId)).toEqual([undefined, undefined, "hdr2"]);
    // No footer ids anywhere.
    expect(plan.entries.every((e) => e.footerBlockId === undefined)).toBe(true);
  });

  it("doc-root default header id → implicit-section pages carry it", () => {
    // A section-less doc whose ROOT carries a header id (the implicit-section
    // default). buildSectionPlan reads it off cascadedRoot.metadata onto the
    // implicit boundary; every page (all implicit-section) carries it.
    const render = sDoc(
      Array.from({ length: 7 }, (_, i) => sPara(`p${i}`)),
      { headerBlockId: "docHdr", footerBlockId: "docFtr" },
    );
    const { plan } = sectionPlanFrom(render);

    expect(plan.entries.length).toBeGreaterThan(1);
    expect(plan.entries.every((e) => e.activeSectionId === null)).toBe(true);
    expect(plan.entries.every((e) => e.headerBlockId === "docHdr")).toBe(true);
    expect(plan.entries.every((e) => e.footerBlockId === "docFtr")).toBe(true);
  });

  it("per-section: section 2 has a header, section 1 doesn't → correct per page", () => {
    // s1 (header "hdr1", footer "ftr1") spans 1 page; s2 (no header/footer)
    // spans 1 page. Each page reflects ITS section's ids.
    const render = sDoc([
      sSection("s1", [sPara("a0"), sPara("a1"), sPara("a2")], {
        headerBlockId: "hdr1",
        footerBlockId: "ftr1",
      }),
      sSection("s2", [sPara("b0"), sPara("b1")]),
    ]);
    const { plan } = sectionPlanFrom(render);

    expect(plan.entries.length).toBe(2);
    expect(plan.entries.map((e) => e.activeSectionId)).toEqual(["s1", "s2"]);
    expect(plan.entries.map((e) => e.headerBlockId)).toEqual(["hdr1", undefined]);
    expect(plan.entries.map((e) => e.footerBlockId)).toEqual(["ftr1", undefined]);
  });

  it("no header/footer attrs → entries byte-identical to today (undefined ids, no regression)", () => {
    // A plain 2-section doc with NO header/footer attrs anywhere. Every entry's
    // header/footer id is undefined and the rest of the plan is unchanged.
    const render = sDoc([
      sSection("s1", [sPara("a0"), sPara("a1"), sPara("a2")]),
      sSection("s2", [sPara("b0"), sPara("b1")]),
    ]);
    const { plan } = sectionPlanFrom(render);

    expect(plan.entries.every((e) => e.headerBlockId === undefined)).toBe(true);
    expect(plan.entries.every((e) => e.footerBlockId === undefined)).toBe(true);
  });

  it("carry-forward REUSE path stamps the active section's header/footer ids (M1)", () => {
    // Two 4-para sections (each spans 2 pages: 4×16=64 > 48). s1 has a header
    // "hdr1"; s2 has a footer "ftr2". A body edit to s2's LAST block lets s1's
    // pages REUSE (0/few fitOnePage calls), and the reuse path must still stamp
    // s1's header id onto the reused pages (M1 — the reuse path, not just refit).
    const s1Node = sSection("s1", [sPara("a0"), sPara("a1"), sPara("a2"), sPara("a3")], {
      headerBlockId: "hdr1",
    });
    const b0 = sPara("b0");
    const b1 = sPara("b1");
    const b2 = sPara("b2");
    const render0 = sDoc([
      s1Node,
      sSection("s2", [b0, b1, b2, sPara("b3")], { footerBlockId: "ftr2" }),
    ]);
    const cascaded0 = sCascade(render0);
    const metas0 = buildBlockFitMetas(cascaded0, SECTION_SHAPER, undefined, SECTION_CONTENT_INLINE);
    const sectionPlan0 = buildSectionPlan(cascaded0, SECTION_PAGE);
    const plan1 = measurePass(
      metas0, SECTION_PAGE, sectionPlan0, flattenContents(cascaded0.children),
    );
    expect(plan1.entries.length).toBe(4);
    expect(plan1.entries.map((e) => e.headerBlockId)).toEqual([
      "hdr1", "hdr1", undefined, undefined,
    ]);
    expect(plan1.entries.map((e) => e.footerBlockId)).toEqual([
      undefined, undefined, "ftr2", "ftr2",
    ]);

    // Edit ONLY s2's b3; reuse s1Node + b0/b1/b2 by reference so s1's pages reuse.
    const render1 = sDoc([
      s1Node,
      sSection("s2", [b0, b1, b2, sPara("b3", "EDITED")], { footerBlockId: "ftr2" }),
    ]);
    const cascaded1 = cascadePassIncremental(render1, render0, cascaded0) as ElementBox;
    const metas1 = buildBlockFitMetas(cascaded1, SECTION_SHAPER, undefined, SECTION_CONTENT_INLINE);
    const sectionPlan1 = buildSectionPlan(cascaded1, SECTION_PAGE);

    __resetFitOnePageCallCountForTest();
    const plan2 = measurePass(
      metas1, SECTION_PAGE, sectionPlan1, flattenContents(cascaded1.children), plan1,
    );
    const fitCalls = __getFitOnePageCallCountForTest();

    // Reuse engaged: s1's pages did NOT re-fit (fewer than 4 fitOnePage calls).
    expect(fitCalls).toBeGreaterThan(0);
    expect(fitCalls).toBeLessThanOrEqual(2);
    // The header/footer ids survive the reuse path identically (M1).
    expect(plan2.entries.length).toBe(4);
    expect(plan2.entries.map((e) => e.headerBlockId)).toEqual([
      "hdr1", "hdr1", undefined, undefined,
    ]);
    expect(plan2.entries.map((e) => e.footerBlockId)).toEqual([
      undefined, undefined, "ftr2", "ftr2",
    ]);
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
    const metas0 = buildBlockFitMetas(cascaded0, SECTION_SHAPER, undefined, SECTION_CONTENT_INLINE);
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
    const metas1 = buildBlockFitMetas(cascaded1, SECTION_SHAPER, undefined, SECTION_CONTENT_INLINE);
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
    const metas = buildBlockFitMetas(cascaded, SECTION_SHAPER, undefined, SECTION_CONTENT_INLINE);

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
      effectiveDefaultColumns: DEFAULT_COLUMN_CONFIG,
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
    expect(nth(plan2.entries, 0, "entry").activeSectionId).toBe("s1");
    expect(nth(plan2.entries, 0, "entry").startIndex).toBe(0);
  });
});

// ===========================================================================
// Per-section page geometry (C.2b-2 Task 2). A `SectionBoundary` may carry a
// `pageConfig` override; the measure pass adopts that geometry PER PAGE. Pages
// are no longer uniform-height ⇒ blockOffsets become a RUNNING SUM. Each entry
// records its EFFECTIVE `pageConfig`. A geometry change on one section refits
// only that section's pages onward (per-entry reuse gate). No-override docs
// stay BYTE-IDENTICAL to C.2b-1 (the running sum reduces to pageIndex*(H+gap)).
//
// These tests hand-build metas + SectionPlans (boundaries carry the override)
// so the geometry is exercised directly, independent of the cascade harness.
// ===========================================================================

// Doc-wide geometry: pageBlockSize 300, content 300 (no margins), gap 20.
// (Same as PAGE; aliased for readability in the geometry tests.)
const DOC_WIDE_PAGE: PageConfig = PAGE;

// A TALLER section geometry: pageBlockSize 500, content 500, gap 20.
const TALL_PAGE: PageConfig = {
  pageInlineSize: 600,
  pageBlockSize: 500,
  pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
  pageGap: 20,
};

describe("measurePass — per-section page geometry", () => {
  it("NO-REGRESSION: a uniform SectionPlan (no boundary pageConfig) paginates byte-identically", () => {
    // 10 × 100; doc-wide content 300 ⇒ 3 per page ⇒ 4 pages. A SectionPlan
    // whose single boundary carries NO pageConfig must reduce the running sum
    // back to pageIndex*(H+gap) — identical to the IMPLICIT_SECTION_PLAN run.
    const metas = Array.from({ length: 10 }, () => blockMeta(100));
    const uniformPlan: SectionPlan = {
      effectiveDefaultColumns: DEFAULT_COLUMN_CONFIG,
      boundaries: [{ startFlattenedIndex: 0, sectionId: null }],
    };
    const plan = measurePass(metas, DOC_WIDE_PAGE, uniformPlan);

    expect(plan.entries.map((e) => e.blockOffset)).toEqual([0, 320, 640, 960]);
    expect(plan.entries.map((e) => e.blockSize)).toEqual([300, 300, 300, 300]);
    expect(plan.totalBlockSize).toBe(1260);
    // Every entry's effective pageConfig is the doc-wide config (no override).
    for (const e of plan.entries) {
      expect(e.pageConfig).toBe(DOC_WIDE_PAGE);
    }

    // Byte-identical to the IMPLICIT_SECTION_PLAN run for the shared fields.
    const implicit = measurePass(metas, DOC_WIDE_PAGE, IMPLICIT_SECTION_PLAN);
    expect(plan.entries.length).toBe(implicit.entries.length);
    expect(plan.totalBlockSize).toBe(implicit.totalBlockSize);
    for (let i = 0; i < plan.entries.length; i++) {
      expect(nth(plan.entries, i, "entry").blockOffset).toBe(nth(implicit.entries, i, "entry").blockOffset);
      expect(nth(plan.entries, i, "entry").blockSize).toBe(nth(implicit.entries, i, "entry").blockSize);
      expect(nth(plan.entries, i, "entry").startIndex).toBe(nth(implicit.entries, i, "entry").startIndex);
    }
  });

  it("section 2 with a TALLER pageBlockSize ⇒ taller section-2 pages + running-sum offsets", () => {
    // 6 × 100 blocks. Section 1 (boundary 0, doc-wide) caps at index 3 (section
    // 2's start). Section 1 content 300 ⇒ blocks 0,1,2 on its single page.
    // Section 2 (boundary 3, TALL_PAGE) content 500 ⇒ blocks 3,4,5 on its single
    // page. Two pages total; the second is taller.
    const metas = Array.from({ length: 6 }, () => blockMeta(100));
    const plan2 = measurePass(
      metas,
      DOC_WIDE_PAGE,
      {
        effectiveDefaultColumns: DEFAULT_COLUMN_CONFIG,
        boundaries: [
          { startFlattenedIndex: 0, sectionId: null },
          { startFlattenedIndex: 3, sectionId: "s2" as BlockId, pageConfig: TALL_PAGE },
        ],
      },
    );

    expect(plan2.entries.length).toBe(2);
    expect(plan2.entries.map((e) => e.startIndex)).toEqual([0, 3]);
    // blockSize is the effective config's pageBlockSize per page.
    expect(plan2.entries.map((e) => e.blockSize)).toEqual([300, 500]);
    // Page 0 (section 1) keeps offset 0. Page 1 (section 2) starts at the
    // running sum: page-0 height 300 + page-0 gap 20 = 320.
    expect(plan2.entries.map((e) => e.blockOffset)).toEqual([0, 320]);
    // Effective pageConfig per page.
    expect(nth(plan2.entries, 0, "entry").pageConfig).toBe(DOC_WIDE_PAGE);
    expect(nth(plan2.entries, 1, "entry").pageConfig).toBe(TALL_PAGE);
    // totalBlockSize = last.blockOffset + last.pageConfig.pageBlockSize
    //   = 320 + 500 = 820 (no trailing gap).
    expect(plan2.totalBlockSize).toBe(820);
  });

  it("section 2's taller geometry shifts later offsets while earlier section keeps its offset", () => {
    // 9 × 100 blocks. Section 1 (doc-wide, content 300) caps at index 3 ⇒ pages
    // 0,1: blocks {0,1,2} then {empty? no} — actually section 1 has only blocks
    // 0,1,2 (cap at 3) on ONE page. Section 2 (TALL, content 500, cap none) holds
    // blocks 3..8 (6 × 100 = 600 > 500) ⇒ pages: {3,4,5,6,7} (500) then {8}.
    const metas = Array.from({ length: 9 }, () => blockMeta(100));
    const plan = measurePass(
      metas,
      DOC_WIDE_PAGE,
      {
        effectiveDefaultColumns: DEFAULT_COLUMN_CONFIG,
        boundaries: [
          { startFlattenedIndex: 0, sectionId: null },
          { startFlattenedIndex: 3, sectionId: "s2" as BlockId, pageConfig: TALL_PAGE },
        ],
      },
    );

    expect(plan.entries.map((e) => e.startIndex)).toEqual([0, 3, 8]);
    expect(plan.entries.map((e) => e.blockSize)).toEqual([300, 500, 500]);
    // Running sum: 0; 0+300+20=320; 320+500+20=840.
    expect(plan.entries.map((e) => e.blockOffset)).toEqual([0, 320, 840]);
    // Section-1 page's offset (0) and config are unchanged from a doc-wide-only run.
    expect(nth(plan.entries, 0, "entry").blockOffset).toBe(0);
    expect(nth(plan.entries, 0, "entry").pageConfig).toBe(DOC_WIDE_PAGE);
    // totalBlockSize = 840 + 500 = 1340.
    expect(plan.totalBlockSize).toBe(1340);
  });

  it("section 2 with a SHORTER pageBlockSize spans MORE pages (from scratch)", () => {
    // A SHORTER section geometry: pageBlockSize 150, content 150 (no margins).
    // content 150 − margins 0 = 150 > 0, so it would pass resolveSectionPageConfig
    // (we build the boundary directly here, so only the positive-content
    // invariant matters). 6 × 100 blocks. Section 1 (boundary 0, doc-wide
    // content 300) caps at index 3 ⇒ blocks 0,1,2 on ONE page. Section 2
    // (boundary 3, SHORT content 150) holds blocks 3,4,5: only ONE 100-block
    // fits per 150-tall page ⇒ THREE pages (one per block), vs the single page
    // section 2 would occupy at doc-wide height.
    const SHORT_PAGE: PageConfig = {
      pageInlineSize: 600,
      pageBlockSize: 150,
      pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
      pageGap: 20,
    };
    const metas = Array.from({ length: 6 }, () => blockMeta(100));
    const shortSectionPlan: SectionPlan = {
      effectiveDefaultColumns: DEFAULT_COLUMN_CONFIG,
      boundaries: [
        { startFlattenedIndex: 0, sectionId: null },
        { startFlattenedIndex: 3, sectionId: "s2" as BlockId, pageConfig: SHORT_PAGE },
      ],
    };
    const plan = measurePass(metas, DOC_WIDE_PAGE, shortSectionPlan);

    // Section 1: 1 page (blocks 0,1,2). Section 2: 3 pages (blocks 3 / 4 / 5).
    expect(plan.entries.map((e) => e.startIndex)).toEqual([0, 3, 4, 5]);
    expect(plan.entries.map((e) => e.activeSectionId)).toEqual([null, "s2", "s2", "s2"]);
    // Section 2 spans MORE pages than the single page it'd occupy at doc-wide
    // height (3 > 1).
    const section2Pages = plan.entries.filter((e) => e.activeSectionId === "s2");
    expect(section2Pages.length).toBe(3);
    // Each section-2 entry carries the SHORT override + the smaller blockSize.
    for (const e of section2Pages) {
      expect(e.pageConfig).toBe(SHORT_PAGE);
      expect(e.blockSize).toBe(150);
    }
    // Section 1 unaffected: doc-wide config + height.
    expect(nth(plan.entries, 0, "entry").pageConfig).toBe(DOC_WIDE_PAGE);
    expect(nth(plan.entries, 0, "entry").blockSize).toBe(300);
    // Running-sum offsets monotonic; within section 2 the increment is the
    // SMALLER 150 + 20 = 170 per page. Page 0 (s1, 300): 0. Page 1 (s2): 0 +
    // 300 + 20 = 320. Page 2 (s2): 320 + 150 + 20 = 490. Page 3 (s2): 490 + 170
    // = 660.
    expect(plan.entries.map((e) => e.blockOffset)).toEqual([0, 320, 490, 660]);
    // Strictly increasing.
    for (let i = 1; i < plan.entries.length; i++) {
      expect(nth(plan.entries, i, "entry").blockOffset).toBeGreaterThan(nth(plan.entries, i - 1, "entry").blockOffset);
    }
    // totalBlockSize = last offset + last blockSize = 660 + 150 = 810.
    expect(plan.totalBlockSize).toBe(810);
  });

  it("empty metas doc ⇒ 1 page of doc-wide height; running-sum total = pageBlockSize", () => {
    // No metas ⇒ fitOnePage produces a single empty page (resumeOut null), so
    // this is really a 1-page doc of height = doc-wide pageBlockSize. Asserting
    // the running-sum total stays correct for the minimal case.
    const plan = measurePass([], DOC_WIDE_PAGE, IMPLICIT_SECTION_PLAN);
    expect(plan.entries.length).toBe(1);
    expect(plan.totalBlockSize).toBe(300);
  });
});

describe("measurePass — per-section geometry incremental reuse gate", () => {
  // Hand-built metas + rootChildren (ref-stable across cycles) drive the
  // carry-forward. Sections are expressed via hand-built SectionPlans whose
  // boundaries carry (or gain) a pageConfig.
  function fakeChildren(n: number): readonly RenderNode[] {
    // Distinct frozen objects; ref-stability across cycles is what reuse needs.
    return Object.freeze(Array.from({ length: n }, (_, i) => ({ key: `b${i}` }))) as never;
  }

  it("rebuild with identical metas/sectionPlan (section 2 overridden) ⇒ all pages reuse", () => {
    const metas = Array.from({ length: 6 }, () => blockMeta(100));
    const children = fakeChildren(6);
    const sectionPlan: SectionPlan = {
      effectiveDefaultColumns: DEFAULT_COLUMN_CONFIG,
      boundaries: [
        { startFlattenedIndex: 0, sectionId: null },
        { startFlattenedIndex: 3, sectionId: "s2" as BlockId, pageConfig: TALL_PAGE },
      ],
    };
    const plan1 = measurePass(metas, DOC_WIDE_PAGE, sectionPlan, children);
    expect(plan1.entries.length).toBe(2);

    __resetFitOnePageCallCountForTest();
    const plan2 = measurePass(metas, DOC_WIDE_PAGE, sectionPlan, children, plan1);
    const fitCalls = __getFitOnePageCallCountForTest();

    // Nothing changed ⇒ every page reuses ⇒ no fitOnePage calls.
    expect(fitCalls).toBe(0);
    expect(plan2.entries.map((e) => e.blockOffset)).toEqual(
      plan1.entries.map((e) => e.blockOffset),
    );
    expect(plan2.entries.map((e) => e.blockSize)).toEqual([300, 500]);
    expect(nth(plan2.entries, 1, "entry").pageConfig).toBe(TALL_PAGE);
  });

  it("ADDING a geometry override to section 2 ⇒ section-1 pages reuse, section-2 pages refit", () => {
    // plan1: uniform (no override). 6 × 100; section 1 caps at index 3 (content
    // 300 ⇒ blocks 0,1,2 on page 0). Section 2 (doc-wide too) holds blocks 3,4,5
    // on page 1. Two pages, both doc-wide.
    const metas = Array.from({ length: 6 }, () => blockMeta(100));
    const children = fakeChildren(6);
    const planUniform: SectionPlan = {
      effectiveDefaultColumns: DEFAULT_COLUMN_CONFIG,
      boundaries: [
        { startFlattenedIndex: 0, sectionId: null },
        { startFlattenedIndex: 3, sectionId: "s2" as BlockId },
      ],
    };
    const plan1 = measurePass(metas, DOC_WIDE_PAGE, planUniform, children);
    expect(plan1.entries.length).toBe(2);
    expect(plan1.entries.map((e) => e.blockSize)).toEqual([300, 300]);

    // New plan: section 2 GAINS a taller geometry. Section 1's page (0) effCfg
    // is unchanged (doc-wide) ⇒ reuses; section 2's page effCfg changed ⇒ refits.
    const planOverridden: SectionPlan = {
      effectiveDefaultColumns: DEFAULT_COLUMN_CONFIG,
      boundaries: [
        { startFlattenedIndex: 0, sectionId: null },
        { startFlattenedIndex: 3, sectionId: "s2" as BlockId, pageConfig: TALL_PAGE },
      ],
    };

    __resetFitOnePageCallCountForTest();
    const plan2 = measurePass(metas, DOC_WIDE_PAGE, planOverridden, children, plan1);
    const fitCalls = __getFitOnePageCallCountForTest();

    // Section 1's page reuses (effCfg unchanged); section 2's page refits
    // (effCfg changed doc-wide → TALL). Exactly 1 fitOnePage call (the s2 page).
    expect(fitCalls).toBe(1);
    expect(plan2.entries.length).toBe(2);
    expect(plan2.entries.map((e) => e.blockSize)).toEqual([300, 500]);
    expect(nth(plan2.entries, 1, "entry").pageConfig).toBe(TALL_PAGE);
    // Section-1 page's offset unchanged; section-2 page still at the running sum.
    expect(plan2.entries.map((e) => e.blockOffset)).toEqual([0, 320]);
  });

  it("an EARLIER section's taller geometry SHIFTS later sections' offsets down (reuse keeps shape, gets fresh offset)", () => {
    // plan1: TWO sections, NEITHER overridden (uniform doc-wide). 6 × 100 blocks.
    // Section 1 (boundary 0) caps at index 3 ⇒ blocks 0,1,2 on page 0 (content
    // 300). Section 2 (boundary 3, doc-wide) holds blocks 3,4,5 on page 1.
    // Uniform: offsets [0, 320], blockSizes [300, 300].
    const metas = Array.from({ length: 6 }, () => blockMeta(100));
    const children = fakeChildren(6);
    const planUniform: SectionPlan = {
      effectiveDefaultColumns: DEFAULT_COLUMN_CONFIG,
      boundaries: [
        { startFlattenedIndex: 0, sectionId: null },
        { startFlattenedIndex: 3, sectionId: "s2" as BlockId },
      ],
    };
    const plan1 = measurePass(metas, DOC_WIDE_PAGE, planUniform, children);
    expect(plan1.entries.map((e) => e.blockOffset)).toEqual([0, 320]);
    expect(plan1.entries.map((e) => e.blockSize)).toEqual([300, 300]);

    // New plan: SECTION 1 GAINS a taller geometry; section 2 still has none.
    // Section 1's page refits + grows (300 → 500). Section 2's fit SHAPE is
    // unchanged (still blocks 3,4,5 on one doc-wide page) — it MAY reuse — but
    // its OFFSET must shift DOWN by the running-sum delta from section 1's
    // taller page; it must NOT keep plan1's offset of 320.
    const planSection1Tall: SectionPlan = {
      effectiveDefaultColumns: DEFAULT_COLUMN_CONFIG,
      boundaries: [
        { startFlattenedIndex: 0, sectionId: null, pageConfig: TALL_PAGE },
        { startFlattenedIndex: 3, sectionId: "s2" as BlockId },
      ],
    };
    const plan2 = measurePass(metas, DOC_WIDE_PAGE, planSection1Tall, children, plan1);

    expect(plan2.entries.length).toBe(2);
    expect(plan2.entries.map((e) => e.startIndex)).toEqual([0, 3]);
    // Section 1 refit + taller (300 → 500); section 2 still doc-wide height (300).
    expect(plan2.entries.map((e) => e.blockSize)).toEqual([500, 300]);
    expect(nth(plan2.entries, 0, "entry").pageConfig).toBe(TALL_PAGE);
    // Section 2's effective pageConfig is STILL doc-wide (no override there).
    expect(nth(plan2.entries, 1, "entry").pageConfig).toBe(DOC_WIDE_PAGE);
    // Section 1 page starts at 0 but is now 500 tall; section 2 page's offset
    // shifts DOWN to the new running sum: 0 + 500 + 20 = 520 (was 320 in plan1).
    expect(plan2.entries.map((e) => e.blockOffset)).toEqual([0, 520]);
    // Section 2's offset did NOT keep plan1's value — it shifted by the +200
    // running-sum delta from section 1's taller page. Asserted regardless of
    // whether section 2's page reused its fit SHAPE (children/resumeOut).
    expect(nth(plan2.entries, 1, "entry").blockOffset).not.toBe(nth(plan1.entries, 1, "entry").blockOffset);
    expect(nth(plan2.entries, 1, "entry").blockOffset).toBe(nth(plan1.entries, 1, "entry").blockOffset + 200);
    // Section 2 reuses its fit SHAPE (same children slice + resumeOut) despite
    // the fresh offset — same childrenCount, same null resumeOut.
    expect(nth(plan2.entries, 1, "entry").children.length).toBe(nth(plan1.entries, 1, "entry").children.length);
    expect(nth(plan2.entries, 1, "entry").resumeOut).toEqual(nth(plan1.entries, 1, "entry").resumeOut);
    // totalBlockSize reflects the running sum: 520 + 300 = 820.
    expect(plan2.totalBlockSize).toBe(820);
  });

  it("a DOC-WIDE pageConfig change with a prevPlan forces a full refit (coarse guard fires)", () => {
    // A doc-wide config tall enough to hold all 6 × 100 blocks on one page
    // (content 700). Distinct from DOC_WIDE_PAGE so the new pageContentBlockSize
    // differs and the whole-plan-refuse guard fires.
    const WIDE_PAGE: PageConfig = {
      pageInlineSize: 600,
      pageBlockSize: 700,
      pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
      pageGap: 20,
    };
    const metas = Array.from({ length: 6 }, () => blockMeta(100));
    const children = fakeChildren(6);
    const plan1 = measurePass(metas, DOC_WIDE_PAGE, IMPLICIT_SECTION_PLAN, children);
    expect(plan1.entries.length).toBe(2); // content 300 ⇒ 3 per page ⇒ 2 pages.

    // Pass a DIFFERENT doc-wide pageBlockSize ⇒ pageContentBlockSize differs ⇒
    // the whole-plan-refuse guard refuses every reused boundary ⇒ full refit.
    const plan2 = measurePass(metas, WIDE_PAGE, IMPLICIT_SECTION_PLAN, children, plan1);
    __resetFitOnePageCallCountForTest();
    const plan3 = measurePass(metas, WIDE_PAGE, IMPLICIT_SECTION_PLAN, children, plan1);
    const fitCalls = __getFitOnePageCallCountForTest();

    // content 700 ⇒ all 6 blocks fit on one page now (the plan SHAPE changed,
    // which only a full refit produces — reuse of the prior 2-page plan could
    // not have collapsed it).
    expect(plan2.entries.length).toBe(1);
    expect(plan3.entries.length).toBe(1);
    // The coarse doc-wide guard nuked all reuse ⇒ full refit (≥ pageCount calls).
    expect(fitCalls).toBeGreaterThanOrEqual(plan3.entries.length);
  });
});
