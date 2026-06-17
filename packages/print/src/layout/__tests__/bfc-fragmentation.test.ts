// packages/core/src/layout/__tests__/bfc-fragmentation.test.ts
import { describe, it, expect } from "vitest";
import type { FragmentationContext } from "../fragmentation";
import { layoutBlock } from "../bfc";
import { makeRootContext } from "../layout-context";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { createMockShaper } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { createElementBox, createTextBox } from "@taleweaver/core";
import type { ElementBox } from "@taleweaver/core";
import type { Style } from "@taleweaver/core";
import type { LayoutBox } from "../layout-box";

/**
 * Narrow a `layoutBlock` result's `box` to non-null WITHOUT widening its
 * specific box type (so `.children` etc. stay accessible) — avoids `!` per the
 * project no-non-null-assertion rule.
 */
function placed<T extends LayoutBox>(box: T | null): T {
  if (box === null) throw new Error("expected a placed box, got null");
  return box;
}

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

/** Collect all MarkerBox keys descending from a LayoutBox (markers are direct siblings). */
function collectMarkerKeys(box: LayoutBox): string[] {
  const out: string[] = [];
  function walk(b: LayoutBox) {
    if (b.type === "marker") out.push(b.key);
    if ("children" in b && b.children) {
      for (const c of b.children) walk(c);
    }
  }
  walk(box);
  return out;
}

/** Build a root ElementBox with N block children, each of fixed block-size. */
function buildBlockChildren(count: number, childBlockSize: number): ElementBox {
  const children = Array.from({ length: count }, (_, i) =>
    createElementBox(`child-${i}`, { display: "block", blockSize: childBlockSize }, []),
  );
  const root = createElementBox("root", { display: "block" }, children);
  const cascaded = cascadePass(root);
  if (cascaded.type !== "element") throw new Error("cascadePass returned non-element");
  return cascaded;
}

/** Build a root with N block children, optionally with per-child style overrides. */
function buildBlockChildrenWithStyles(
  count: number,
  childBlockSize: number,
  styleOverrides?: ReadonlyMap<number, Partial<Style>>,
): ElementBox {
  const children = Array.from({ length: count }, (_, i) =>
    createElementBox(`child-${i}`, { display: "block", blockSize: childBlockSize, ...(styleOverrides?.get(i) ?? {}) } as Style, []),
  );
  const root = createElementBox("root", { display: "block" }, children);
  const cascaded = cascadePass(root);
  if (cascaded.type !== "element") throw new Error("cascadePass returned non-element");
  return cascaded;
}

/**
 * Build a root ElementBox with one paragraph child.
 * The paragraph has `numLines` lines of content via explicit \n characters.
 * Each line produces one LineBox regardless of container width (whiteSpace: "pre").
 */
function buildRootWithParagraph(numLines: number): { root: ElementBox } {
  const parts: string[] = [];
  for (let i = 0; i < numLines; i++) parts.push("x");
  const text = parts.join("\n");
  const textNode = createTextBox("t", { whiteSpace: "pre" }, text);
  const paragraph = createElementBox("p", { display: "block", whiteSpace: "pre" } as Style, [textNode]);
  const root = createElementBox("root", { display: "block" } as Style, [paragraph]);
  const cascaded = cascadePass(root);
  if (cascaded.type !== "element") throw new Error("cascadePass returned non-element");
  return { root: cascaded };
}

