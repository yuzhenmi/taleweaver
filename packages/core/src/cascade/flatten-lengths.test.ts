import { describe, it, expect } from "vitest";
import { flattenLengths } from "./flatten-lengths";
import { INITIAL_COMPUTED_STYLE } from "../styles/property-meta";
import type { ComputedStyle } from "../styles";

describe("flattenLengths", () => {
  it("resolves em fontSize against initial fontSize at root", () => {
    // Defensive path: fontSize is `number` in ComputedStyle, but the cascade may
    // pass a pre-flatten value through, so flattenLengths handles em objects.
    const cs = { ...INITIAL_COMPUTED_STYLE, fontSize: { unit: "em", value: 2 } } as unknown as ComputedStyle;
    const out = flattenLengths(cs);
    expect(out.fontSize).toBe(INITIAL_COMPUTED_STYLE.fontSize * 2);
  });

  it("passes through px fontSize unchanged", () => {
    const cs: ComputedStyle = { ...INITIAL_COMPUTED_STYLE, fontSize: 20 };
    const out = flattenLengths(cs);
    expect(out.fontSize).toBe(20);
  });

  it("flattens em padding against own fontSize", () => {
    // Defensive path: paddingBlockStart is ComputedLength (no em), but
    // flattenLength handles em defensively for inputs that haven't been flattened.
    const cs = {
      ...INITIAL_COMPUTED_STYLE,
      fontSize: 16,
      paddingBlockStart: { unit: "em", value: 1.5 },
    } as unknown as ComputedStyle;
    const out = flattenLengths(cs);
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
});
