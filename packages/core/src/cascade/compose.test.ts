import { describe, it, expect } from "vitest";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import type { ComputedStyle } from "../styles";
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

  it("does NOT inherit underline / lineThrough from parent (CSS spec)", () => {
    // Per CSS Text Decoration Module Level 3, `text-decoration` does not
    // inherit. Otherwise a child span with no specified decoration would
    // silently pick up the parent's underline — and the user could never
    // remove underline from a sub-run by leaving the attr off.
    const parent = { ...INITIAL_COMPUTED_STYLE, underline: true, lineThrough: true };
    const result = composeComputed({}, parent);
    expect(result.underline).toBe(false);    // initial, NOT inherited
    expect(result.lineThrough).toBe(false);  // initial, NOT inherited
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

  // ── Positioning vocabulary (slice 1 — inert schema + cascade) ───────────────

  it("defaults every positioning property to its initial value when undeclared", () => {
    const result = composeComputed({}, INITIAL_COMPUTED_STYLE);
    expect(result.position).toBe("static");
    expect(result.insetBlockStart).toBe("auto");
    expect(result.insetBlockEnd).toBe("auto");
    expect(result.insetInlineStart).toBe("auto");
    expect(result.insetInlineEnd).toBe("auto");
    expect(result.zIndex).toBe("auto");
    expect(result.transform).toEqual([]);
    expect(result.transformOrigin).toEqual({
      x: { unit: "percent", value: 50 },
      y: { unit: "percent", value: 50 },
    });
    expect(result.opacity).toBe(1);
  });

  it("passes declared positioning values through verbatim", () => {
    const result = composeComputed(
      {
        position: "absolute",
        insetInlineStart: 10,
        zIndex: 5,
        transform: [{ fn: "rotate", angleRad: 1 }],
        transformOrigin: { x: 0, y: 0 },
        opacity: 0.5,
      },
      INITIAL_COMPUTED_STYLE,
    );
    expect(result.position).toBe("absolute");
    expect(result.insetInlineStart).toBe(10);
    expect(result.zIndex).toBe(5);
    expect(result.transform).toEqual([{ fn: "rotate", angleRad: 1 }]);
    expect(result.transformOrigin).toEqual({ x: 0, y: 0 });
    expect(result.opacity).toBe(0.5);
  });

  it("does NOT inherit positioning properties from parent (inherits: false)", () => {
    // A child must NOT pick up a parent's declared position/inset/z-index/
    // transform/opacity — these are non-inheriting per CSS.
    const parent: ComputedStyle = {
      ...INITIAL_COMPUTED_STYLE,
      position: "absolute",
      insetBlockStart: 20,
      insetInlineStart: 20,
      zIndex: 7,
      transform: [{ fn: "scale", sx: 2, sy: 2 }],
      opacity: 0.25,
    };
    const result = composeComputed({}, parent);
    expect(result.position).toBe("static");         // initial, NOT inherited
    expect(result.insetBlockStart).toBe("auto");
    expect(result.insetInlineStart).toBe("auto");
    expect(result.zIndex).toBe("auto");
    expect(result.transform).toEqual([]);
    expect(result.opacity).toBe(1);
  });
});
