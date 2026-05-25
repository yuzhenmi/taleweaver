// packages/core/src/layout/__tests__/measure-pass.test.ts
//
// Direct unit tests for `measurePass` + `measurePassUnsupported`. The broad
// oracle-driven equivalence suite lives in `measure-pass-equivalence.test.ts`;
// these assert the plan SHAPE (offsets, slices, resume tokens, totals) and the
// unsupported-doc fallback detector (now ONLY float/clear — padded/bordered
// containers and mixed content are modeled per #253/#254) on hand-built inputs.

import { describe, it, expect } from "vitest";
import { measurePass, measurePassUnsupported } from "../measure-pass";
import type { BlockFitMeta } from "../fit-core";
import type { PageConfig } from "../page-config";
import { cascadePass } from "../../cascade";
import { createElementBox, createTextBox } from "../../render/render-node";
import type { Style } from "../../styles";

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
    const plan = measurePass(metas, PAGE);
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
    const plan = measurePass(metas, PAGE);
    expect(plan.entries.length).toBe(4);
    expect(plan.entries.map((e) => e.blockOffset)).toEqual([0, 320, 640, 960]);
    expect(plan.entries.map((e) => e.startIndex)).toEqual([0, 3, 6, 9]);
    // total = 4 pages × 300 + 3 gaps × 20 = 1260.
    expect(plan.totalBlockSize).toBe(1260);
  });

  it("resume tokens chain across pages", () => {
    const metas = Array.from({ length: 5 }, () => blockMeta(100));
    const plan = measurePass(metas, PAGE);
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
    const plan = measurePass(metas, PAGE, fakeChildren as never[]);
    expect(plan.entries[0].children).toEqual([{ id: 0 }, { id: 1 }, { id: 2 }]);
    expect(plan.entries[1].children).toEqual([{ id: 3 }, { id: 4 }]);
  });

  it("empty children when rootChildren omitted", () => {
    const plan = measurePass([blockMeta(50)], PAGE);
    expect(plan.entries[0].children).toEqual([]);
  });

  it("seeds listCounterAtStart per page", () => {
    // 9 list-items of 100; 3 per page ⇒ page seeds 0, 3, 6.
    const metas = Array.from({ length: 9 }, () => blockMeta(100, { listItem: true }));
    const plan = measurePass(metas, PAGE);
    expect(plan.entries.map((e) => e.listCounterAtStart)).toEqual([0, 3, 6]);
  });

  it("throws on a degenerate page config (content block-size <= 0)", () => {
    const bad: PageConfig = { ...PAGE, pageMargins: { blockStart: 200, blockEnd: 200, inlineStart: 0, inlineEnd: 0 } };
    expect(() => measurePass([blockMeta(50)], bad)).toThrow();
  });

  it("stays within the safe page-count bound for a healthy multi-page doc", () => {
    // The page-count guard (`pageIndex > metas.length * 2 + 2`) is unreachable
    // whenever each page advances state. A normal doc that produces many pages
    // (50 blocks, 3/page ⇒ ~17 pages, well under the bound 50*2+2=102) must
    // never trip it.
    const metas = Array.from({ length: 50 }, () => blockMeta(100));
    expect(() => measurePass(metas, PAGE)).not.toThrow();
    const plan = measurePass(metas, PAGE);
    expect(plan.entries.length).toBeLessThanOrEqual(metas.length * 2 + 2);
  });
});

describe("measurePass — pageIndexAtBlockOffset", () => {
  // 10 × 100; page content 300 ⇒ 3 per page ⇒ 4 pages.
  // blockOffsets: [0, 320, 640, 960]; pageBlockSize 300, pageGap 20.
  // totalBlockSize = 4 × 300 + 3 × 20 = 1260.
  const metas = Array.from({ length: 10 }, () => blockMeta(100));

  it("y in the middle of page 0 → 0", () => {
    const plan = measurePass(metas, PAGE);
    expect(plan.pageIndexAtBlockOffset(150)).toBe(0);
  });

  it("y at the exact top edge of a page → that page", () => {
    const plan = measurePass(metas, PAGE);
    expect(plan.pageIndexAtBlockOffset(0)).toBe(0);
    expect(plan.pageIndexAtBlockOffset(320)).toBe(1);
    expect(plan.pageIndexAtBlockOffset(640)).toBe(2);
    expect(plan.pageIndexAtBlockOffset(960)).toBe(3);
  });

  it("y in the middle of page 2 → 2", () => {
    const plan = measurePass(metas, PAGE);
    // page 2 spans [640, 960); 800 is inside it.
    expect(plan.pageIndexAtBlockOffset(800)).toBe(2);
  });

  it("y in the inter-page gap → the page above (half-open interval)", () => {
    const plan = measurePass(metas, PAGE);
    // gap after page 0 spans [300, 320); 310 belongs to page 0 (the interval
    // [entry.blockOffset, nextEntry.blockOffset) extends through the gap).
    expect(plan.pageIndexAtBlockOffset(310)).toBe(0);
    // gap after page 2 spans [940, 960); 950 belongs to page 2.
    expect(plan.pageIndexAtBlockOffset(950)).toBe(2);
  });

  it("y just below totalBlockSize → last page; y == totalBlockSize → last page (clamp)", () => {
    const plan = measurePass(metas, PAGE);
    // last page spans [960, 1260); 1259 is inside.
    expect(plan.pageIndexAtBlockOffset(1259)).toBe(3);
    // exactly totalBlockSize clamps to last page.
    expect(plan.pageIndexAtBlockOffset(plan.totalBlockSize)).toBe(3);
  });

  it("y past totalBlockSize → last (clamp)", () => {
    const plan = measurePass(metas, PAGE);
    expect(plan.pageIndexAtBlockOffset(99999)).toBe(3);
  });

  it("y < 0 → 0 (clamp)", () => {
    const plan = measurePass(metas, PAGE);
    expect(plan.pageIndexAtBlockOffset(-50)).toBe(0);
  });

  it("does NOT over-add a trailing gap on the last page", () => {
    // A naive `blockOffset + blockSize + pageGap` per-page reconstruction would
    // place the last page's bottom at 960 + 300 + 20 = 1280, past
    // totalBlockSize (1260). y = 1265 (above totalBlockSize) must still clamp to
    // the last page, NOT report some phantom page index.
    const plan = measurePass(metas, PAGE);
    expect(plan.pageIndexAtBlockOffset(1265)).toBe(3);
  });

  it("single-page doc → always page 0", () => {
    const plan = measurePass([blockMeta(50)], PAGE);
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
    const plan = measurePass(metas, PAGE, root.children);

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
    const plan = measurePass(metas, PAGE, root.children);
    expect(plan.pageIndexOfBlock("nope")).toBe(-1);
  });

  it("returns -1 for every block when rootChildren is omitted (no keys to map)", () => {
    const metas = Array.from({ length: 3 }, () => blockMeta(50));
    const plan = measurePass(metas, PAGE);
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
    const plan = measurePass(metas, PAGE, root.children);
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
    const plan = measurePass(metas, PAGE, root.children);

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
    const plan = measurePass(metas, PAGE, root.children);
    expect(plan.pageSpanOfBlock("nope")).toBeNull();

    const planNoChildren = measurePass(metas, PAGE);
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
    const plan = measurePass(metas, PAGE, root.children);
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
    const plan = measurePass(metas, PAGE, root.children);
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