describe("BFC fragmentation — whole-block placement", () => {
  it("places all children when they fit", () => {
    const root = buildBlockChildren(3, 100); // 3 × 100 = 300 total
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 1000,
      pageIndex: 0,
      resumeFrom: null,
    };

    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, undefined, fragmentation);

    expect(box).not.toBeNull();
    expect(breakToken).toBeNull();
    expect(box!.children).toHaveLength(3);
  });

  it("stops at the first child that doesn't fit; returns BlockBreakToken", () => {
    const root = buildBlockChildren(5, 100); // 5 × 100 = 500 total
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 250, // fits 2 children (200), 3rd doesn't fit
      pageIndex: 0,
      resumeFrom: null,
    };

    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, undefined, fragmentation);

    expect(box).not.toBeNull();
    expect(box!.children).toHaveLength(2);
    expect(breakToken).toEqual({
      type: "block",
      resumeChildIndex: 2,
      resumeChildToken: null,
    });
  });

  it("places oversize first child anyway (overflow rule, C.6): returns box with overflowing child, no break token", () => {
    const root = buildBlockChildren(3, 1000); // child too tall (1000 > availableBlockSize 500)
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 500,
      pageIndex: 0,
      resumeFrom: null,
    };

    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, undefined, fragmentation);

    // C.6 overflow rule: first child alone on empty fragment — place it anyway (overflow).
    // The child is 1000 tall; subsequent children (also 1000) won't fit and push to next fragment.
    expect(box).not.toBeNull();
    expect(box!.children).toHaveLength(1); // only first child placed (rest don't fit after overflow)
    expect(nth(placed(box).children, 0, "child").height).toBe(1000);
    expect(breakToken).toEqual({
      type: "block",
      resumeChildIndex: 1,
      resumeChildToken: null,
    });
  });
});

describe("BFC fragmentation — break-before", () => {
  it("forces a page break before child K when cs.breakBefore = 'page'", () => {
    // Children 0..3, 100 each. Child 2 has breakBefore: page.
    const root = buildBlockChildrenWithStyles(4, 100, new Map([[2, { breakBefore: "page" }]]));
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 1000,
      pageIndex: 0,
      resumeFrom: null,
    };
    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, undefined, fragmentation);
    expect(box).not.toBeNull();
    expect(box!.children).toHaveLength(2);
    expect(breakToken).toEqual({ type: "block", resumeChildIndex: 2, resumeChildToken: null });
  });

  it("treats break-before: page on the first child of the fragment as no-op (CSS L4 §3.4)", () => {
    // Child 0 has breakBefore: page. Should not split (nothing placed yet).
    const root = buildBlockChildrenWithStyles(3, 100, new Map([[0, { breakBefore: "page" }]]));
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 1000,
      pageIndex: 0,
      resumeFrom: null,
    };
    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, undefined, fragmentation);
    expect(box).not.toBeNull();
    expect(box!.children).toHaveLength(3);
    expect(breakToken).toBeNull();
  });

  it("treats 'page' as a forced break (normalizeBreakValue maps 'always' -> 'page'; Style uses 'page')", () => {
    // Since Style.breakBefore only accepts "auto" | "page" | "avoid", we test 'page' directly.
    // normalizeBreakValue("always") === "page" is covered by fragmentation.test.ts.
    const root = buildBlockChildrenWithStyles(4, 100, new Map([[2, { breakBefore: "page" }]]));
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 1000,
      pageIndex: 0,
      resumeFrom: null,
    };
    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, undefined, fragmentation);
    expect(box).not.toBeNull();
    expect(box!.children).toHaveLength(2);
    expect(breakToken).toEqual({ type: "block", resumeChildIndex: 2, resumeChildToken: null });
  });

  it("ignores unsupported break-before values (e.g., 'avoid' normalizes to 'avoid' — not a forced break)", () => {
    // 'avoid' is in the Style type and normalizes to 'avoid' (not 'page'), so no forced break.
    const root = buildBlockChildrenWithStyles(3, 100, new Map([[1, { breakBefore: "avoid" }]]));
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 1000,
      pageIndex: 0,
      resumeFrom: null,
    };
    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, undefined, fragmentation);
    expect(box).not.toBeNull();
    expect(box!.children).toHaveLength(3);
    expect(breakToken).toBeNull();
  });

  // FN-6.2(a) regression: the break-before consumer MUST run BEFORE marker
  // generation. If the marker were generated first, a child that carries BOTH
  // `markerText`/`list-item` AND `breakBefore: page` (with the fragment already
  // non-empty) would (a) orphan its marker box into the pre-break partial result
  // AND regenerate it when the block resumes on the next page — a double marker —
  // and (b) advance the list counter on a page where the item never actually
  // lands. These tests pin the fix: the marker (and `listCounter++`) only happen
  // once the block is placed on a page.


  it("does NOT orphan an explicit-markerText child's marker onto the pre-break page (FN-6.2a)", () => {
    // child-0: normal block places content on the fragment.
    // child-1: carries markerText "1" AND breakBefore: page → forces a break.
    // The fragment already holds child-0, so the break fires before child-1.
    // BEFORE the fix (marker generated first): "child-1-marker" would be present
    // in the pre-break partial AND regenerated on resume → double marker.
    const root = buildBlockChildrenWithStyles(
      3,
      100,
      new Map([[1, { markerText: "1", breakBefore: "page" }]]),
    );
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 1000,
      pageIndex: 0,
      resumeFrom: null,
    };

    // Page 1 (pre-break): child-0 placed, break fired before child-1.
    const r1 = layoutBlock(root, 0, 0, ctx, shaper, undefined, fragmentation);
    expect(r1.box).not.toBeNull();
    expect(placed(r1.box).children).toHaveLength(1); // only child-0, no orphaned marker
    expect(r1.breakToken).toEqual({ type: "block", resumeChildIndex: 1, resumeChildToken: null });
    // child-1's marker must NOT be orphaned onto the pre-break page.
    expect(collectMarkerKeys(placed(r1.box))).not.toContain("child-1-marker");

    // Page 2 (resume): child-1 (with its marker) + child-2 land here.
    const r2 = layoutBlock(root, 0, 0, ctx, shaper, undefined, {
      availableBlockSize: 1000,
      pageIndex: 1,
      resumeFrom: r1.breakToken,
    });
    expect(r2.box).not.toBeNull();
    expect(r2.breakToken).toBeNull();
    // The marker appears exactly ONCE, on the resumed page — never duplicated.
    const page2Markers = collectMarkerKeys(placed(r2.box)).filter((k) => k === "child-1-marker");
    expect(page2Markers).toEqual(["child-1-marker"]);
  });

});

