import { describe, it, expect } from "vitest";
import {
  makeChildContext,
  makeRootContext,
  establishesAbsoluteContainingBlock,
  type LayoutContext,
} from "./layout-context";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";

describe("LayoutContext", () => {
  it("makeRootContext from INITIAL_COMPUTED_STYLE", () => {
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 800);
    expect(ctx.writingMode).toBe("horizontal-tb");
    expect(ctx.direction).toBe("ltr");
    expect(ctx.containingInlineSize).toBe(800);
    expect(ctx.containingBlockSize).toBe("indefinite");
  });

  it("makeChildContext inherits writing-mode and direction from parent CS", () => {
    const parent: LayoutContext = { ...makeRootContext(INITIAL_COMPUTED_STYLE, 800), isBFCRoot: false };
    const childCs = { ...INITIAL_COMPUTED_STYLE, direction: "rtl" as const };
    const child = makeChildContext(parent, childCs, 600, "indefinite");
    expect(child.direction).toBe("rtl");
    expect(child.containingInlineSize).toBe(600);
    // Shared intrinsic-sizes cache must be the same object.
    expect(child.intrinsicCache).toBe(parent.intrinsicCache);
    // Shared IFC state cache must be the same object.
    expect(child.ifcStateCache).toBe(parent.ifcStateCache);
  });

  it("makeRootContext creates a fresh floatEnv", () => {
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 800);
    expect(ctx.floatEnv).toBeDefined();
    // Fresh env has no floats; lowestFloatBlockEdge === 0.
    expect(ctx.floatEnv.lowestFloatBlockEdge()).toBe(0);
  });

  it("makeChildContext inherits parent floatEnv for non-BFC child (display:block)", () => {
    const parent: LayoutContext = makeRootContext(INITIAL_COMPUTED_STYLE, 800);
    // display:block does NOT establish a new BFC → inherits parent's floatEnv.
    const blockCs = { ...INITIAL_COMPUTED_STYLE, display: "block" as const };
    const child = makeChildContext(parent, blockCs, 600, "indefinite");
    expect(child.floatEnv).toBe(parent.floatEnv);
    expect(child.isBFCRoot).toBe(false);
  });

  it("makeChildContext creates fresh floatEnv for flow-root child (BFC establisher)", () => {
    const parent: LayoutContext = makeRootContext(INITIAL_COMPUTED_STYLE, 800);
    // display:flow-root establishes a new BFC → fresh floatEnv.
    const flowRootCs = { ...INITIAL_COMPUTED_STYLE, display: "flow-root" as const };
    const child = makeChildContext(parent, flowRootCs, 600, "indefinite");
    expect(child.floatEnv).not.toBe(parent.floatEnv);
    expect(child.isBFCRoot).toBe(true);
  });
});

// POSITIONING slice 3 — absolute containing block (abc) plumbing.
describe("LayoutContext — absolute containing block (slice 3)", () => {
  it("establishesAbsoluteContainingBlock: relative/absolute/transform establish; static does not", () => {
    expect(establishesAbsoluteContainingBlock({ ...INITIAL_COMPUTED_STYLE, position: "static" })).toBe(false);
    expect(establishesAbsoluteContainingBlock({ ...INITIAL_COMPUTED_STYLE, position: "relative" })).toBe(true);
    expect(establishesAbsoluteContainingBlock({ ...INITIAL_COMPUTED_STYLE, position: "absolute" })).toBe(true);
    // transform is forward-compat (slice 5); a non-empty transform establishes an abc.
    expect(establishesAbsoluteContainingBlock({
      ...INITIAL_COMPUTED_STYLE,
      transform: [{ fn: "translateX", tx: 10 }],
    })).toBe(true);
  });

  it("makeRootContext seeds the abc to the page/viewport (root owns it; block-size indefinite)", () => {
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 800);
    expect(ctx.ownsAbsoluteContainingBlock).toBe(true);
    expect(ctx.absoluteContainingBlock.inlineSize).toBe(800);
    expect(ctx.absoluteContainingBlock.blockSize).toBe("indefinite");
    expect(ctx.originFromAbc).toEqual({ inlineOffset: 0, blockOffset: 0 });
  });

  it("makeChildContext gives a positioned child a FRESH abc it owns; a static child inherits", () => {
    const parent = makeRootContext(INITIAL_COMPUTED_STYLE, 800);
    // Static child → inherits the parent abc, does NOT own it.
    const staticChild = makeChildContext(parent, { ...INITIAL_COMPUTED_STYLE, position: "static" }, 600, "indefinite");
    expect(staticChild.absoluteContainingBlock).toBe(parent.absoluteContainingBlock);
    expect(staticChild.ownsAbsoluteContainingBlock).toBe(false);
    // Relative child → fresh abc, owns it, originFromAbc reset to {0,0}.
    const relChild = makeChildContext(parent, { ...INITIAL_COMPUTED_STYLE, position: "relative" }, 600, "indefinite");
    expect(relChild.absoluteContainingBlock).not.toBe(parent.absoluteContainingBlock);
    expect(relChild.ownsAbsoluteContainingBlock).toBe(true);
    expect(relChild.originFromAbc).toEqual({ inlineOffset: 0, blockOffset: 0 });
  });

  it("a non-establishing in-flow child accumulates contentOrigin onto originFromAbc", () => {
    const parent = makeRootContext(INITIAL_COMPUTED_STYLE, 800);
    // A static in-flow child at (10, 50) within the parent frame accumulates that
    // offset so a deeper abs-pos descendant's static position stays abc-relative.
    const child = makeChildContext(parent, { ...INITIAL_COMPUTED_STYLE, position: "static" }, 600, "indefinite", {
      inlineOffset: 10,
      blockOffset: 50,
    });
    expect(child.originFromAbc).toEqual({ inlineOffset: 10, blockOffset: 50 });
  });
});
