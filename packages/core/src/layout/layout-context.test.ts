import { describe, it, expect } from "vitest";
import { makeChildContext, makeRootContext, type LayoutContext } from "./layout-context";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import { createIntrinsicSizesCache } from "./intrinsic-sizes";

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
    };
    const childCs = { ...INITIAL_COMPUTED_STYLE, direction: "rtl" as const };
    const child = makeChildContext(parent, childCs, 600, "indefinite");
    expect(child.direction).toBe("rtl");
    expect(child.containingInlineSize).toBe(600);
    // Shared intrinsic-sizes cache must be the same object.
    expect(child.intrinsicCache).toBe(parent.intrinsicCache);
  });
});