/** Build a root with one child X that itself has N block-children of fixed size. */
function buildNestedBlockChildren(
  innerCount: number,
  innerBlockSize: number,
  xStyle: Partial<Style> = {},
): ElementBox {
  const innerChildren = Array.from({ length: innerCount }, (_, i) =>
    createElementBox(`inner-${i}`, { display: "block", blockSize: innerBlockSize }, []),
  );
  const x = createElementBox("x", { display: "block", ...xStyle } as Style, innerChildren);
  const root = createElementBox("root", { display: "block" }, [x]);
  const cascaded = cascadePass(root);
  if (cascaded.type !== "element") throw new Error("cascadePass returned non-element");
  return cascaded;
}

describe("BFC fragmentation — list-item marker degenerate-resume (#501)", () => {
  /** Collect all MarkerBox keys descending from a LayoutBox (markers are direct siblings). */
  function collectMarkerKeys(box: LayoutBox): string[] {
    const out: string[] = [];
    function walk(b: LayoutBox) {
      if (b.type === "marker") out.push(b.key);
      if ("children" in b && b.children) {
        for (const c of b.children) walk(c as LayoutBox);
      }
    }
    walk(box);
    return out;
  }

  /**
   * Build a root with:
   *  - `filler`: a plain block of `fillerSize` px that consumes the fragment's
   *    available space, leaving < one line-height for the next child.
   *  - `item`: a list-item carrying `markerText` and `numLines` lines of inline
   *    text (whiteSpace: "pre", one LineBox per line). It lands at the page-1
   *    bottom where ZERO content lines fit.
   */
  function buildFillerThenListItem(fillerSize: number, markerText: string, numLines: number): ElementBox {
    const filler = createElementBox("filler", { display: "block", blockSize: fillerSize } as Style, []);
    const lines = Array.from({ length: numLines }, () => "x").join("\n");
    const itemText = createTextBox("item-t", { whiteSpace: "pre" } as Style, lines);
    const item = createElementBox(
      "item",
      { display: "block", whiteSpace: "pre", markerText } as Style,
      [itemText],
    );
    const root = createElementBox("root", { display: "block" } as Style, [filler, item]);
    const cascaded = cascadePass(root);
    if (cascaded.type !== "element") throw new Error("cascadePass returned non-element");
    return cascaded;
  }

  it("does NOT orphan the marker on page 1 when the list-item places ZERO content there; emits it on the degenerate-resume page where the item actually starts", () => {
    // mockShaper: 16px line-height. availableBlockSize = 90; filler = 80 → 10px
    // remaining for `item`, which is < one 16px line → ZERO of the item's lines
    // fit on page 1. The fragment is NOT empty (filler already placed), so the
    // C.6 overflow rule does NOT fire — `item` breaks, resuming from line 0
    // (a DEGENERATE resume: nothing was placed on page 1).
    //
    // BEFORE the fix: the marker was pushed onto page 1 (orphan) BEFORE the
    // item's content was laid out; on page 2 the resume fragment suppressed it
    // (non-null token). Net: marker on page 1, content on page 2 — separated.
    const root = buildFillerThenListItem(80, "3.", 4);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);

    // Page 1: filler placed; item breaks (zero lines fit) → degenerate resume.
    const r1 = layoutBlock(root, 0, 0, ctx, shaper, undefined, {
      availableBlockSize: 90, pageIndex: 0, resumeFrom: null,
    });
    expect(r1.box).not.toBeNull();
    // The item's marker must NOT be orphaned onto page 1 (the item placed nothing here).
    expect(collectMarkerKeys(placed(r1.box))).not.toContain("item-marker");
    // The break resumes at the item (child index 1) from a degenerate inner token
    // (the item never placed any content on page 1).
    expect(r1.breakToken).not.toBeNull();
    const bt1 = r1.breakToken as { type: "block"; resumeChildIndex: number; resumeChildToken: unknown };
    expect(bt1.type).toBe("block");
    expect(bt1.resumeChildIndex).toBe(1);

    // Page 2 (resume): the item starts here — its marker MUST be present and
    // co-located with the item's first content line.
    const r2 = layoutBlock(root, 0, 0, ctx, shaper, undefined, {
      availableBlockSize: 200, pageIndex: 1, resumeFrom: r1.breakToken,
    });
    expect(r2.box).not.toBeNull();
    const page2 = placed(r2.box);
    const page2MarkerKeys = collectMarkerKeys(page2).filter((k) => k === "item-marker");
    expect(page2MarkerKeys).toEqual(["item-marker"]); // marker present exactly once
    expect(r2.breakToken).toBeNull(); // all 4 lines placed on page 2

    // Marker is co-located (same block band) with the item's first content line.
    function findByType(b: LayoutBox, type: string): LayoutBox | null {
      if (b.type === type) return b;
      if ("children" in b && b.children) {
        for (const c of b.children) {
          const hit = findByType(c as LayoutBox, type);
          if (hit !== null) return hit;
        }
      }
      return null;
    }
    function findMarker(b: LayoutBox): LayoutBox | null {
      if (b.type === "marker" && b.key === "item-marker") return b;
      if ("children" in b && b.children) {
        for (const c of b.children) {
          const hit = findMarker(c as LayoutBox);
          if (hit !== null) return hit;
        }
      }
      return null;
    }
    const marker = findMarker(page2);
    const firstLine = findByType(page2, "line");
    expect(marker).not.toBeNull();
    expect(firstLine).not.toBeNull();
    if (marker !== null && firstLine !== null) {
      // Marker shares the item's first line's block band on page 2.
      expect(Math.abs(marker.y - firstLine.y)).toBeLessThan(16);
    }
  });

  it("preserves #431: a list-item that places ≥1 line on page 1 shows its marker on page 1 and suppresses it on the mid-content continuation", () => {
    // filler = 30 → 60px remaining for `item` on page 1 (availableBlockSize 90).
    // 60px / 16px = 3 lines fit on page 1; the item has 6 lines → lines 3..5 spill
    // to page 2 as a MID-CONTENT continuation (resumeAtLine = 3 > 0, NON-degenerate).
    const root = buildFillerThenListItem(30, "3.", 6);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);

    // Page 1: filler + first 3 lines of the item (with its marker) placed.
    const r1 = layoutBlock(root, 0, 0, ctx, shaper, undefined, {
      availableBlockSize: 90, pageIndex: 0, resumeFrom: null,
    });
    expect(r1.box).not.toBeNull();
    expect(collectMarkerKeys(placed(r1.box))).toContain("item-marker"); // marker on the start page
    expect(r1.breakToken).not.toBeNull();

    // Page 2 (mid-content continuation): the tail lines — marker SUPPRESSED.
    const r2 = layoutBlock(root, 0, 0, ctx, shaper, undefined, {
      availableBlockSize: 200, pageIndex: 1, resumeFrom: r1.breakToken,
    });
    expect(r2.box).not.toBeNull();
    expect(collectMarkerKeys(placed(r2.box))).not.toContain("item-marker"); // no marker on the continuation
    expect(r2.breakToken).toBeNull();
  });
});

