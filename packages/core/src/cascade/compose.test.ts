import { describe, it, expect } from "vitest";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import { composeComputed } from "./compose";

describe("composeComputed", () => {
  it("uses specified value when present", () => {
    const result = composeComputed(
      { display: "block", color: "red" },
      INITIAL_COMPUTED_STYLE,
    );
    expect(result.display).toBe("block");
    expect(result.color).toBe("red");
  });

  it("inherits inheritable properties from parent when unspecified", () => {
    const parent = { ...INITIAL_COMPUTED_STYLE, color: "red", fontSize: 24 };
    const result = composeComputed({ display: "inline" }, parent);
    expect(result.color).toBe("red");          // inheritable, inherited
    expect(result.fontSize).toBe(24);          // inheritable, inherited
    expect(result.display).toBe("inline");     // specified
  });

  it("uses initial value when unspecified and not inheritable", () => {
    const parent = { ...INITIAL_COMPUTED_STYLE, marginBlockStart: 100 };
    const result = composeComputed({}, parent);
    expect(result.marginBlockStart).toBe(0);          // marginBlockStart does NOT inherit
  });

  it("resolves with no parent (root cascade)", () => {
    const result = composeComputed({ display: "block" }, null);
    expect(result.display).toBe("block");
    expect(result.color).toBe("#000");        // initial
    expect(result.fontSize).toBe(16);          // initial
    expect(result.marginBlockStart).toBe(0);
  });

  it("does NOT inherit textDecoration from parent (CSS spec)", () => {
    // Per CSS Text Decoration Module Level 3, `text-decoration` does not
    // inherit. Otherwise a child span with no specified textDecoration
    // would silently pick up the parent's underline — and the user could
    // never remove underline from a sub-run by leaving the attr off.
    const parent = { ...INITIAL_COMPUTED_STYLE, textDecoration: "underline" as const };
    const result = composeComputed({}, parent);
    expect(result.textDecoration).toBe("none");  // initial, NOT "underline"
  });

  it("flows specified markerText through generically", () => {
    const result = composeComputed({ markerText: "1" }, INITIAL_COMPUTED_STYLE);
    expect(result.markerText).toBe("1");
  });

  it("does NOT inherit markerText from parent (generated marker content)", () => {
    // markerText is a per-element generated-content presentation property,
    // like a `::marker` content string. A child of a markerText-bearing
    // parent must NOT pick it up — otherwise every descendant would render
    // the same marker.
    const parent = { ...INITIAL_COMPUTED_STYLE, markerText: "1" };
    const result = composeComputed({}, parent);
    expect(result.markerText).toBeUndefined();  // initial (absent), NOT "1"
  });
});
