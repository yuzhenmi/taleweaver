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
    expect(PROPERTY_META.language.inherits).toBe(true);
    expect(PROPERTY_META.hyphenateLimitChars.inherits).toBe(true);
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

  it("has the auto-hyphenation defaults (empty language, [5,2,2] limit-chars)", () => {
    expect(INITIAL_COMPUTED_STYLE.language).toBe("");
    expect(INITIAL_COMPUTED_STYLE.hyphenateLimitChars).toEqual([5, 2, 2]);
  });
});

describe("PROPERTY_META — markerText (generated marker content)", () => {
  it("markerText does NOT inherit", () => {
    expect(PROPERTY_META.markerText.inherits).toBe(false);
  });
});

describe("PROPERTY_META — positioning (slice 1)", () => {
  it("all positioning properties are non-inheriting", () => {
    expect(PROPERTY_META.position.inherits).toBe(false);
    expect(PROPERTY_META.insetBlockStart.inherits).toBe(false);
    expect(PROPERTY_META.insetBlockEnd.inherits).toBe(false);
    expect(PROPERTY_META.insetInlineStart.inherits).toBe(false);
    expect(PROPERTY_META.insetInlineEnd.inherits).toBe(false);
    expect(PROPERTY_META.zIndex.inherits).toBe(false);
    expect(PROPERTY_META.transform.inherits).toBe(false);
    expect(PROPERTY_META.transformOrigin.inherits).toBe(false);
    expect(PROPERTY_META.opacity.inherits).toBe(false);
  });
});

describe("INITIAL_COMPUTED_STYLE — positioning (slice 1)", () => {
  it("has static position, auto insets, auto z-index, empty transform, center origin, opacity 1", () => {
    expect(INITIAL_COMPUTED_STYLE.position).toBe("static");
    expect(INITIAL_COMPUTED_STYLE.insetBlockStart).toBe("auto");
    expect(INITIAL_COMPUTED_STYLE.insetBlockEnd).toBe("auto");
    expect(INITIAL_COMPUTED_STYLE.insetInlineStart).toBe("auto");
    expect(INITIAL_COMPUTED_STYLE.insetInlineEnd).toBe("auto");
    expect(INITIAL_COMPUTED_STYLE.zIndex).toBe("auto");
    expect(INITIAL_COMPUTED_STYLE.transform).toEqual([]);
    expect(INITIAL_COMPUTED_STYLE.transformOrigin).toEqual({
      x: { unit: "percent", value: 50 },
      y: { unit: "percent", value: 50 },
    });
    expect(INITIAL_COMPUTED_STYLE.opacity).toBe(1);
  });

  it("shares a single frozen empty-array transform default (no per-style allocation)", () => {
    // The default transform must be a shared frozen constant — not a fresh `[]`
    // allocated per access — so two reads return the same reference and it can't
    // be mutated.
    expect(Object.isFrozen(INITIAL_COMPUTED_STYLE.transform)).toBe(true);
    expect(Object.isFrozen(INITIAL_COMPUTED_STYLE.transformOrigin)).toBe(true);
  });
});
