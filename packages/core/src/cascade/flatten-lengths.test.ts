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
});