describe("BFC fragmentation — break-inside: avoid", () => {
  it("overflow rule (C.6): places break-inside:avoid child anyway when alone on empty fragment", () => {
    // X has 4 inner children × 50 = 200 total. availableBlockSize = 150 → without
    // break-inside: avoid, X's BFC would partial (3 children fit). With avoid,
    // outer BFC discards X's partial. X is the first (only) child of root, so the
    // overflow rule applies: re-invoke X without fragmentation and accept the overflowing result.
    const root = buildNestedBlockChildren(4, 50, { breakInside: "avoid" });
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 150,
      pageIndex: 0,
      resumeFrom: null,
    };
    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, undefined, fragmentation);
    // C.6: X is alone on empty fragment → place it anyway, overflowing.
    expect(box).not.toBeNull();
    expect(box!.children).toHaveLength(1); // X placed (all 4 inner children)
    expect(nth(placed(box).children, 0, "child").height).toBe(200); // X's full unfragmented size
    expect(breakToken).toBeNull(); // no remaining children
  });

  it("when previous siblings exist, returns them and pushes the avoid child whole", () => {
    // root has [smallChild, X]. smallChild fits (50). X has 4 inner × 50 = 200,
    // breakInside: avoid. availableBlockSize = 200 → smallChild fits, X's BFC
    // would partial (3 inner fit in remaining 150), but avoid pushes X whole.
    const innerChildren = Array.from({ length: 4 }, (_, i) =>
      createElementBox(`inner-${i}`, { display: "block", blockSize: 50 }, []),
    );
    const x = createElementBox("x", { display: "block", breakInside: "avoid" }, innerChildren);
    const smallChild = createElementBox("small", { display: "block", blockSize: 50 }, []);
    const root = createElementBox("root", { display: "block" }, [smallChild, x]);
    const cascaded = cascadePass(root);
    if (cascaded.type !== "element") throw new Error("cascadePass returned non-element");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 200,
      pageIndex: 0,
      resumeFrom: null,
    };
    const { box, breakToken } = layoutBlock(cascaded, 0, 0, ctx, shaper, undefined, fragmentation);
    // Expect smallChild placed; X pushed whole.
    expect(box).not.toBeNull();
    expect(box!.children).toHaveLength(1); // only smallChild
    expect(breakToken).toEqual({ type: "block", resumeChildIndex: 1, resumeChildToken: null });
  });

  it("doesn't change behavior when child's recursive call doesn't fragment (no partial to discard)", () => {
    // X has only 2 inner × 50 = 100. availableBlockSize = 200 → X fits whole.
    // breakInside: avoid is irrelevant; expect normal placement.
    const root = buildNestedBlockChildren(2, 50, { breakInside: "avoid" });
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 200,
      pageIndex: 0,
      resumeFrom: null,
    };
    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, undefined, fragmentation);
    expect(box).not.toBeNull();
    expect(box!.children).toHaveLength(1); // X with 2 inner children
    expect(breakToken).toBeNull();
  });
});

