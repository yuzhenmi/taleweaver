// packages/core/src/layout/__tests__/measure-pass.test.ts
//
// Direct unit tests for `measurePass` + `measurePassUnsupported`. The broad
// oracle-driven equivalence suite lives in `measure-pass-equivalence.test.ts`;
// these assert the plan SHAPE (offsets, slices, resume tokens, totals) and the
// unsupported-doc fallback detector (float/clear, padded container, mixed
// content) on hand-built inputs.

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

  // --- (2) padded / bordered CONTAINER (block element with block children). ---

  it("true for a container with block-axis padding > 0 (#254)", () => {
    const container = createElementBox("c", { display: "block", paddingBlockStart: 12 } as Style, [
      para("p0"),
      para("p1"),
    ]);
    const root = cascade({ display: "block" }, [container]);
    expect(measurePassUnsupported(root)).toBe(true);
  });

  it("true for a container with a block-axis border > 0 (#254)", () => {
    const container = createElementBox(
      "c",
      { display: "block", borderBlockEndWidth: 3, borderBlockEndStyle: "solid" } as Style,
      [para("p0"), para("p1")],
    );
    const root = cascade({ display: "block" }, [container]);
    expect(measurePassUnsupported(root)).toBe(true);
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

  // --- (3) MIXED content (block element with BOTH block AND inline children). ---

  it("true for a block element with both block and inline children (#253)", () => {
    // A container holding a paragraph (block) AND a bare text run (inline):
    // buildBlockFitMetas walks only the block child and drops the inline run.
    const mixed = createElementBox("m", { display: "block" } as Style, [
      para("p0"),
      createTextBox("loose-t", {}, "bare inline text"),
    ]);
    const root = cascade({ display: "block" }, [mixed]);
    expect(measurePassUnsupported(root)).toBe(true);
  });

  it("false for a pure-inline paragraph (only text children, no block children)", () => {
    const root = cascade({ display: "block" }, [para("p0")]);
    expect(measurePassUnsupported(root)).toBe(false);
  });
});
