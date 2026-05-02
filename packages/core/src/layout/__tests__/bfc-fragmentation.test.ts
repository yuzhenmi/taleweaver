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