describe("BFC fragmentation — break-after", () => {
  it("forces a page break after child K when cs.breakAfter = 'page'", () => {
    // Children 0..3, 100 each. Child 1 has breakAfter: page.
    const root = buildBlockChildrenWithStyles(4, 100, new Map([[1, { breakAfter: "page" }]]));
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 1000,
      pageIndex: 0,
      resumeFrom: null,
    };
    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, undefined, fragmentation);
    expect(box).not.toBeNull();
    expect(box!.children).toHaveLength(2);
    expect(breakToken).toEqual({ type: "block", resumeChildIndex: 2, resumeChildToken: null });
  });

  it("is a no-op when break-after fires on the last child", () => {
    // Children 0..2; child 2 (last) has breakAfter: page.
    const root = buildBlockChildrenWithStyles(3, 100, new Map([[2, { breakAfter: "page" }]]));
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 1000,
      pageIndex: 0,
      resumeFrom: null,
    };
    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, undefined, fragmentation);
    expect(box).not.toBeNull();
    expect(box!.children).toHaveLength(3);
    expect(breakToken).toBeNull();
  });

  it("treats break-after: avoid as auto (no forced break)", () => {
    const root = buildBlockChildrenWithStyles(4, 100, new Map([[1, { breakAfter: "avoid" }]]));
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 1000,
      pageIndex: 0,
      resumeFrom: null,
    };
    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, undefined, fragmentation);
    expect(box).not.toBeNull();
    expect(box!.children).toHaveLength(4);
    expect(breakToken).toBeNull();
  });
});

