import { describe, it, expect } from "vitest";
import { PROPERTY_META, INITIAL_COMPUTED_STYLE } from "./property-meta";

describe("PROPERTY_META", () => {
  it("marks layout properties as non-inheriting", () => {
    expect(PROPERTY_META.marginBlockStart.inherits).toBe(false);
    expect(PROPERTY_META.paddingInlineStart.inherits).toBe(false);
    expect(PROPERTY_META.inlineSize.inherits).toBe(false);
    expect(PROPERTY_META.borderBlockStartWidth.inherits).toBe(false);
  });

  it("marks typography as inheriting", () => {
    expect(PROPERTY_META.fontFamily.inherits).toBe(true);
    expect(PROPERTY_META.fontSize.inherits).toBe(true);
    expect(PROPERTY_META.color.inherits).toBe(true);
  });

  it("marks writing-mode and direction as inheriting", () => {
    expect(PROPERTY_META.writingMode.inherits).toBe(true);
    expect(PROPERTY_META.direction.inherits).toBe(true);
  });
});

describe("INITIAL_COMPUTED_STYLE", () => {
  it("has zero margins, paddings, and borders", () => {
    expect(INITIAL_COMPUTED_STYLE.marginBlockStart).toBe(0);
    expect(INITIAL_COMPUTED_STYLE.marginInlineEnd).toBe(0);
    expect(INITIAL_COMPUTED_STYLE.paddingBlockStart).toBe(0);
    expect(INITIAL_COMPUTED_STYLE.borderBlockStartWidth).toBe(0);
  });

  it("has writing-mode horizontal-tb and direction ltr", () => {
    expect(INITIAL_COMPUTED_STYLE.writingMode).toBe("horizontal-tb");
    expect(INITIAL_COMPUTED_STYLE.direction).toBe("ltr");
  });
});
