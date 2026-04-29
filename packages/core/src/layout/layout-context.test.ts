import { describe, it, expect } from "vitest";
import { makeChildContext, makeRootContext, type LayoutContext } from "./layout-context";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import { createIntrinsicSizesCache } from "./intrinsic-sizes";
import { createFloatEnvironment } from "./float-context";
import { createIFCStateCache } from "./ifc-state";

describe("LayoutContext", () => {
  it("makeRootContext from INITIAL_COMPUTED_STYLE", () => {
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 800);
    expect(ctx.writingMode).toBe("horizontal-tb");
    expect(ctx.direction).toBe("ltr");
    expect(ctx.containingInlineSize).toBe(800);
    expect(ctx.containingBlockSize).toBe("indefinite");
  });

  it("makeChildContext inherits writing-mode and direction from parent CS", () => {
    const parent: LayoutContext = {
      writingMode: "horizontal-tb",
      direction: "ltr",
      containingInlineSize: 800,
      containingBlockSize: "indefinite",
      intrinsicCache: createIntrinsicSizesCache(),
      ifcStateCache: createIFCStateCache(),
      floatEnv: createFloatEnvironment(),
      isBFCRoot: false,
      prevLayoutCache: null,
      prevFloatEnv: null,
    };
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
    const parent: LayoutContext = {
      writingMode: "horizontal-tb",
      direction: "ltr",
      containingInlineSize: 800,
      containingBlockSize: "indefinite",
      intrinsicCache: createIntrinsicSizesCache(),
      ifcStateCache: createIFCStateCache(),
      floatEnv: createFloatEnvironment(),
      isBFCRoot: true,
      prevLayoutCache: null,
      prevFloatEnv: null,
    };
    // display:block does NOT establish a new BFC → inherits parent's floatEnv.
    const blockCs = { ...INITIAL_COMPUTED_STYLE, display: "block" as const };
    const child = makeChildContext(parent, blockCs, 600, "indefinite");
    expect(child.floatEnv).toBe(parent.floatEnv);
    expect(child.isBFCRoot).toBe(false);
  });

  it("makeChildContext creates fresh floatEnv for flow-root child (BFC establisher)", () => {
    const parent: LayoutContext = {
      writingMode: "horizontal-tb",
      direction: "ltr",
      containingInlineSize: 800,
      containingBlockSize: "indefinite",
      intrinsicCache: createIntrinsicSizesCache(),
      ifcStateCache: createIFCStateCache(),
      floatEnv: createFloatEnvironment(),
      isBFCRoot: true,
      prevLayoutCache: null,
      prevFloatEnv: null,
    };
    // display:flow-root establishes a new BFC → fresh floatEnv.
    const flowRootCs = { ...INITIAL_COMPUTED_STYLE, display: "flow-root" as const };
    const child = makeChildContext(parent, flowRootCs, 600, "indefinite");
    expect(child.floatEnv).not.toBe(parent.floatEnv);
    expect(child.isBFCRoot).toBe(true);
  });
});