describe("BFC fragmentation — margin truncation across breaks (CSS L4 §5.4)", () => {
  it("suppresses top-margin of the first child on a fresh fragment", () => {
    // First child has marginBlockStart: 50, blockSize: 80. availableBlockSize: 100.
    // Without truncation: offset += 50 (top-margin, noTopBoundary suppresses in
    // unpaginated), childBlockOffset = 50 before fit-check. The child fits (50 <= 100),
    // but after placing it offset = 50 + 80 = 130 on the NEXT iteration. For this
    // single-child test, we check the box is placed (not null) and the parent's
    // blockSize reflects the truncated margin: blockSize = 80 (not 130 with margin).
    //
    // Cleaner way: two children with large margins. Second child's fit depends on whether
    // first child used the full margin or not.
    // Child 0: marginBlockStart=60, blockSize=50 → with truncation: offset 0+50=50.
    // Child 1: marginBlockStart=0, blockSize=60 → collapse max(0,0)=0 → offset 50+60=110 > 100. Break.
    // Without truncation: child 0 at noTopBoundary → same (margin is suppressed by parent rule too).
    // To distinguish: use a parent with padding (no noTopBoundary), fragmentation context.
    // Actually for the simplest demonstrable case: a root with TOP PADDING (so noTopBoundary=false),
    // first child has marginBlockStart=50, blockSize=80. availableBlockSize=100.
    // Without fragmentation truncation: childBlockOffset += 50 → 50+10(pad)+80 = … wait, padding complicates.
    // Simplest: root with no padding. Child marginBlockStart=50, blockSize=80. availableBlockSize=100.
    //   - unpaginated: noTopBoundary=true → margin suppressed; blockSize=80. (existing behavior)
    //   - paginated without truncation: same (noTopBoundary still applies). So both paths produce same output.
    //   - To distinguish, need paginated path where the margin is NOT suppressed by noTopBoundary.
    //   This means: root WITH padding (noTopBoundary=false), paginated.
    //   With truncation: first child's margin is 0; childBlockOffset=10(pad)+0+80=90 → fits (90<=100).
    //   Without truncation: childBlockOffset=10(pad)+50+80=140 → overflow (whole-block fit checks against
    //     remaining = 100 - 10 = 90; child.height = 80 fits (80 <= 90) → actually placed either way.
    //   Hmm. The fit check is against childBlockOffset (which includes margin) vs remaining.
    //   remaining = availableBlockSize - childBlockOffset = 100 - (10 + 50) = 40. child.height=80 > 40 → break.
    //   With truncation: childBlockOffset=10(pad)+0=10; remaining=100-10=90; 80<=90 → fits.
    // So: root with paddingBlockStart=10, child marginBlockStart=50 blockSize=80, availableBlockSize=100.
    const child = createElementBox("c0", { display: "block", blockSize: 80, marginBlockStart: 50 } as Style, []);
    const root = createElementBox("root", { display: "block", paddingBlockStart: 10 } as Style, [child]);
    const cascaded = cascadePass(root) as ElementBox;
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 100,
      pageIndex: 0,
      resumeFrom: null,
    };
    const { box, breakToken } = layoutBlock(cascaded, 0, 0, ctx, shaper, undefined, fragmentation);
    // With truncation: child fits (childBlockOffset=10, remaining=90, blockSize=80<=90).
    expect(box).not.toBeNull();
    expect(box!.children).toHaveLength(1);
    expect(breakToken).toBeNull();
  });

  it("does NOT suppress the first child's top-margin in unpaginated mode", () => {
    // Same setup: root with paddingBlockStart=10, child marginBlockStart=50 blockSize=80.
    // No fragmentation → no truncation. The existing noTopBoundary=false path applies
    // (parent has padding), so childBlockOffset=10+50=60 before placing child.
    // There's no fit check without fragmentation, so the child is placed regardless.
    // Verifies the non-paginated path is unchanged — margin is NOT suppressed.
    const child = createElementBox("c0", { display: "block", blockSize: 80, marginBlockStart: 50 } as Style, []);
    const root = createElementBox("root", { display: "block", paddingBlockStart: 10 } as Style, [child]);
    const cascaded = cascadePass(root) as ElementBox;
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    // No fragmentation context
    const { box, breakToken } = layoutBlock(cascaded, 0, 0, ctx, shaper, undefined);
    expect(box).not.toBeNull();
    // blockSize = paddingBlockStart(10) + marginBlockStart(50) + blockSize(80) = 140
    expect(box!.height).toBe(140);
    expect(breakToken).toBeNull();
  });
});

