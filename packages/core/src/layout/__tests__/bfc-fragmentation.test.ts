// packages/core/src/layout/__tests__/bfc-fragmentation.test.ts
import { describe, it, expect } from "vitest";
import type { FragmentationContext } from "../fragmentation";
import { layoutBlock } from "../bfc";
import { makeRootContext } from "../layout-context";
import { INITIAL_COMPUTED_STYLE } from "../../styles";
import { createMockShaper } from "../mock-shaper";
import { cascadePass } from "../../cascade";
import { createElementBox } from "../../render/render-node-v2";
import type { ElementBox } from "../../render/render-node-v2";
import type { Style } from "../../styles";

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

    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, fragmentation);

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

    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, fragmentation);

    expect(box).not.toBeNull();
    expect(box!.children).toHaveLength(2);
    expect(breakToken).toEqual({
      type: "block",
      resumeChildIndex: 2,
      resumeChildToken: null,
    });
  });

  it("returns box: null when even the first child doesn't fit", () => {
    const root = buildBlockChildren(3, 1000); // child too tall
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 500,
      pageIndex: 0,
      resumeFrom: null,
    };

    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, fragmentation);

    // Note: C.6 will add the alone-on-empty-page overflow exception. For C.1,
    // bare push-to-next-page semantics: null box + breakToken at index 0.
    expect(box).toBeNull();
    expect(breakToken).toEqual({
      type: "block",
      resumeChildIndex: 0,
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
    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, fragmentation);
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
    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, fragmentation);
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
    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, fragmentation);
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
    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, fragmentation);
    expect(box).not.toBeNull();
    expect(box!.children).toHaveLength(3);
    expect(breakToken).toBeNull();
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

describe("BFC fragmentation — break-inside: avoid", () => {
  it("discards a partial nested-fragment result; pushes child whole when break-inside: avoid", () => {
    // X has 4 inner children × 50 = 200 total. availableBlockSize = 150 → without
    // break-inside: avoid, X's BFC would partial (3 children fit). With avoid,
    // outer BFC discards X's partial and pushes X whole.
    const root = buildNestedBlockChildren(4, 50, { breakInside: "avoid" });
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 150,
      pageIndex: 0,
      resumeFrom: null,
    };
    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, fragmentation);
    // X is the first child of root; pushing X whole means root returns box: null.
    expect(box).toBeNull();
    expect(breakToken).toEqual({ type: "block", resumeChildIndex: 0, resumeChildToken: null });
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
    const { box, breakToken } = layoutBlock(cascaded, 0, 0, ctx, shaper, fragmentation);
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
    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, fragmentation);
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
    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, fragmentation);
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
    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, fragmentation);
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
    const { box, breakToken } = layoutBlock(root, 0, 0, ctx, shaper, fragmentation);
    expect(box).not.toBeNull();
    expect(box!.children).toHaveLength(4);
    expect(breakToken).toBeNull();
  });
});
