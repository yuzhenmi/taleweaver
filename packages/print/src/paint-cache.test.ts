import { describe, it, expect } from "vitest";
import { hashPaintInputs, createPaintCache } from "./paint-cache";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import type { ComputedStyle, UsedStyle } from "@taleweaver/core";
import type { LayoutBox } from "./index";

// Fully-typed bases so override fields (e.g. underline/lineThrough) are
// compiler-checked against ComputedStyle/UsedStyle — a future rename surfaces
// as a build error instead of silently compiling.
const BASE_CS: ComputedStyle = INITIAL_COMPUTED_STYLE;
const BASE_US: Pick<
  UsedStyle,
  | "paddingBlockStart"
  | "paddingBlockEnd"
  | "paddingInlineStart"
  | "paddingInlineEnd"
  | "borderBlockStartWidth"
  | "borderBlockEndWidth"
  | "borderInlineStartWidth"
  | "borderInlineEndWidth"
  | "writingMode"
> = {
  paddingBlockStart: 0,
  paddingBlockEnd: 0,
  paddingInlineStart: 0,
  paddingInlineEnd: 0,
  borderBlockStartWidth: 0,
  borderBlockEndWidth: 0,
  borderInlineStartWidth: 0,
  borderInlineEndWidth: 0,
  writingMode: "horizontal-tb",
};

function makeBlockBox(overrides: Partial<LayoutBox> = {}): LayoutBox {
  return {
    type: "block",
    key: "k",
    inlineOffset: 0,
    blockOffset: 0,
    inlineSize: 100,
    blockSize: 50,
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    writingMode: "horizontal-tb",
    direction: "ltr",
    computedStyle: BASE_CS,
    usedStyle: BASE_US,
    children: [],
    ...overrides,
  } as unknown as LayoutBox;
}

describe("hashPaintInputs", () => {
  it("same inputs → same hash", () => {
    const a = makeBlockBox();
    const b = makeBlockBox();
    expect(hashPaintInputs(a)).toBe(hashPaintInputs(b));
  });

  it("different position → different hash", () => {
    const a = makeBlockBox({ x: 0, y: 0 });
    const b = makeBlockBox({ x: 0, y: 10 });
    expect(hashPaintInputs(a)).not.toBe(hashPaintInputs(b));
  });

  it("different size → different hash", () => {
    const a = makeBlockBox({ width: 100, height: 50 });
    const b = makeBlockBox({ width: 100, height: 60 });
    expect(hashPaintInputs(a)).not.toBe(hashPaintInputs(b));
  });

  it("#393: differing lineThrough → different hash (strikethrough toggle invalidates cache)", () => {
    const a = makeBlockBox({ computedStyle: { ...BASE_CS, lineThrough: false } });
    const b = makeBlockBox({ computedStyle: { ...BASE_CS, lineThrough: true } });
    expect(hashPaintInputs(a)).not.toBe(hashPaintInputs(b));
  });

  it("#393: differing underline → different hash", () => {
    const a = makeBlockBox({ computedStyle: { ...BASE_CS, underline: false } });
    const b = makeBlockBox({ computedStyle: { ...BASE_CS, underline: true } });
    expect(hashPaintInputs(a)).not.toBe(hashPaintInputs(b));
  });

  it("P-S5: a transform change → different hash (paint applies it as a matrix)", () => {
    const plain = makeBlockBox();
    const tx10: ComputedStyle = { ...BASE_CS, transform: [{ fn: "translateX", tx: 10 }] };
    const tx20: ComputedStyle = { ...BASE_CS, transform: [{ fn: "translateX", tx: 20 }] };
    const a = makeBlockBox({ computedStyle: tx10 });
    const b = makeBlockBox({ computedStyle: tx20 });
    expect(hashPaintInputs(a)).not.toBe(hashPaintInputs(b));
    // Guard: the untransformed box's hash is unchanged by the new field (no `|tf:`).
    expect(hashPaintInputs(plain)).not.toContain("|tf:");
    expect(hashPaintInputs(a)).toContain("|tf:");
  });

  it("P-S6: an opacity change → different hash (paint composites the group at globalAlpha)", () => {
    const opaque = makeBlockBox();
    const op50: ComputedStyle = { ...BASE_CS, opacity: 0.5 };
    const op25: ComputedStyle = { ...BASE_CS, opacity: 0.25 };
    const a = makeBlockBox({ computedStyle: op50 });
    const b = makeBlockBox({ computedStyle: op25 });
    expect(hashPaintInputs(a)).not.toBe(hashPaintInputs(b));
    // Guard: the fully-opaque box's hash is unchanged by the new field (no `|op:`).
    expect(hashPaintInputs(opaque)).not.toContain("|op:");
    expect(hashPaintInputs(a)).toContain("|op:");
  });
});

describe("createPaintCache", () => {
  it("get returns undefined for missing box", () => {
    const cache = createPaintCache();
    const b = makeBlockBox();
    expect(cache.get(b)).toBeUndefined();
  });

  it("set then get roundtrips", () => {
    const cache = createPaintCache();
    const b = makeBlockBox();
    cache.set(b, "hash1");
    expect(cache.get(b)).toBe("hash1");
  });

  it("isUnchanged returns false for missing box", () => {
    const cache = createPaintCache();
    const b = makeBlockBox();
    expect(cache.isUnchanged(b)).toBe(false);
  });

  it("isUnchanged returns true after first set", () => {
    const cache = createPaintCache();
    const b = makeBlockBox();
    cache.set(b, hashPaintInputs(b));
    expect(cache.isUnchanged(b)).toBe(true);
  });
});

describe("PaintCache last-root tracking", () => {
  it("returns null for the last-walked root when never set", () => {
    const cache = createPaintCache();
    expect(cache.getLastRoot()).toBe(null);
  });

  it("remembers the last-walked root", () => {
    const cache = createPaintCache();
    // The cache only stores the reference; any LayoutBox works.
    const root = makeBlockBox();
    cache.setLastRoot(root);
    expect(cache.getLastRoot()).toBe(root);
  });

  it("setLastRoot(null) clears the reference", () => {
    const cache = createPaintCache();
    const root = makeBlockBox();
    cache.setLastRoot(root);
    cache.setLastRoot(null);
    expect(cache.getLastRoot()).toBe(null);
  });
});
