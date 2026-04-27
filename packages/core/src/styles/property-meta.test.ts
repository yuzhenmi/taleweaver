import { describe, it, expect } from "vitest";
import { PROPERTY_META, INITIAL_COMPUTED_STYLE } from "./property-meta";

describe("PROPERTY_META", () => {
  it("declares typography properties as inheritable", () => {
    expect(PROPERTY_META.fontFamily.inherits).toBe(true);
    expect(PROPERTY_META.fontSize.inherits).toBe(true);
    expect(PROPERTY_META.fontWeight.inherits).toBe(true);
    expect(PROPERTY_META.color.inherits).toBe(true);
    expect(PROPERTY_META.lineHeight.inherits).toBe(true);
    expect(PROPERTY_META.textDecoration.inherits).toBe(true);
  });

  it("declares layout properties as non-inheritable", () => {
    expect(PROPERTY_META.display.inherits).toBe(false);
    expect(PROPERTY_META.marginTop.inherits).toBe(false);
    expect(PROPERTY_META.paddingTop.inherits).toBe(false);
    expect(PROPERTY_META.float.inherits).toBe(false);
  });

  it("declares whiteSpace and listStyle properties as inheritable", () => {
    expect(PROPERTY_META.whiteSpace.inherits).toBe(true);
    expect(PROPERTY_META.listStyleType.inherits).toBe(true);
    expect(PROPERTY_META.listStylePosition.inherits).toBe(true);
  });

  it("declares widows and orphans as inheritable", () => {
    expect(PROPERTY_META.widows.inherits).toBe(true);
    expect(PROPERTY_META.orphans.inherits).toBe(true);
  });
});

describe("INITIAL_COMPUTED_STYLE", () => {
  it("has CSS-faithful initial values", () => {
    expect(INITIAL_COMPUTED_STYLE.display).toBe("inline");
    expect(INITIAL_COMPUTED_STYLE.width).toBe("auto");
    expect(INITIAL_COMPUTED_STYLE.fontSize).toBe(16);
    expect(INITIAL_COMPUTED_STYLE.fontWeight).toBe("normal");
    expect(INITIAL_COMPUTED_STYLE.color).toBe("black");
    expect(INITIAL_COMPUTED_STYLE.lineHeight).toBe(1.2);
    expect(INITIAL_COMPUTED_STYLE.whiteSpace).toBe("normal");
    expect(INITIAL_COMPUTED_STYLE.verticalAlign).toBe("baseline");
    expect(INITIAL_COMPUTED_STYLE.float).toBe("none");
    expect(INITIAL_COMPUTED_STYLE.widows).toBe(2);
    expect(INITIAL_COMPUTED_STYLE.orphans).toBe(2);
    expect(INITIAL_COMPUTED_STYLE.listStyleType).toBe("disc");
    expect(INITIAL_COMPUTED_STYLE.marginTop).toBe(0);
  });
});