describe("BFC fragmentation — resume from BlockBreakToken", () => {
  it("resumes at resumeChildIndex on the next fragment", () => {
    // 5 children × 100 each. availableBlockSize 250 (fits 2 children).
    const root = buildBlockChildren(5, 100);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);

    // First fragment: child 0..1 placed, breakToken at 2.
    const r1 = layoutBlock(root, 0, 0, ctx, shaper, undefined, {
      availableBlockSize: 250, pageIndex: 0, resumeFrom: null,
    });
    expect(r1.box).not.toBeNull();
    expect(r1.box!.children).toHaveLength(2);
    expect(r1.breakToken).toEqual({ type: "block", resumeChildIndex: 2, resumeChildToken: null });

    // Second fragment: resume at child 2.
    const r2 = layoutBlock(root, 0, 0, ctx, shaper, undefined, {
      availableBlockSize: 250, pageIndex: 1, resumeFrom: r1.breakToken,
    });
    expect(r2.box).not.toBeNull();
    expect(r2.box!.children).toHaveLength(2); // children 2, 3
    expect(r2.breakToken).toEqual({ type: "block", resumeChildIndex: 4, resumeChildToken: null });

    // Third fragment: resume at child 4 (last).
    const r3 = layoutBlock(root, 0, 0, ctx, shaper, undefined, {
      availableBlockSize: 250, pageIndex: 2, resumeFrom: r2.breakToken,
    });
    expect(r3.box).not.toBeNull();
    expect(r3.box!.children).toHaveLength(1); // child 4
    expect(r3.breakToken).toBeNull();
  });

  it("accepts IFCBreakToken as top-level resumeFrom when block has inline content (D.5)", () => {
    // layoutBlock now accepts IFCBreakToken at the top level for leaf blocks that contain
    // inline-run groups. For blocks with block children, the IFC token is set on
    // inlineRunResumeToken but never consumed (no inline-run groups), so layout proceeds
    // as if resumeFrom: null. This is the D.5 contract.
    const root = buildBlockChildren(3, 100);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    // Should not throw; IFC token is accepted (though not consumed for block children).
    expect(() =>
      layoutBlock(root, 0, 0, ctx, shaper, undefined, {
        availableBlockSize: 250,
        pageIndex: 0,
        resumeFrom: { type: "ifc", resumeAtLine: 0, paraFlowStart: 0 },
      }),
    ).not.toThrow();
  });

  it("threads resumeChildToken (IFCBreakToken) into the first child's recursive call", () => {
    // Root has one paragraph child with 10 lines (16px each = 160px total).
    // First fragment: availableBlockSize=80 → paragraph IFC fits 5 lines (5×16=80).
    // Root BFC break token carries the IFC token nested two levels deep:
    //   { type: "block", resumeChildIndex: 0, resumeChildToken:
    //     { type: "block", resumeChildIndex: 0, resumeChildToken:
    //       { type: "ifc", resumeAtLine: 5, paraFlowStart: 0 } } }
    // Second fragment: root BFC threads the nested token down to IFC.
    // IFC resumes from line 5, all 5 remaining lines fit (availableBlockSize=80).
    const { root } = buildRootWithParagraph(10);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 200);
    const shaper = createMockShaper(8, 16);

    // First fragment: root BFC fragments the paragraph's inline content.
    const r1 = layoutBlock(root, 0, 0, ctx, shaper, undefined, {
      availableBlockSize: 80, pageIndex: 0, resumeFrom: null,
    });
    expect(r1.box).not.toBeNull();
    // Root box has one child (the paragraph partial).
    expect(r1.box!.children).toHaveLength(1);
    // Root break token: resumes at child 0 with the paragraph's break token.
    expect(r1.breakToken).not.toBeNull();
    expect(r1.breakToken!.type).toBe("block");
    // The nested token chain carries the IFC resume.
    const rootBT = r1.breakToken as { type: "block"; resumeChildIndex: number; resumeChildToken: unknown };
    expect(rootBT.resumeChildIndex).toBe(0);
    const paragraphBT = rootBT.resumeChildToken as { type: "block"; resumeChildIndex: number; resumeChildToken: unknown };
    expect(paragraphBT.type).toBe("block");
    expect(paragraphBT.resumeChildIndex).toBe(0);
    const ifcBT = paragraphBT.resumeChildToken as { type: string; resumeAtLine: number };
    expect(ifcBT.type).toBe("ifc");
    expect(ifcBT.resumeAtLine).toBe(5);

    // Second fragment: root BFC resumes; threads IFC token to paragraph.
    const r2 = layoutBlock(root, 0, 0, ctx, shaper, undefined, {
      availableBlockSize: 80, pageIndex: 1, resumeFrom: r1.breakToken,
    });
    expect(r2.box).not.toBeNull();
    // Paragraph continuation has the remaining 5 lines.
    expect(r2.box!.children).toHaveLength(1); // one paragraph child
    expect(r2.breakToken).toBeNull(); // all content placed
  });
});

