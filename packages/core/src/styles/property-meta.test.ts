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

  it("has no marker text by default (markerText absent)", () => {
    expect(INITIAL_COMPUTED_STYLE.markerText).toBeUndefined();
  });
});

describe("PROPERTY_META — markerText (generated marker content)", () => {
  it("markerText does NOT inherit", () => {
    expect(PROPERTY_META.markerText.inherits).toBe(false);
  });
});

describe("PROPERTY_META — content / counterReset / counterIncrement (P9a)", () => {
  it("none of the generated-content / counter properties inherit (CSS)", () => {
    expect(PROPERTY_META.content.inherits).toBe(false);
    expect(PROPERTY_META.counterReset.inherits).toBe(false);
    expect(PROPERTY_META.counterIncrement.inherits).toBe(false);
  });
});

describe("INITIAL_COMPUTED_STYLE — content / counterReset / counterIncrement (P9a)", () => {
  it("content defaults to 'normal'", () => {
    expect(INITIAL_COMPUTED_STYLE.content).toBe("normal");
  });

  it("counterReset / counterIncrement default to empty arrays", () => {
    expect(INITIAL_COMPUTED_STYLE.counterReset).toEqual([]);
    expect(INITIAL_COMPUTED_STYLE.counterIncrement).toEqual([]);
  });

  it("counterReset and counterIncrement share ONE frozen [] reference (reuse-preserving)", () => {
    // Same reference each access (it is a constant on a module-level object).
    expect(INITIAL_COMPUTED_STYLE.counterReset).toBe(INITIAL_COMPUTED_STYLE.counterReset);
    expect(INITIAL_COMPUTED_STYLE.counterIncrement).toBe(INITIAL_COMPUTED_STYLE.counterIncrement);
    // Both initials are the SAME shared reference (mirrors fontFeatureSettings precedent).
    expect(INITIAL_COMPUTED_STYLE.counterReset).toBe(INITIAL_COMPUTED_STYLE.counterIncrement);
  });

  it("the shared empty counter-action array is frozen", () => {
    expect(Object.isFrozen(INITIAL_COMPUTED_STYLE.counterReset)).toBe(true);
    expect(Object.isFrozen(INITIAL_COMPUTED_STYLE.counterIncrement)).toBe(true);
  });
});
