import { describe, it, expect } from "vitest";
import { flattenLengths } from "./flatten-lengths";
import { INITIAL_COMPUTED_STYLE } from "../styles/property-meta";
import type { ComputedStyle } from "../styles";

/**
 * Construct a ComputedStyle with a single field overridden. The override
 * value is intentionally typed loosely because two tests below exercise
 * defensive em-handling paths in `flattenLengths` — these paths handle
 * inputs that the strict `ComputedStyle` type forbids but the cascade
 * pipeline produces transiently before flatten. Narrowly scoped so the
 * type-relax is localized to the tests that need it.
 */
function csWith<K extends keyof ComputedStyle>(
  key: K,
  value: ComputedStyle[K] | { unit: string; value: number },
): ComputedStyle {
  return { ...INITIAL_COMPUTED_STYLE, [key]: value } as ComputedStyle;
}

describe("flattenLengths", () => {
  it("resolves em fontSize against initial fontSize at root", () => {
    const cs = csWith("fontSize", { unit: "em", value: 2 });
    const out = flattenLengths(cs);
    expect(out.fontSize).toBe(INITIAL_COMPUTED_STYLE.fontSize * 2);
  });

  it("passes through px fontSize unchanged", () => {
    const cs: ComputedStyle = { ...INITIAL_COMPUTED_STYLE, fontSize: 20 };
    const out = flattenLengths(cs);
    expect(out.fontSize).toBe(20);
  });

  it("flattens em padding against own fontSize", () => {
    const cs = csWith("paddingBlockStart", { unit: "em", value: 1.5 });
    const out = flattenLengths({ ...cs, fontSize: 16 });
    expect(out.paddingBlockStart).toBe(24);
  });

  it("preserves percent margins unresolved (cascade can't resolve %)", () => {
    const cs: ComputedStyle = {
      ...INITIAL_COMPUTED_STYLE,
      marginBlockStart: { unit: "percent", value: 50 },
    };
    const out = flattenLengths(cs);
    expect(out.marginBlockStart).toEqual({ unit: "percent", value: 50 });
  });

  it("preserves intrinsic sizing keywords", () => {
    const cs: ComputedStyle = { ...INITIAL_COMPUTED_STYLE, inlineSize: "max-content" };
    const out = flattenLengths(cs);
    expect(out.inlineSize).toBe("max-content");
  });

  it("flattens em letterSpacing against own fontSize", () => {
    const cs = csWith("letterSpacing", { unit: "em", value: 0.05 });
    const out = flattenLengths({ ...cs, fontSize: 16 });
    expect(out.letterSpacing).toBe(0.8);  // 16 * 0.05
  });

  it("flattens em wordSpacing against own fontSize", () => {
    const cs = csWith("wordSpacing", { unit: "em", value: 0.25 });
    const out = flattenLengths({ ...cs, fontSize: 16 });
    expect(out.wordSpacing).toBe(4);  // 16 * 0.25
  });

  it("flattens em textIndent against own fontSize", () => {
    const cs = csWith("textIndent", { unit: "em", value: 2 });
    const out = flattenLengths({ ...cs, fontSize: 16 });
    expect(out.textIndent).toBe(32);  // 16 * 2
  });

  it("passes through 'normal' letterSpacing unchanged", () => {
    const cs: ComputedStyle = { ...INITIAL_COMPUTED_STYLE, letterSpacing: "normal" };
    const out = flattenLengths(cs);
    expect(out.letterSpacing).toBe("normal");
  });

  it("passes through 'normal' wordSpacing unchanged", () => {
    const cs: ComputedStyle = { ...INITIAL_COMPUTED_STYLE, wordSpacing: "normal" };
    const out = flattenLengths(cs);
    expect(out.wordSpacing).toBe("normal");
  });

  it("preserves percent textIndent unresolved (cascade can't resolve %)", () => {
    const cs: ComputedStyle = {
      ...INITIAL_COMPUTED_STYLE,
      textIndent: { unit: "percent", value: 10 },
    };
    const out = flattenLengths(cs);
    expect(out.textIndent).toEqual({ unit: "percent", value: 10 });
  });

  it("passes through px letterSpacing unchanged", () => {
    const cs: ComputedStyle = { ...INITIAL_COMPUTED_STYLE, letterSpacing: 2 };
    const out = flattenLengths(cs);
    expect(out.letterSpacing).toBe(2);
  });

  // ---------------------------------------------------------------------
  // C-B: lineHeight disambiguation (per
  // docs/superpowers/specs/2026-05-23-line-height-disambiguation-design.md).
  // Unitless number = inherits-as-ratio (used-value multiplies by own
  // fontSize at layout time); em becomes unitless ratio of the same value;
  // percent passes through (resolved against own fontSize at used-style).
  // px is unsupported.
  // ---------------------------------------------------------------------

  it("C-B: unitless lineHeight passes through as a number (inherits as ratio)", () => {
    const cs: ComputedStyle = { ...INITIAL_COMPUTED_STYLE, lineHeight: 1.5 };
    const out = flattenLengths(cs);
    expect(out.lineHeight).toBe(1.5);
  });

  it("C-B: em lineHeight converts to unitless ratio of the same value", () => {
    // `1.5em` semantically equals "1.5 × own fontSize" — the same as
    // unitless 1.5. The conversion preserves the inherit-as-ratio property.
    const cs = csWith("lineHeight", { unit: "em", value: 1.5 });
    const out = flattenLengths(cs);
    expect(out.lineHeight).toBe(1.5);
  });

  it("C-B: percent lineHeight passes through as ComputedLength", () => {
    const cs: ComputedStyle = {
      ...INITIAL_COMPUTED_STYLE,
      lineHeight: { unit: "percent", value: 150 },
    };
    const out = flattenLengths(cs);
    expect(out.lineHeight).toEqual({ unit: "percent", value: 150 });
  });

  it("C-B: px lineHeight is unsupported — falls back to the initial unitless ratio", () => {
    const cs = csWith("lineHeight", { unit: "px", value: 24 });
    const out = flattenLengths(cs);
    expect(out.lineHeight).toBe(INITIAL_COMPUTED_STYLE.lineHeight);
  });

  // ── Positioning insets (slice 1): em→px like margins; %/auto pass through ───

  it("flattens em insetInlineStart against own fontSize (like margins)", () => {
    const cs = csWith("insetInlineStart", { unit: "em", value: 2 });
    const out = flattenLengths({ ...cs, fontSize: 16 });
    expect(out.insetInlineStart).toBe(32);  // 16 * 2
  });

  it("flattens em insetBlockEnd against own fontSize", () => {
    const cs = csWith("insetBlockEnd", { unit: "em", value: 1.5 });
    const out = flattenLengths({ ...cs, fontSize: 16 });
    expect(out.insetBlockEnd).toBe(24);  // 16 * 1.5
  });

  it("passes through 'auto' insets unchanged", () => {
    const out = flattenLengths(INITIAL_COMPUTED_STYLE);
    expect(out.insetBlockStart).toBe("auto");
    expect(out.insetBlockEnd).toBe("auto");
    expect(out.insetInlineStart).toBe("auto");
    expect(out.insetInlineEnd).toBe("auto");
  });

  it("preserves percent insets unresolved (cascade can't resolve %)", () => {
    const cs: ComputedStyle = {
      ...INITIAL_COMPUTED_STYLE,
      insetInlineStart: { unit: "percent", value: 25 },
    };
    const out = flattenLengths(cs);
    expect(out.insetInlineStart).toEqual({ unit: "percent", value: 25 });
  });
});