describe("BFC fragmentation — overflow rule (alone-on-empty-fragment, C.6)", () => {
  it("places oversize child anyway when alone on empty fragment (single child)", () => {
    // Single child block-size 1500 in availableBlockSize 500. No siblings to push.
    const root = buildBlockChildren(1, 1500);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 500,
      pageIndex: 0,
      resumeFrom: null,
    };
    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, undefined, fragmentation);
    expect(box).not.toBeNull();
    expect(box!.children).toHaveLength(1);
    expect(nth(placed(box).children, 0, "child").height).toBe(1500);
    expect(breakToken).toBeNull();
  });

  it("places oversize break-inside:avoid child anyway when alone on empty fragment", () => {
    // Duplicate of the updated C.4 test but standalone for C.6 clarity.
    // X has 4 inner × 50 = 200; availableBlockSize = 150. Alone on empty page.
    const root = buildNestedBlockChildren(4, 50, { breakInside: "avoid" });
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 150,
      pageIndex: 0,
      resumeFrom: null,
    };
    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, undefined, fragmentation);
    expect(box).not.toBeNull();
    expect(box!.children).toHaveLength(1); // X placed
    expect(nth(placed(box).children, 0, "child").height).toBe(200); // X's full unfragmented size
    expect(breakToken).toBeNull();
  });

  it("does NOT apply overflow rule when preceding siblings are already placed", () => {
    // Two children: small (50) + oversize (1000). Available 500.
    // Small fits; oversize won't fit; layoutChildren.length === 1 ≠ 0 → push normally.
    const small = createElementBox("small", { display: "block", blockSize: 50 } as Style, []);
    const big = createElementBox("big", { display: "block", blockSize: 1000 } as Style, []);
    const rootNode = createElementBox("root", { display: "block" } as Style, [small, big]);
    const cascaded = cascadePass(rootNode) as ElementBox;
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 500,
      pageIndex: 0,
      resumeFrom: null,
    };
    const { box, breakToken } = layoutBlock(cascaded, 0, 0, ctx, shaper, undefined, fragmentation);
    expect(box).not.toBeNull();
    expect(box!.children).toHaveLength(1); // only `small` placed
    expect(breakToken).toEqual({ type: "block", resumeChildIndex: 1, resumeChildToken: null });
  });
});
