import { describe, it, expect } from "vitest";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { computedStyleToInlineStyle } from "./computed-style-to-css";

describe("computedStyleToInlineStyle", () => {
  it("emits nothing for the initial computed style", () => {
    expect(computedStyleToInlineStyle(INITIAL_COMPUTED_STYLE)).toBe("");
  });

  it("emits non-default typography", () => {
    const css = computedStyleToInlineStyle({ ...INITIAL_COMPUTED_STYLE, color: "red", fontSize: 24, fontWeight: "bold" });
    expect(css).toContain("color: red");
    expect(css).toContain("font-size: 24px");
    expect(css).toContain("font-weight: bold");
  });

  it("maps logical inline-start margin to physical left under LTR", () => {
    const css = computedStyleToInlineStyle({ ...INITIAL_COMPUTED_STYLE, marginInlineStart: 20 });
    expect(css).toContain("margin-left: 20px");
  });

  it("maps logical inline-start margin to physical right under RTL", () => {
    const css = computedStyleToInlineStyle({ ...INITIAL_COMPUTED_STYLE, direction: "rtl", marginInlineStart: 20 });
    expect(css).toContain("margin-right: 20px");
    expect(css).toContain("direction: rtl");
  });

  it("maps block-axis sides to the horizontal axis under vertical-rl", () => {
    const css = computedStyleToInlineStyle({ ...INITIAL_COMPUTED_STYLE, writingMode: "vertical-rl", marginBlockStart: 8 });
    expect(css).toContain("writing-mode: vertical-rl");
    expect(css).toContain("margin-right: 8px");
  });

  it("emits a percent length verbatim", () => {
    const css = computedStyleToInlineStyle({ ...INITIAL_COMPUTED_STYLE, textIndent: { unit: "percent", value: 10 } });
    expect(css).toContain("text-indent: 10%");
  });

  it("emits unitless line-height for a multiplier number", () => {
    const css = computedStyleToInlineStyle({ ...INITIAL_COMPUTED_STYLE, lineHeight: 1.5 });
    expect(css).toContain("line-height: 1.5");
    expect(css).not.toContain("1.5px");
  });

  it("combines underline + line-through into one text-decoration-line", () => {
    const css = computedStyleToInlineStyle({ ...INITIAL_COMPUTED_STYLE, underline: true, lineThrough: true });
    expect(css).toContain("text-decoration-line: underline line-through");
  });

  it("emits a non-default list-style-type keyword (so lists keep their numbering format)", () => {
    const css = computedStyleToInlineStyle({ ...INITIAL_COMPUTED_STYLE, listStyleType: "lower-alpha" });
    expect(css).toContain("list-style-type: lower-alpha");
  });

  it("does NOT emit list-style-type for the initial value (disc)", () => {
    expect(computedStyleToInlineStyle({ ...INITIAL_COMPUTED_STYLE, listStyleType: "disc" })).toBe("");
  });

  it("emits a custom literal marker as a quoted, escaped CSS string", () => {
    const css = computedStyleToInlineStyle({ ...INITIAL_COMPUTED_STYLE, listStyleType: { content: 'a"b' } });
    expect(css).toContain('list-style-type: "a\\"b"');
  });

  it("escapes all CSS newline characters (LF/CR/FF) in a custom marker", () => {
    // CSS input-preprocessing folds CR and FF to LF, so each must be escaped or it would break the
    // quoted string token exactly as a raw LF would.
    const css = computedStyleToInlineStyle({ ...INITIAL_COMPUTED_STYLE, listStyleType: { content: "a\nb\rc\fd" } });
    expect(css).toContain('list-style-type: "a\\A b\\A c\\A d"');
  });
});
